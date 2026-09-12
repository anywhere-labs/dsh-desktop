from __future__ import annotations

from copy import deepcopy

BRAND_DATA_AGENT = {
    "id": "brand_data_collection_agent",
    "role": "orchestrator",
    "worker_type": "io",
    "capabilities": ["collect", "normalize", "dedupe", "evidence_snapshot", "quality_gate"],
    "boundary": "统一编排品牌数据采集与证据质量检查；不负责替代平台授权，也不把推断当作销售事实。",
}

BRAND_DATA_SKILLS = [
    {"id": "oceanengine_search_report_skill", "provider": "巨量引擎", "role": "collection", "boundary": "通过授权的巨量引擎报表能力采集搜索投放/关键词相关指标；需要 Access-Token、advertiser_id 和平台授权。"},
    {"id": "qianchuan_ads_report_skill", "provider": "巨量千川", "role": "collection", "boundary": "通过千川账户投放数据接口采集广告、计划、商品和投放指标；需要 Access-Token、advertiser_id 和权限。"},
    {"id": "brand_voice_search_skill", "provider": "公开来源", "role": "collection", "boundary": "采集用户提供的公开搜索结果、品牌关键词和公开页面快照；输出声量信号，不声称拥有平台后台真实声量。"},
    {"id": "brand_evidence_normalize_skill", "provider": "本地", "role": "execution", "boundary": "统一字段、来源、时间、平台和事实/推断标签，执行去重。"},
    {"id": "brand_data_quality_gate_skill", "provider": "本地", "role": "qa", "boundary": "检查覆盖率、来源可信度、时间有效性、样本量和缺失字段，决定是否可生成真实数据报告。"},
]


def get_brand_data_agent() -> dict:
    return deepcopy(BRAND_DATA_AGENT)


def get_brand_data_skills() -> list[dict]:
    return deepcopy(BRAND_DATA_SKILLS)
