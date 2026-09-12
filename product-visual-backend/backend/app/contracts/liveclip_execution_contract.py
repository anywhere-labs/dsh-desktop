from __future__ import annotations


LIVECLIP_EXECUTION_CONTRACT = {
    "LiveClipMaterialAgent": {
        "kind": "agent",
        "responsibility": "素材身份、媒体元数据和执行环境检查",
        "implementation": "live_clip_service.attach_material + probe_video + check_ffmpeg",
        "outputs": ["source_video_metadata", "ffmpeg_health"],
    },
    "LiveClipTranscriptAgent": {
        "kind": "agent_with_adapter",
        "responsibility": "ASR或上传SRT解析、canonical transcript revision",
        "implementation": "_transcribe_or_mock + live_clip_transcript_service",
        "outputs": ["transcript_segments", "srt", "ass", "timeline", "revision"],
    },
    "LiveClipShotDetectAgent": {
        "kind": "deterministic_skill",
        "responsibility": "静音事件和镜头切换候选检测，不做语义判断",
        "implementation": "_extract_scene_and_silence / FFmpeg",
        "outputs": ["scene_events", "silence_events"],
    },
    "LiveClipSegmentPlannerAgent": {
        "kind": "agent_with_rules",
        "responsibility": "从transcript和视觉证据生成ClipPlan/Storyboard",
        "implementation": "_segment_transcript + _score_segment + _rank_clip_candidates",
        "outputs": ["selected_clips", "storyboard_evidence", "timeline_mapping"],
    },
    "LiveClipRenderSkill": {
        "kind": "deterministic_skill",
        "responsibility": "按已验证ClipPlan和TimelineMapping执行媒体处理",
        "implementation": "_render_clip_files + multi_range_renderer + FFmpeg",
        "outputs": ["raw_mp4", "vertical_mp4", "final_mp4", "render_manifest"],
    },
    "flycut_caption_skill": {
        "kind": "deterministic_skill",
        "responsibility": "从canonical clip transcript编译SRT/ASS/效果点",
        "implementation": "flycut_caption_adapter.enhance_caption_assets",
        "outputs": ["srt", "ass", "caption_effect_points", "caption_qc"],
    },
    "LiveClipQAAgent": {
        "kind": "agent_with_rules",
        "responsibility": "验证内容证据、时间映射、媒体和交付文件",
        "implementation": "_build_clip_qa_result + schemas.live_clip_qa",
        "outputs": ["qa_result", "qa_issues", "repair_tasks"],
    },
    "JianyingProjectExportAgent": {
        "kind": "deterministic_skill",
        "responsibility": "输出剪映工程和交换格式，不重新决定剪辑",
        "implementation": "_write_jianying_project + _write_artifacts",
        "outputs": ["jianying_manifest", "timeline_json", "exchange_package"],
    },
}


def execution_contract_snapshot() -> dict:
    return {"version": "liveclip.execution.v1", "nodes": LIVECLIP_EXECUTION_CONTRACT}
