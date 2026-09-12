def build_edit_plan(script: dict, material: dict) -> dict:
    return {
        "provider": "basic_ffmpeg",
        "goal": "生成客户可预览短视频",
        "source_material": material,
        "script_title": script.get("title", ""),
        "segments": [
            {"start": 0, "end": 3, "purpose": "3秒钩子"},
            {"start": 3, "end": 15, "purpose": "痛点解释"},
            {"start": 15, "end": 30, "purpose": "证明与 CTA"},
        ],
    }

