from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.paths import PROJECT_ROOT
from backend.app.core.response import api_response
from backend.app.models.edit import EditExport
from backend.app.services.edit_service import create_edit_project, export_edit, get_edit_project

router = APIRouter()


@router.post("/api/edit/create")
def create_api(payload: dict, db: Session = Depends(get_db)):
    if not payload.get("account_id"):
        return api_response("blocked", "缺少账号", {}, "", ["account_id"], [], ["先导入账号"])
    project = create_edit_project(db, payload)
    return api_response("ok", "剪辑项目已创建", {"edit_project_id": project.id})


@router.get("/api/edit/{edit_project_id}")
def get_api(edit_project_id: str, db: Session = Depends(get_db)):
    project = get_edit_project(db, edit_project_id)
    if not project:
        return api_response("blocked", "剪辑项目不存在", {}, "", ["edit_project_id"], [], ["先创建剪辑项目"])
    return api_response("ok", "剪辑项目详情", {"id": project.id, "status": project.status, "edit_plan": project.edit_plan_json, "jianying_manifest": project.jianying_manifest_json})


@router.post("/api/edit/{edit_project_id}/export")
def export_api(edit_project_id: str, db: Session = Depends(get_db)):
    project = get_edit_project(db, edit_project_id)
    if not project:
        return api_response("blocked", "剪辑项目不存在", {}, "", ["edit_project_id"], [], ["先创建剪辑项目"])
    result = export_edit(db, project)
    return api_response(result["status"], "导出完成" if result["status"] == "ok" else "导出未完成", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


def _download(db: Session, edit_project_id: str, field: str):
    export = db.query(EditExport).filter(EditExport.edit_project_id == edit_project_id).first()
    if not export or not getattr(export, field):
        return api_response("blocked", "文件不存在", {}, "", [field], [], ["先执行导出"])
    path = PROJECT_ROOT / getattr(export, field)
    return FileResponse(path)


@router.get("/api/edit/{edit_project_id}/download/mp4")
def download_mp4(edit_project_id: str, db: Session = Depends(get_db)):
    return _download(db, edit_project_id, "mp4_path")


@router.get("/api/edit/{edit_project_id}/download/mov")
def download_mov(edit_project_id: str, db: Session = Depends(get_db)):
    return _download(db, edit_project_id, "mov_path")


@router.get("/api/edit/{edit_project_id}/download/edit-plan")
def download_edit_plan(edit_project_id: str, db: Session = Depends(get_db)):
    path = PROJECT_ROOT / "storage" / "exports" / edit_project_id / "edit_plan.json"
    return FileResponse(path) if path.exists() else api_response("blocked", "edit_plan 不存在", {}, "", ["edit_plan"], [], ["先执行导出"])


@router.get("/api/edit/{edit_project_id}/download/jianying-manifest")
def download_manifest(edit_project_id: str, db: Session = Depends(get_db)):
    path = PROJECT_ROOT / "storage" / "exports" / edit_project_id / "jianying_project_manifest.json"
    return FileResponse(path) if path.exists() else api_response("blocked", "manifest 不存在", {}, "", ["jianying_manifest"], [], ["先执行导出"])

