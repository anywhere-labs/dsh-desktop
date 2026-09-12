from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from backend.app.core.paths import PROJECT_ROOT

CATALOG_DIR = PROJECT_ROOT / "storage" / "liveclip_catalogs"


SKU_HEADERS = ("款式编码", "sku", "sku_id", "商品编码", "商品货号", "款号")
NAME_HEADERS = ("商品名称", "商品名", "商品", "名称", "title", "product_name")
COLOR_HEADERS = ("颜色", "色号", "颜色备注", "color")
PRICE_HEADERS = ("抖音价", "直播价", "活动价", "改价", "价格", "price", "基本售价")


def parse_product_catalog(content: bytes, filename: str) -> dict[str, Any]:
    suffix = Path(filename or "").suffix.lower()
    try:
        if suffix == ".xlsx":
            sheets = _read_xlsx(content)
        elif suffix in {".csv", ".tsv"}:
            reader = csv.reader(
                io.StringIO(content.decode("utf-8-sig")),
                delimiter="\t" if suffix == ".tsv" else ",",
            )
            sheets = [(Path(filename).stem, list(reader))]
        elif suffix in {".html", ".htm"}:
            sheets = [(Path(filename).stem, _read_html(content))]
        else:
            return {"status": "blocked", "products": [], "missing_inputs": ["catalog_format"], "warnings": ["仅支持 XLSX、CSV、TSV 或 HTML 排品表。"]}
    except (OSError, ValueError, UnicodeDecodeError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
        return {"status": "blocked", "products": [], "missing_inputs": ["catalog_parse"], "warnings": [f"排品表解析失败：{exc}"]}

    products: list[dict[str, Any]] = []
    warnings: list[str] = []
    for sheet_name, rows in sheets:
        if not rows:
            continue
        header_index, columns = _find_header(rows)
        if columns.get("sku") is None or columns.get("name") is None or columns.get("price") is None:
            continue
        for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
            product = _normalize_row(sheet_name, row_number, row, columns)
            if product:
                products.append(product)
    deduped = _dedupe(products)
    if not deduped:
        return {"status": "blocked", "products": [], "missing_inputs": ["catalog_columns", "catalog_rows"], "warnings": ["未找到同时包含 SKU、商品名称和价格的有效商品行。"]}
    return {"status": "ok", "products": deduped, "count": len(deduped), "warnings": warnings}


def save_product_catalog(parsed: dict[str, Any], filename: str) -> dict[str, Any]:
    catalog_id = f"catalog_{__import__('uuid').uuid4().hex}"
    CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "catalog_id": catalog_id,
        "filename": filename,
        "count": parsed.get("count", 0),
        "products": parsed.get("products") or [],
        "warnings": parsed.get("warnings") or [],
    }
    (CATALOG_DIR / f"{catalog_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return payload


def load_product_catalog(catalog_id: str) -> dict[str, Any] | None:
    path = CATALOG_DIR / f"{Path(catalog_id).name}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _read_xlsx(content: bytes) -> list[tuple[str, list[list[str]]]]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        shared: list[str] = []
        sheet_names: list[str] = []
        if "xl/workbook.xml" in archive.namelist():
            workbook_root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            sheet_names = [node.attrib.get("name", "") for node in workbook_root.findall(".//{*}sheet")]
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in root.findall(".//{*}si")]
        sheets: list[tuple[str, list[list[str]]]] = []
        for sheet_index, sheet_path in enumerate(sorted(name for name in archive.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name))):
            root = ElementTree.fromstring(archive.read(sheet_path))
            rows: list[list[str]] = []
            for row_node in root.findall(".//{*}row"):
                values: dict[int, str] = {}
                max_index = -1
                for cell in row_node.findall("{*}c"):
                    ref = cell.attrib.get("r", "A1")
                    col = re.match(r"([A-Z]+)", ref)
                    index = _column_index(col.group(1)) if col else len(values)
                    max_index = max(max_index, index)
                    inline = cell.find(".//{*}t")
                    value_node = cell.find("{*}v")
                    value = "" if value_node is None else (value_node.text or "")
                    if cell.attrib.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    elif inline is not None:
                        value = "".join(inline.itertext())
                    values[index] = value.strip()
                rows.append([values.get(i, "") for i in range(max_index + 1)])
            sheets.append((sheet_names[sheet_index] if sheet_index < len(sheet_names) else Path(sheet_path).stem, rows))
        return sheets


def _read_html(content: bytes) -> list[list[str]]:
    parser = _TableParser()
    parser.feed(content.decode("utf-8-sig", errors="replace"))
    return parser.rows


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def _find_header(rows: list[list[str]]) -> tuple[int, dict[str, int | None]]:
    for index, row in enumerate(rows[:30]):
        normalized = [_norm(item) for item in row]
        columns = {
            "sku": _find_column(normalized, SKU_HEADERS),
            "name": _find_column(normalized, NAME_HEADERS),
            "color": _find_column(normalized, COLOR_HEADERS),
            "price": _find_column(normalized, PRICE_HEADERS),
        }
        if columns["sku"] is not None and columns["name"] is not None and columns["price"] is not None:
            return index, columns
    return 0, {"sku": None, "name": None, "color": None, "price": None}


def _normalize_row(sheet: str, row_number: int, row: list[str], columns: dict[str, int | None]) -> dict[str, Any] | None:
    def value(key: str) -> str:
        index = columns.get(key)
        return str(row[index]).strip() if index is not None and index < len(row) else ""

    sku = value("sku")
    name = value("name")
    price_raw = value("price").replace(",", "")
    if not sku or not name or not price_raw:
        return None
    try:
        price = float(price_raw.replace("￥", "").replace("¥", ""))
    except ValueError:
        return None
    color = value("color")
    aliases = [name]
    if color:
        aliases.append(color)
    return {"sku_id": sku, "product_name": name, "color": color, "price": price, "aliases": aliases, "source_sheet": sheet, "source_row": row_number}


def _find_column(headers: list[str], candidates: tuple[str, ...]) -> int | None:
    for index, header in enumerate(headers):
        if any(candidate in header for candidate in candidates):
            return index
    return None


def _norm(value: Any) -> str:
    return re.sub(r"[\s_\-（）()|/]+", "", str(value or "").strip().lower())


def _column_index(value: str) -> int:
    result = 0
    for char in value:
        result = result * 26 + ord(char) - 64
    return result - 1


def _dedupe(products: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for product in products:
        key = f"{product['sku_id']}::{product['color']}"
        if key not in seen:
            seen.add(key)
            output.append(product)
    return output
