def build_jianying_manifest(edit_plan: dict) -> dict:
    return {
        "status": "manual_rebuild_only",
        "warning": "当前不伪造官方完整项目格式，仅输出手动复刻 manifest。",
        "timeline": edit_plan.get("segments", []),
        "materials": [edit_plan.get("source_material", {})],
    }
