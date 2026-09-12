from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from backend.app.core.agent_registry import AgentRegistry
from backend.app.core.dag_persistence import DAGPersistenceStore
from backend.app.core.trace_logger import TraceLogger


@dataclass
class DAGNode:
    node: str
    agent: str
    depends_on: list[str] = field(default_factory=list)
    input: dict[str, Any] = field(default_factory=dict)


class DAGEngine:
    def __init__(
        self,
        *,
        agent_registry: AgentRegistry,
        trace_logger: TraceLogger | None = None,
        persistence: DAGPersistenceStore | None = None,
        max_retries: int = 1,
    ) -> None:
        self.agent_registry = agent_registry
        self.trace_logger = trace_logger or TraceLogger()
        self.persistence = persistence
        self.max_retries = max_retries

    def topological_sort(self, dag: list[dict[str, Any] | DAGNode]) -> list[DAGNode]:
        nodes = [self._coerce_node(item) for item in dag]
        by_name = {item.node: item for item in nodes}
        if len(by_name) != len(nodes):
            raise ValueError("dag contains duplicate node names")
        for item in nodes:
            missing = [dep for dep in item.depends_on if dep not in by_name]
            if missing:
                raise ValueError(f"node {item.node} has missing dependencies: {missing}")

        ordered: list[DAGNode] = []
        temporary: set[str] = set()
        permanent: set[str] = set()

        def visit(name: str) -> None:
            if name in permanent:
                return
            if name in temporary:
                raise ValueError("dag contains a cycle")
            temporary.add(name)
            for dependency in by_name[name].depends_on:
                visit(dependency)
            temporary.remove(name)
            permanent.add(name)
            ordered.append(by_name[name])

        for item in nodes:
            visit(item.node)
        return ordered

    def execute(
        self,
        *,
        task_id: str,
        dag: list[dict[str, Any] | DAGNode],
        context: dict[str, Any] | None = None,
        dag_id: str = "",
        resume: bool = False,
        stop_after_nodes: int | None = None,
    ) -> dict[str, Any]:
        context = dict(context or {})
        context.setdefault("completed_nodes", [])
        outputs: dict[str, Any] = self.persistence.completed_outputs(task_id) if (resume and self.persistence) else {}
        completed: set[str] = set(outputs.keys())
        if completed:
            context["completed_nodes"] = sorted(completed)
        ordered = self.topological_sort(dag)
        executed_this_run = 0

        for dag_node in ordered:
            if resume and dag_node.node in completed:
                continue
            if any(dependency not in completed for dependency in dag_node.depends_on):
                raise RuntimeError(f"dependencies not satisfied for node: {dag_node.node}")
            node_input = {
                **dag_node.input,
                "dependency_outputs": {
                    dependency: outputs[dependency]
                    for dependency in dag_node.depends_on
                    if dependency in outputs
                },
            }
            retry_count = 0
            while True:
                started_at = time.perf_counter()
                try:
                    output = self.agent_registry.execute(dag_node.agent, node_input, context)
                    outputs[dag_node.node] = output
                    completed.add(dag_node.node)
                    context["completed_nodes"] = sorted(completed)
                    if self.persistence:
                        self.persistence.checkpoint(
                            task_id=task_id,
                            node_id=dag_node.node,
                            status="ok",
                            node_input=node_input,
                            node_output=output,
                            retry_count=retry_count,
                        )
                    self.trace_logger.record(
                        task_id=task_id,
                        dag_id=dag_id,
                        node=dag_node.node,
                        agent=dag_node.agent,
                        status="ok",
                        worker=f"{self.agent_registry.get(dag_node.agent).worker_type}_worker",
                        node_input=node_input,
                        node_output=output,
                        started_at=started_at,
                        retry_count=retry_count,
                    )
                    executed_this_run += 1
                    break
                except Exception as exc:
                    if self.persistence:
                        self.persistence.checkpoint(
                            task_id=task_id,
                            node_id=dag_node.node,
                            status="failed",
                            node_input=node_input,
                            node_output={},
                            retry_count=retry_count,
                        )
                    self.trace_logger.record(
                        task_id=task_id,
                        dag_id=dag_id,
                        node=dag_node.node,
                        agent=dag_node.agent,
                        status="failed",
                        worker=f"{self.agent_registry.get(dag_node.agent).worker_type}_worker",
                        node_input=node_input,
                        started_at=started_at,
                        error=exc,
                        retry_count=retry_count,
                    )
                    if retry_count >= self.max_retries:
                        return {
                            "status": "failed",
                            "failed_node": dag_node.node,
                            "error": str(exc),
                            "outputs": outputs,
                            "trace": self.trace_logger.records(),
                        }
                    retry_count += 1
            if stop_after_nodes is not None and executed_this_run >= stop_after_nodes:
                return {
                    "status": "paused",
                    "outputs": outputs,
                    "order": [item.node for item in ordered],
                    "trace": self.trace_logger.records(),
                    "trace_index": self.trace_logger.trace_index(),
                    "trace_graph": self.trace_logger.graph(),
                    "trace_summary": self.trace_logger.summary(),
                }

        return {
            "status": "ok",
            "outputs": outputs,
            "order": [item.node for item in ordered],
            "trace": self.trace_logger.records(),
            "trace_index": self.trace_logger.trace_index(),
            "trace_graph": self.trace_logger.graph(),
            "trace_summary": self.trace_logger.summary(),
        }

    @staticmethod
    def _coerce_node(item: dict[str, Any] | DAGNode) -> DAGNode:
        if isinstance(item, DAGNode):
            return item
        return DAGNode(
            node=str(item["node"]),
            agent=str(item["agent"]),
            depends_on=[str(dep) for dep in item.get("depends_on") or []],
            input=dict(item.get("input") or {}),
        )
