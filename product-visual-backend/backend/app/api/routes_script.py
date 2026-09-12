from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.script_service import get_script, material_plan, revise_script

router = APIRouter()


@router.get("/api/script/{script_id}")
def get_api(script_id: str, db: Session = Depends(get_db)):
    script = get_script(db, script_id)
    if not script:
        return api_response("blocked", "脚本不存在", {}, "", ["script_id"], [], ["先生成脚本"])
    return api_response("ok", "脚本详情", {"script_id": script.id, "script": script.script_json})


@router.post("/api/script/{script_id}/revise")
def revise_api(script_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    script = get_script(db, script_id)
    if not script:
        return api_response("blocked", "脚本不存在", {}, "", ["script_id"], [], ["先生成脚本"])
    trace_id, output = revise_script(db, script, payload or {})
    return api_response("ok", "脚本已修订", output, trace_id)


@router.get("/api/script/{script_id}/material-plan")
def material_plan_api(script_id: str, db: Session = Depends(get_db)):
    script = get_script(db, script_id)
    if not script:
        return api_response("blocked", "脚本不存在", {}, "", ["script_id"], [], ["先生成脚本"])
    trace_id, output = material_plan(db, script)
    return api_response("ok", "拍摄素材清单已生成", output, trace_id)

