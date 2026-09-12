from __future__ import annotations

from copy import deepcopy


_TEMPLATES = [
    {
        "id": "douyin_apparel_detail_conversion_v1",
        "name": "抖音女装细节转化 V1",
        "version": "1.2.0",
        "description": "细节先行的女装高转化包装模板。",
        "duration_range": [30, 45],
        "overlay_count_range": [4, 6],
        "sfx_count_range": [3, 5],
        "hook_within_seconds": 3,
        "subtitle_safe_area": "mobile_bottom_safe",
        "detail_before_full_body": True,
        "benefit_conclusion_required": True,
        "keyword_hints": ["面料", "刺绣", "层次", "版型", "显瘦", "轻透", "上身"],
        "style": {
            "font_size": 60,
            "primary": "&H00FFFFFF",
            "secondary": "&H0000D7FF",
            "outline": "&H00202020",
            "back": "&H88000000",
            "margin_v": 260,
        },
    },
    {
        "id": "douyin_apparel_fabric_detail_v1",
        "name": "抖音女装面料细节 V1",
        "version": "1.2.0",
        "description": "强调面料质感和细节卖点的包装模板。",
        "duration_range": [25, 40],
        "overlay_count_range": [4, 6],
        "sfx_count_range": [2, 4],
        "hook_within_seconds": 3,
        "subtitle_safe_area": "mobile_bottom_safe",
        "detail_before_full_body": True,
        "benefit_conclusion_required": True,
        "keyword_hints": ["肌理", "垂感", "柔软", "透气", "轻盈", "细节"],
        "style": {
            "font_size": 58,
            "primary": "&H00FFFFFF",
            "secondary": "&H00B2E6FF",
            "outline": "&H00202A30",
            "back": "&H88401818",
            "margin_v": 250,
        },
    },
    {
        "id": "douyin_apparel_compare_review_v1",
        "name": "抖音女装对比测评 V1",
        "version": "1.2.0",
        "description": "适合对比款式、版型和上身差异的测评模板。",
        "duration_range": [35, 50],
        "overlay_count_range": [5, 7],
        "sfx_count_range": [3, 5],
        "hook_within_seconds": 3,
        "subtitle_safe_area": "mobile_bottom_safe",
        "detail_before_full_body": False,
        "benefit_conclusion_required": True,
        "keyword_hints": ["对比", "区别", "版型", "显瘦", "优缺点", "推荐"],
        "style": {
            "font_size": 58,
            "primary": "&H00FFFFFF",
            "secondary": "&H0063E6FF",
            "outline": "&H00111111",
            "back": "&H88000000",
            "margin_v": 238,
        },
    },
    {
        "id": "douyin_live_conversion_clip_v1",
        "name": "抖音直播转化切片 V1",
        "version": "1.2.0",
        "description": "适合直播转单、利益点和行动指令明确的转化模板。",
        "duration_range": [35, 55],
        "overlay_count_range": [3, 5],
        "sfx_count_range": [2, 4],
        "hook_within_seconds": 3,
        "subtitle_safe_area": "mobile_bottom_safe",
        "detail_before_full_body": False,
        "benefit_conclusion_required": True,
        "keyword_hints": ["福利", "优惠", "限时", "库存", "下单", "转化"],
        "style": {
            "font_size": 60,
            "primary": "&H00FFFFFF",
            "secondary": "&H002929FF",
            "outline": "&H00000000",
            "back": "&HAA000000",
            "margin_v": 245,
        },
    },
]


def get_template_registry() -> list[dict]:
    return deepcopy(_TEMPLATES)


def resolve_template(template_id: str) -> dict:
    for item in _TEMPLATES:
        if item["id"] == template_id:
            return deepcopy(item)
    raise KeyError(template_id)


def get_style_presets() -> dict[str, dict]:
    presets: dict[str, dict] = {}
    for item in _TEMPLATES:
        presets[item["id"]] = {
            "name": item["name"],
            **deepcopy(item["style"]),
            "business_rules": {
                "target_duration_seconds": deepcopy(item["duration_range"]),
                "hook_deadline_seconds": item["hook_within_seconds"],
                "effect_point_range": deepcopy(item["overlay_count_range"]),
                "sfx_cue_range": deepcopy(item["sfx_count_range"]),
                "detail_before_full_body": item["detail_before_full_body"],
                "benefit_conclusion_required": item["benefit_conclusion_required"],
                "subtitle_safe_area": item["subtitle_safe_area"],
            },
            "keyword_hints": deepcopy(item["keyword_hints"]),
            "template_version": item["version"],
        }
    return presets
