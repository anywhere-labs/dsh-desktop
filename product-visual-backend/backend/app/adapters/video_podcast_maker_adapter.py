def health() -> dict:
    return {"status": "blocked", "missing_inputs": ["external_skill"], "warnings": ["video-podcast-maker 未安装"], "next_action": ["运行 python scripts/install_skills.py"]}

