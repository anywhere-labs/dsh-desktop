from fastapi import APIRouter

from backend.app.core.config import PORT
from backend.app.core.response import api_response

router = APIRouter()

JOBS: dict[str, dict] = {}


@router.get("/api/external/contract")
def contract():
    return api_response("ok", "外部系统合同", {
        "service": "short-video-growth-agent-os",
        "version": "0.1.0",
        "base_url": f"http://127.0.0.1:{PORT}",
        "capabilities": ["account_import", "diagnosis", "topic_plan", "script", "material_upload", "edit_export", "report_review", "attribution", "trace"],
    })


@router.post("/api/external/jobs")
def create_job(payload: dict):
    import uuid
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"job_id": job_id, "status": "blocked", "payload": payload, "missing_inputs": ["explicit_workflow"], "next_action": ["通过本系统 API 逐步执行闭环"]}
    return api_response("blocked", "外部任务已记录，等待明确 workflow", JOBS[job_id], "", ["explicit_workflow"], [], ["调用具体业务 API"])


@router.get("/api/external/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return api_response("blocked", "任务不存在", {}, "", ["job_id"], [], ["确认 job_id"])
    return api_response(job["status"], "任务状态", job, "", job.get("missing_inputs"), [], job.get("next_action"))
