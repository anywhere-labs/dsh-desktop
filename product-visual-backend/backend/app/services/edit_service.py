from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from backend.app.core.paths import EXPORTS_DIR, PROJECT_ROOT, rel_path
from backend.app.media.basic_editor import export_preview
from backend.app.models.edit import EditExport, EditProject
from backend.app.models.material import Material
from backend.app.models.script import Script


def create_edit_project(db: Session, payload: dict) -> EditProject:
    project = EditProject(id=uuid.uuid4().hex, account_id=payload["account_id"], script_id=payload.get("script_id", ""), material_batch_id=payload.get("material_id", ""), status="created")
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def get_edit_project(db: Session, edit_project_id: str) -> EditProject | None:
    return db.get(EditProject, edit_project_id)


def export_edit(db: Session, project: EditProject) -> dict:
    script = db.get(Script, project.script_id) if project.script_id else None
    material = db.get(Material, project.material_batch_id) if project.material_batch_id else None
    if not material:
        return {"status": "blocked", "missing_inputs": ["raw_video"], "warnings": ["没有真实视频素材，不能生成 mp4"], "next_action": ["请上传 MP4 / MOV 原片"], "data": {}}
    script_json = script.script_json if script else {"title": "短视频预览"}
    out_dir = EXPORTS_DIR / project.id
    result = export_preview(PROJECT_ROOT / material.file_path, out_dir, script_json, {"material_id": material.id, "file_path": material.file_path})
    if result["status"] == "ok":
        data = result["data"]
        export = EditExport(id=uuid.uuid4().hex, edit_project_id=project.id, mp4_path=rel_path(Path(data["mp4_path"])), mov_path=rel_path(Path(data["mov_path"])) if data.get("mov_path") else "", srt_path=rel_path(Path(data["srt_path"])), download_url=f"/api/edit/{project.id}/download/mp4")
        db.add(export)
        project.status = "exported"
        project.edit_plan_json = {
            "path": rel_path(Path(data["edit_plan_path"])),
            "skills": data.get("skills", {}),
            "skill_outputs": data.get("skill_outputs", {}),
        }
        project.jianying_manifest_json = {"path": rel_path(Path(data["jianying_manifest_path"]))}
        db.commit()
        result["data"] = {
            **data,
            "mp4_path": rel_path(Path(data["mp4_path"])),
            "clean_mp4_path": rel_path(Path(data["clean_mp4_path"])),
            "mov_path": rel_path(Path(data["mov_path"])) if data.get("mov_path") else "",
            "srt_path": rel_path(Path(data["srt_path"])),
            "ass_path": rel_path(Path(data["ass_path"])),
            "caption_style_json": rel_path(Path(data["caption_style_json"])),
            "caption_effect_points_json": rel_path(Path(data["caption_effect_points_json"])),
            "caption_qc_report": rel_path(Path(data["caption_qc_report"])),
            "edit_plan_path": rel_path(Path(data["edit_plan_path"])),
            "jianying_manifest_path": rel_path(Path(data["jianying_manifest_path"])),
            "manual_readme_path": rel_path(Path(data["manual_readme_path"])),
            "edit_export_id": export.id,
        }
    return result
