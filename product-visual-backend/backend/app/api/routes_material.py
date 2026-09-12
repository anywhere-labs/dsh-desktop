from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.material_service import list_materials, save_material

router = APIRouter()


@router.post("/api/material/upload")
async def upload_api(account_id: str = Form(...), script_id: str = Form(""), file_type: str = Form("video"), file: UploadFile = File(...), db: Session = Depends(get_db)):
    result = await save_material(db, file, account_id, script_id, file_type)
    return api_response(result["status"], "素材上传完成" if result["status"] == "ok" else "素材上传被阻塞", result.get("data"), "", result.get("missing_inputs"), result.get("warnings"), result.get("next_action"))


@router.get("/api/material/{account_id}")
def list_api(account_id: str, db: Session = Depends(get_db)):
    return api_response("ok", "素材列表", {"items": [{"id": x.id, "file_name": x.file_name, "file_path": x.file_path, "file_type": x.file_type, "duration": x.duration} for x in list_materials(db, account_id)]})


@router.post("/api/material/analyze")
def analyze_api(payload: dict):
    return api_response("partial", "素材分析预留，当前返回基础标签", {"tags": ["真人口播", "待抽帧", "待转写"]}, "", [], ["深度 OCR/转写在后续版本启用"], ["先进入自动剪辑或上传转写文件"])

