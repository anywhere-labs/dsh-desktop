from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from backend.app.core.paths import STORAGE_DIR, ensure_dirs
from backend.app.registries.brand_data_registry import get_brand_data_agent, get_brand_data_skills

COLLECTION_DIR = STORAGE_DIR / "brand_data"
OCEANENGINE_BASE = "https://api.oceanengine.com"
OCEANENGINE_SEARCH_PATH = "/open_api/v3.0/report/custom/get/"
QIANCHUAN_REPORT_PATH = "/open_api/v1.0/qianchuan/report/advertiser/get/"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _path(collection_id: str) -> Path:
    ensure_dirs()
    COLLECTION_DIR.mkdir(parents=True, exist_ok=True)
    return COLLECTION_DIR / f"{collection_id}.json"


def _save(item: dict[str, Any]) -> dict[str, Any]:
    _path(item["id"]).write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    return item


def _load(collection_id: str) -> dict[str, Any]:
    path = _path(collection_id)
    if not path.exists():
        raise KeyError(f"brand collection not found: {collection_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def create_collection(payload: dict[str, Any]) -> dict[str, Any]:
    collection_id = uuid.uuid4().hex
    item = {
        "id": collection_id,
        "agent": get_brand_data_agent(),
        "skills": get_brand_data_skills(),
        "status": "created",
        "brand_name": str(payload.get("brand_name") or "").strip(),
        "category": str(payload.get("category") or "").strip(),
        "keywords": list(payload.get("keywords") or []),
        "source_urls": list(payload.get("source_urls") or []),
        "brand_voice_search_endpoint": str(payload.get("brand_voice_search_endpoint") or "").strip(),
        "oceanengine": payload.get("oceanengine") or {},
        "qianchuan": payload.get("qianchuan") or {},
        "brand_voice_observations": list(payload.get("brand_voice_observations") or []),
        "created_at": _now(),
        "updated_at": _now(),
        "evidence": [],
        "quality": {"status": "not_run", "coverage": 0, "checks": []},
        "errors": [],
    }
    if not item["brand_name"]:
        item["errors"].append("brand_name")
    return _save(item)


def _headers(token: str) -> dict[str, str]:
    return {"Access-Token": token, "Content-Type": "application/json", "User-Agent": "BrandStrategyDataAgent/1.0"}


def _get_json(url: str, token: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urlencode({key: value for key, value in params.items() if value not in (None, "", [], {})}, doseq=True)
    request = Request(f"{url}?{query}", headers=_headers(token), method="GET")
    try:
        with urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(str(exc)) from exc


def _get_public_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    query = urlencode({key: value for key, value in params.items() if value not in (None, "", [], {})}, doseq=True)
    request = Request(f"{url}?{query}", headers={"User-Agent": "BrandStrategyDataAgent/1.0"}, method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(str(exc)) from exc


def _source_id(source: str, value: Any) -> str:
    return hashlib.sha256(f"{source}:{json.dumps(value, ensure_ascii=False, sort_keys=True)}".encode("utf-8")).hexdigest()[:20]


def _append_evidence(item: dict[str, Any], source: str, kind: str, data: Any, confidence: str, note: str = "") -> None:
    evidence = {"id": _source_id(source, data), "source": source, "kind": kind, "captured_at": _now(), "confidence": confidence, "note": note, "data": data}
    if not any(entry["id"] == evidence["id"] for entry in item["evidence"]):
        item["evidence"].append(evidence)


def _collect_oceanengine(item: dict[str, Any]) -> None:
    config = item["oceanengine"]
    token = str(config.get("access_token") or os.getenv("OCEANENGINE_ACCESS_TOKEN") or "").strip()
    advertiser_id = config.get("advertiser_id") or os.getenv("OCEANENGINE_ADVERTISER_ID")
    if not token or not advertiser_id:
        raise RuntimeError("巨量引擎搜索报表需要 access_token 和 advertiser_id")
    params = {
        "advertiser_id": advertiser_id,
        "dimensions": json.dumps(config.get("dimensions") or ["stat_time_day"], ensure_ascii=False),
        "metrics": json.dumps(config.get("metrics") or ["stat_cost", "show_cnt", "click_cnt", "convert_cnt"], ensure_ascii=False),
        "filters": json.dumps(config.get("filters") or [], ensure_ascii=False),
        "start_time": config.get("start_time"),
        "end_time": config.get("end_time"),
    }
    base = str(config.get("api_base") or os.getenv("OCEANENGINE_API_BASE") or OCEANENGINE_BASE).rstrip("/")
    result = _get_json(f"{base}{config.get('path') or OCEANENGINE_SEARCH_PATH}", token, params)
    _append_evidence(item, "巨量引擎搜索报表 API", "search_report", result, "authorized", "平台授权接口返回；字段口径以账户报表配置为准。")


def _collect_qianchuan(item: dict[str, Any]) -> None:
    config = item["qianchuan"]
    token = str(config.get("access_token") or os.getenv("QIANCHUAN_ACCESS_TOKEN") or "").strip()
    advertiser_id = config.get("advertiser_id") or os.getenv("QIANCHUAN_ADVERTISER_ID")
    if not token or not advertiser_id:
        raise RuntimeError("巨量千川投放报表需要 access_token 和 advertiser_id")
    params = {
        "advertiser_id": advertiser_id,
        "start_date": config.get("start_date"),
        "end_date": config.get("end_date"),
        "fields": json.dumps(config.get("fields") or ["stat_cost", "show_cnt", "click_cnt", "convert_cnt", "pay_order_amount"], ensure_ascii=False),
        "filtering": json.dumps(config.get("filtering") or {"marketing_goal": "ALL", "order_platform": "ALL", "marketing_scene": "ALL"}, ensure_ascii=False),
    }
    base = str(config.get("api_base") or os.getenv("QIANCHUAN_API_BASE") or OCEANENGINE_BASE).rstrip("/")
    result = _get_json(f"{base}{config.get('path') or QIANCHUAN_REPORT_PATH}", token, params)
    _append_evidence(item, "巨量千川账户投放数据 API", "qianchuan_report", result, "authorized", "平台授权接口返回；不代表自然流量或全店销售额。")


def _collect_brand_voice(item: dict[str, Any]) -> None:
    observations = item.get("brand_voice_observations") or []
    urls = item.get("source_urls") or []
    if observations:
        _append_evidence(item, "用户提供的品牌声量观察", "brand_voice", observations, "provided", "客户提供数据，需注明采集时间和口径。")
    if urls:
        _append_evidence(item, "用户提供的公开来源链接", "public_sources", urls, "public", "链接清单已登记；页面正文采集需遵守目标站点规则。")
    search_endpoint = str(item.get("brand_voice_search_endpoint") or os.getenv("BRAND_VOICE_SEARCH_ENDPOINT") or "").strip()
    if search_endpoint and item.get("keywords"):
        result = [_get_public_json(search_endpoint, {"q": keyword}) for keyword in item["keywords"]]
        _append_evidence(item, "配置的公开搜索 provider", "brand_voice_search", result, "public", "仅作为公开搜索信号；不等同于平台后台品牌声量。")
    elif item.get("keywords"):
        _append_evidence(item, "品牌声量关键词待采集", "brand_voice_queries", item["keywords"], "pending", "已登记关键词；配置 BRAND_VOICE_SEARCH_ENDPOINT 后可执行公开搜索采集。")
    if not observations and not urls and not item.get("keywords"):
        raise RuntimeError("品牌声量采集需要 keywords、source_urls 或 brand_voice_observations")


def _quality_gate(item: dict[str, Any]) -> None:
    sources = {entry["source"] for entry in item["evidence"]}
    checks = [
        {"key": "brand_name", "pass": bool(item.get("brand_name")), "message": "品牌名称已填写" if item.get("brand_name") else "缺少品牌名称"},
        {"key": "evidence_count", "pass": len(item["evidence"]) > 0, "message": f"已形成 {len(item['evidence'])} 条证据" if item["evidence"] else "尚无证据"},
        {"key": "source_trace", "pass": all(entry.get("source") and entry.get("captured_at") for entry in item["evidence"]), "message": "每条证据都有来源和采集时间"},
        {"key": "multi_source", "pass": len(sources) >= 2, "message": "至少包含两个来源" if len(sources) >= 2 else "建议补充第二类来源"},
        {"key": "authorized_metrics", "pass": any(entry.get("confidence") == "authorized" for entry in item["evidence"]), "message": "已接入授权平台数据" if any(entry.get("confidence") == "authorized" for entry in item["evidence"]) else "当前没有授权平台数据，销售/广告指标只能作为缺失项"},
    ]
    passed = sum(bool(check["pass"]) for check in checks)
    item["quality"] = {"status": "passed" if passed >= 4 else "partial" if passed >= 2 else "blocked", "coverage": round(passed / len(checks) * 100), "checks": checks, "source_count": len(sources)}


def run_collection(collection_id: str) -> dict[str, Any]:
    item = _load(collection_id)
    item["status"] = "running"
    item["updated_at"] = _now()
    item["errors"] = []
    _save(item)
    for collector in (_collect_oceanengine, _collect_qianchuan, _collect_brand_voice):
        try:
            collector(item)
        except RuntimeError as exc:
            item["errors"].append(str(exc))
    _quality_gate(item)
    item["status"] = "completed" if item["quality"]["status"] in {"passed", "partial"} else "blocked"
    item["updated_at"] = _now()
    return _save(item)


def get_collection(collection_id: str) -> dict[str, Any]:
    return _load(collection_id)


def collection_contract() -> dict[str, Any]:
    return {"agent": get_brand_data_agent(), "skills": get_brand_data_skills(), "providers": {"oceanengine_search_report": OCEANENGINE_SEARCH_PATH, "qianchuan_ads_report": QIANCHUAN_REPORT_PATH, "brand_voice": "public_sources_or_configured_search_provider"}}
