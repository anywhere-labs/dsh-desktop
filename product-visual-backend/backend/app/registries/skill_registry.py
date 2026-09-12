from __future__ import annotations

from copy import deepcopy


LIVECLIP_SKILLS = [
    {"id": "live_slice_editing_rules", "role": "decision", "boundary": "LiveClip 直播切片规则与验收核心；只负责判断和规划，不直接执行渲染或发布。"},
    {"id": "ffprobe_metadata_skill", "role": "execution", "boundary": "读取视频元信息。"},
    {"id": "ffmpeg_cut_skill", "role": "execution", "boundary": "裁剪单区间视频。"},
    {"id": "ffmpeg_concat_skill", "role": "execution", "boundary": "拼接多区间片段。"},
    {"id": "ffmpeg_caption_burn_skill", "role": "execution", "boundary": "烧录字幕。"},
    {"id": "ffmpeg_audio_mix_skill", "role": "execution", "boundary": "混合音效。"},
    {"id": "vertical_crop_skill", "role": "execution", "boundary": "生成竖屏构图。"},
    {"id": "caption_asset_skill", "role": "execution", "boundary": "生成字幕、花字和 caption assets。"},
    {"id": "jianying_exchange_skill", "role": "execution", "boundary": "生成剪映交换包/复建包，不承诺完整工程。"},
    {"id": "zip_delivery_skill", "role": "execution", "boundary": "生成交付 ZIP。"},
    {"id": "qa_matrix_skill", "role": "execution", "boundary": "执行 QA 检查矩阵。"},
]


def get_liveclip_skill_registry() -> list[dict]:
    return deepcopy(LIVECLIP_SKILLS)
