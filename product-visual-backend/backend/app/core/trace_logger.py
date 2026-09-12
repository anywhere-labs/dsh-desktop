from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TraceRecord:
    trace_id: str
    task_id: str
    dag_id: str
    node: str
    agent: str
    status: str
    worker: str = ""
    node_input: dict[str, Any] = field(default_factory=dict)
    node_output: dict[str, Any] = field(default_factory=dict)
    execution_time_ms: float = 0
    errors: list[str] = field(default_factory=list)
    retry_count: int = 0


class TraceLogger:
    def __init__(self) -> None:
        self._records: list[TraceRecord] = []

    def record(
        self,
        *,
        task_id: str,
        dag_id: str = "",
        node: str,
        agent: str,
        status: str,
        worker: str = "",
        node_input: dict[str, Any] | None = None,
        node_output: dict[str, Any] | None = None,
        started_at: float | None = None,
        error: Exception | None = None,
        retry_count: int = 0,
    ) -> TraceRecord:
        elapsed = 0.0
        if started_at is not None:
            elapsed = round((time.perf_counter() - started_at) * 1000, 3)
        record = TraceRecord(
            trace_id=uuid.uuid4().hex,
            task_id=task_id,
            dag_id=dag_id,
            node=node,
            agent=agent,
            status=status,
            worker=worker,
            node_input=node_input or {},
            node_output=node_output or {},
            execution_time_ms=elapsed,
            errors=[str(error)] if error else [],
            retry_count=retry_count,
        )
        self._records.append(record)
        return record

    def records(self) -> list[dict[str, Any]]:
        return [
            {
                "trace_id": item.trace_id,
                "task_id": item.task_id,
                "dag_id": item.dag_id,
                "node_id": item.node,
                "node": item.node,
                "agent": item.agent,
                "status": item.status,
                "worker": item.worker,
                "node_input": item.node_input,
                "node_output": item.node_output,
                "execution_time_ms": item.execution_time_ms,
                "errors": item.errors,
                "retry_count": item.retry_count,
            }
            for item in self._records
        ]

    def summary(self) -> dict[str, Any]:
        records = self.records()
        return {
            "total": len(records),
            "ok": sum(1 for item in records if item["status"] == "ok"),
            "failed": sum(1 for item in records if item["status"] == "failed"),
            "execution_time_ms": round(sum(item["execution_time_ms"] for item in records), 3),
        }

    def trace_index(self) -> dict[str, dict[str, Any]]:
        return {item["node_id"]: item for item in self.records()}

    def graph(self) -> dict[str, Any]:
        records = self.records()
        return {
            "task_id": records[0]["task_id"] if records else "",
            "dag_id": records[0]["dag_id"] if records else "",
            "nodes": [
                {
                    "node_id": item["node_id"],
                    "status": item["status"],
                    "worker": item["worker"],
                    "duration": item["execution_time_ms"],
                    "retry_count": item["retry_count"],
                }
                for item in records
            ],
            "retry_history": [
                item for item in records if item["retry_count"] or item["status"] == "failed"
            ],
            "worker_assignments": [
                {
                    "node_id": item["node_id"],
                    "agent": item["agent"],
                    "worker": item["worker"],
                }
                for item in records
                if item["worker"]
            ],
        }
