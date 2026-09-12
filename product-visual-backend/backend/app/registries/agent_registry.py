from __future__ import annotations

from copy import deepcopy



LIVECLIP_AGENTS = [
    {"id": "MaterialAgent", "role": "decision", "boundary": "校验素材和读取元信息，不执行媒体命令。"},
    {"id": "TranscriptAgent", "role": "decision", "boundary": "判断字幕来源和转写可用性。"},
    {"id": "HotspotAgent", "role": "decision", "boundary": "识别爆点、成交点和强钩子。"},
    {"id": "SegmentPlannerAgent", "role": "decision", "boundary": "规划并校验切片区间。"},
    {"id": "PackagingAgent", "role": "decision", "boundary": "决定字幕、花字、音效、转场与交付资产组织。"},
    {"id": "CopywritingAgent", "role": "decision", "boundary": "生成标题、文案、封面文案和话题标签。"},
    {"id": "QAAgent", "role": "decision", "boundary": "汇总 QA 结果并判断是否可审核、导出、重试。"},
    {"id": "DeliveryAgent", "role": "decision", "boundary": "把已有 artifacts 映射为客户交付包。"},
]

def get_liveclip_agent_registry() -> list[dict]:
    return deepcopy(LIVECLIP_AGENTS)
