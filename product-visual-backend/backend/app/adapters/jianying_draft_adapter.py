def export_draft() -> dict:
    return {"status": "blocked", "missing_inputs": ["jianying_draft_adapter"], "warnings": ["当前不伪造官方完整项目格式"], "next_action": ["使用 jianying_project_manifest.json 手动复刻"]}
