from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from backend.app.registries.brand_data_registry import BRAND_DATA_AGENT


AgentHandler = Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class AgentDefinition:
    name: str
    worker_type: str
    capabilities: list[str] = field(default_factory=list)
    description: str = ""
    handler: AgentHandler | None = None


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[str, AgentDefinition] = {}

    def register(self, definition: AgentDefinition) -> None:
        if definition.worker_type not in {"cpu", "gpu", "io"}:
            raise ValueError(f"unsupported worker_type: {definition.worker_type}")
        self._agents[definition.name] = definition

    def get(self, name: str) -> AgentDefinition:
        try:
            return self._agents[name]
        except KeyError as exc:
            raise KeyError(f"agent not registered: {name}") from exc

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "name": item.name,
                "worker_type": item.worker_type,
                "capabilities": item.capabilities,
                "description": item.description,
            }
            for item in self._agents.values()
        ]

    def execute(
        self,
        agent_name: str,
        node_input: dict[str, Any],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        definition = self.get(agent_name)
        if definition.handler:
            return definition.handler(node_input, context)
        return {
            "agent": definition.name,
            "worker_type": definition.worker_type,
            "status": "ok",
            "input_keys": sorted(node_input.keys()),
            "capabilities": definition.capabilities,
        }


def _default_handler(node_input: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "ok",
        "node_input": node_input,
        "completed_dependencies": sorted(context.get("completed_nodes", [])),
    }


def build_default_agent_registry() -> AgentRegistry:
    from backend.app.services.brand_workflow_service import brand_workflow_handler

    registry = AgentRegistry()
    for definition in [
        AgentDefinition(
            name="ffmpeg_agent",
            worker_type="cpu",
            capabilities=["probe", "scene_detect", "silence_detect", "cut"],
            description="FFmpeg 素材检测与切片调度代理；实际媒体执行仍走 v1.3.1 liveclip 主链。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name="whisper_agent",
            worker_type="gpu",
            capabilities=["transcribe", "timestamp_segments"],
            description="Whisper/FunASR 转写调度代理；不改动现有 ASR 实现。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name="scene_detect_agent",
            worker_type="cpu",
            capabilities=["scene_detect", "silence_detect"],
            description="场景与静音检测调度代理。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name="clip_score_agent",
            worker_type="cpu",
            capabilities=["score", "rank", "select"],
            description="切片评分与候选选择代理。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name="caption_agent",
            worker_type="gpu",
            capabilities=["srt", "caption_asset", "caption_burn"],
            description="字幕与花字资产调度代理。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name="delivery_agent",
            worker_type="io",
            capabilities=["manifest", "summary", "zip_delivery"],
            description="交付包调度代理；复用 v1.3.1 delivery package 服务。",
            handler=_default_handler,
        ),
        AgentDefinition(
            name=BRAND_DATA_AGENT["id"],
            worker_type=BRAND_DATA_AGENT["worker_type"],
            capabilities=BRAND_DATA_AGENT["capabilities"],
            description=BRAND_DATA_AGENT["boundary"],
            handler=_default_handler,
        ),
        AgentDefinition(
            name="brand_strategy_workflow_agent",
            worker_type="io",
            capabilities=["workflow_orchestration", "listing_context", "campaign_simulation", "strategy_generation", "quality_gate"],
            description="品牌营销全链路工作流 Agent；负责业务节点编排，不替代平台授权和数据真实性校验。",
            handler=brand_workflow_handler,
        ),
        *[
            AgentDefinition(
                name=f"{role}_agent",
                worker_type="io",
                capabilities=["propose", "evidence_bound", "feedback_ready"],
                description=f"{role} Agent：围绕统一经营目标提交独立方案，不直接覆盖其他 Agent 结论。",
                handler=brand_workflow_handler,
            )
            for role in ["strategy", "growth", "product", "content", "live", "customer", "supply", "fulfillment", "finance"]
        ],
    ]:
        registry.register(definition)
    return registry


default_agent_registry = build_default_agent_registry()
