from __future__ import annotations

import heapq
import itertools
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass(order=True)
class QueuedTask:
    priority: int
    sequence: int
    task_id: str = field(compare=False)
    node: str = field(compare=False)
    agent: str = field(compare=False)
    worker_type: str = field(compare=False)
    payload: dict[str, Any] = field(default_factory=dict, compare=False)
    lease_id: str = field(default="", compare=False)
    leased_until: float = field(default=0.0, compare=False)


class TaskQueueManager:
    def __init__(self, *, lease_seconds: int = 30) -> None:
        self._counter = itertools.count()
        self.lease_seconds = lease_seconds
        self._queues: dict[str, list[QueuedTask]] = {
            "liveclip_queue": [],
            "gpu_queue": [],
            "cpu_queue": [],
            "io_queue": [],
        }
        self._leases: dict[str, QueuedTask] = {}
        self._workers: dict[str, dict[str, Any]] = {}
        self._assignments: list[dict[str, Any]] = []

    def push(
        self,
        queue_name: str,
        *,
        task_id: str,
        node: str,
        agent: str,
        worker_type: str,
        payload: dict[str, Any] | None = None,
        priority: int = 100,
    ) -> QueuedTask:
        if queue_name not in self._queues:
            raise ValueError(f"unsupported queue: {queue_name}")
        if worker_type not in {"cpu", "gpu", "io"}:
            raise ValueError(f"unsupported worker_type: {worker_type}")
        item = QueuedTask(
            priority=priority,
            sequence=next(self._counter),
            task_id=task_id,
            node=node,
            agent=agent,
            worker_type=worker_type,
            payload=payload or {},
        )
        heapq.heappush(self._queues[queue_name], item)
        return item

    def push_for_worker(self, *, worker_type: str, **kwargs: Any) -> QueuedTask:
        queue_name = {
            "gpu": "gpu_queue",
            "io": "io_queue",
            "cpu": "cpu_queue",
        }[worker_type]
        return self.push(queue_name, worker_type=worker_type, **kwargs)

    def push_for_agent(self, *, agent: str, **kwargs: Any) -> QueuedTask:
        if agent in {"whisper_agent", "caption_agent"}:
            return self.push_for_worker(worker_type="gpu", agent=agent, **kwargs)
        if agent == "delivery_agent":
            return self.push_for_worker(worker_type="io", agent=agent, **kwargs)
        return self.push_for_worker(worker_type="cpu", agent=agent, **kwargs)

    def pop(self, queue_name: str) -> QueuedTask | None:
        if queue_name not in self._queues:
            raise ValueError(f"unsupported queue: {queue_name}")
        if not self._queues[queue_name]:
            return None
        return heapq.heappop(self._queues[queue_name])

    def assign_worker(
        self,
        queue_name: str,
        worker_id: str,
        *,
        now: float | None = None,
    ) -> dict[str, Any] | None:
        now = _now(now)
        worker = self._workers.get(worker_id)
        if worker and worker.get("locked") and worker.get("lease_id") in self._leases:
            return None
        item = self.pop(queue_name)
        if item is None:
            return None
        item.lease_id = uuid.uuid4().hex
        item.leased_until = now + self.lease_seconds
        self._leases[item.lease_id] = item
        self._workers[worker_id] = {
            "worker_id": worker_id,
            "worker_type": item.worker_type,
            "locked": True,
            "lease_id": item.lease_id,
            "last_heartbeat": now,
        }
        assignment = {
            "worker_id": worker_id,
            "queue": queue_name,
            "task_id": item.task_id,
            "node": item.node,
            "agent": item.agent,
            "worker_type": item.worker_type,
            "priority": item.priority,
            "lease_id": item.lease_id,
            "leased_until": item.leased_until,
        }
        self._assignments.append(assignment)
        return assignment

    def heartbeat(self, worker_id: str, *, now: float | None = None) -> bool:
        worker = self._workers.get(worker_id)
        if not worker:
            return False
        now = _now(now)
        worker["last_heartbeat"] = now
        lease = self._leases.get(str(worker.get("lease_id")))
        if lease:
            lease.leased_until = now + self.lease_seconds
            worker["locked"] = True
        return True

    def complete_lease(self, lease_id: str) -> bool:
        lease = self._leases.pop(lease_id, None)
        if lease is None:
            return False
        for worker in self._workers.values():
            if worker.get("lease_id") == lease_id:
                worker["locked"] = False
                worker["lease_id"] = ""
        return True

    def reclaim_expired_leases(self, *, now: float | None = None) -> list[dict[str, Any]]:
        now = _now(now)
        expired = [
            (lease_id, item)
            for lease_id, item in self._leases.items()
            if item.leased_until <= now
        ]
        reclaimed: list[dict[str, Any]] = []
        for lease_id, item in expired:
            self._leases.pop(lease_id, None)
            item.lease_id = ""
            item.leased_until = 0.0
            queue_name = {
                "gpu": "gpu_queue",
                "io": "io_queue",
                "cpu": "cpu_queue",
            }[item.worker_type]
            heapq.heappush(self._queues[queue_name], item)
            for worker in self._workers.values():
                if worker.get("lease_id") == lease_id:
                    worker["locked"] = False
                    worker["lease_id"] = ""
            reclaimed.append({"task_id": item.task_id, "node": item.node, "agent": item.agent})
        return reclaimed

    def snapshot(self) -> dict[str, Any]:
        return {
            "queues": {
                name: [
                    {
                        "task_id": item.task_id,
                        "node": item.node,
                        "agent": item.agent,
                        "worker_type": item.worker_type,
                        "priority": item.priority,
                    }
                    for item in sorted(queue)
                ]
                for name, queue in self._queues.items()
            },
            "leases": {
                lease_id: {
                    "task_id": item.task_id,
                    "node": item.node,
                    "agent": item.agent,
                    "worker_type": item.worker_type,
                    "leased_until": item.leased_until,
                }
                for lease_id, item in self._leases.items()
            },
            "workers": dict(self._workers),
            "assignments": list(self._assignments),
        }


def _now(value: float | None = None) -> float:
    if value is not None:
        return float(value)
    import time

    return time.time()
