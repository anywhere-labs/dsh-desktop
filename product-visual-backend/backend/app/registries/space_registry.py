from __future__ import annotations

from copy import deepcopy

from backend.app.registries.agent_registry import LIVECLIP_AGENTS
from backend.app.registries.skill_registry import LIVECLIP_SKILLS
from backend.app.services.live_clip_template_registry import get_template_registry


LIVECLIP_CUSTOMER_STATES = [
    "draft",
    "material_ready",
    "generating",
    "preview_ready",
    "needs_review",
    "revision_requested",
    "approved",
    "packaging",
    "package_ready",
    "delivered",
    "failed",
]


def get_liveclip_space_registry() -> dict:
    return {
        "space_name": "LiveClipDistributionSpace",
        "scenario": ["直播切片", "女装种草", "商品成交型短视频"],
        "agents": deepcopy(LIVECLIP_AGENTS),
        "skills": deepcopy(LIVECLIP_SKILLS),
        "templates": get_template_registry(),
        "customer_states": list(LIVECLIP_CUSTOMER_STATES),
        "internal_states": ["transcribing", "planning", "rendering", "qa", "exporting"],
        "delivery_boundary": "Jianying/CapCut 产物只作为交换包或复建包。",
    }
