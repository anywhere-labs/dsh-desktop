def health() -> dict:
    return {"status": "blocked", "missing_inputs": ["external_skill"], "warnings": ["viral-video-analyzer 未安装"], "next_action": ["运行 python scripts/install_skills.py"]}

