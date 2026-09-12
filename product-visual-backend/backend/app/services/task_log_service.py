from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from backend.app.core.paths import LOGS_DIR, PROJECT_ROOT


TASK_LOG_DIR = LOGS_DIR / "tasks"


def append_task_log(module: str, task_id: str, step: str, status: str, payload: dict | None = None, error: str = "") -> str:
    TASK_LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = TASK_LOG_DIR / f"{module}_{task_id}.jsonl"
    item = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "module": module,
        "task_id": task_id,
        "step": step,
        "status": status,
        "payload": payload or {},
        "error": error,
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    return _rel(path)


def read_task_logs(module: str, task_id: str) -> list[dict]:
    path = TASK_LOG_DIR / f"{module}_{task_id}.jsonl"
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def check_export_files(module: str, task_id: str, downloads: list[dict]) -> dict:
    checked = []
    missing = []
    for item in downloads:
        rel = item.get("path") or _url_to_rel_path(item.get("url", ""))
        exists = bool(rel and (PROJECT_ROOT / rel).exists())
        size = (PROJECT_ROOT / rel).stat().st_size if exists else 0
        row = {**item, "path": rel, "exists": exists, "size": size}
        checked.append(row)
        if not exists or size <= 0:
            missing.append(item.get("type") or item.get("name") or rel)
    status = "ok" if not missing else "failed"
    append_task_log(module, task_id, "export_file_check", status, {"checked": checked, "missing": missing})
    return {"status": status, "checked": checked, "missing": missing}


def _url_to_rel_path(url: str) -> str:
    if "/files/exports/" not in url:
        return ""
    parts = url.strip("/").split("/")
    # api/product-visual/tasks/{task_id}/files/exports/{name}
    if len(parts) >= 7 and parts[0] == "api" and parts[1] == "product-visual":
        task_id = parts[3]
        name = parts[-1]
        return f"storage/product_visual/{task_id}/exports/{name}"
    return ""


def _rel(path: Path) -> str:
    return path.resolve().relative_to(PROJECT_ROOT).as_posix()
