from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class DAGPersistenceStore:
    """Append-only node checkpoint store for v1.4 DAG execution.

    This intentionally stays outside the v1.3 liveclip media pipeline. It
    persists scheduler state only, so failed orchestration can resume without
    rewriting FFmpeg/ASR/QA/delivery behavior.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def checkpoint(
        self,
        *,
        task_id: str,
        node_id: str,
        status: str,
        node_input: dict[str, Any] | None = None,
        node_output: dict[str, Any] | None = None,
        retry_count: int = 0,
    ) -> dict[str, Any]:
        record = {
            "task_id": task_id,
            "node_id": node_id,
            "status": status,
            "input": node_input or {},
            "output": node_output or {},
            "retry_count": retry_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        return record

    def load_task_state(self, task_id: str) -> list[dict[str, Any]]:
        states: dict[str, dict[str, Any]] = {}
        for record in self._read_all():
            if record.get("task_id") != task_id:
                continue
            states[str(record.get("node_id"))] = record
        return list(states.values())

    def completed_outputs(self, task_id: str) -> dict[str, Any]:
        return {
            item["node_id"]: item.get("output") or {}
            for item in self.load_task_state(task_id)
            if item.get("status") == "ok"
        }

    def completed_node_ids(self, task_id: str) -> set[str]:
        return set(self.completed_outputs(task_id).keys())

    def load_all(self) -> list[dict[str, Any]]:
        return self._read_all()

    def _read_all(self) -> list[dict[str, Any]]:
        if not self.path.is_file():
            return []
        records: list[dict[str, Any]] = []
        with self._lock:
            for line in self.path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return records
