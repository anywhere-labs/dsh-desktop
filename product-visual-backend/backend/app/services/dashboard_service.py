from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models.account import Account
from backend.app.models.edit import EditExport
from backend.app.models.material import Material
from backend.app.models.product_visual import ProductVisualTask
from backend.app.models.task import Task, TaskResult
from backend.app.models.topic import ContentTopic
from backend.app.models.trace import TraceEvent
from backend.app.services.api_settings_service import read_settings


def _iso(value) -> str:
    return value.isoformat(timespec="seconds") if value else ""


VERIFICATION_MARKERS = ("test", "smoke", "demo", "validation", "verify", "canary", "acceptance", "fixture")


def _is_verification_record(value: str) -> bool:
    normalized = str(value or "").lower()
    return any(marker in normalized for marker in VERIFICATION_MARKERS)


def _task_row(item: Task) -> dict:
    return {
        "id": item.id,
        "type": item.task_type,
        "workflow": item.workflow,
        "account_id": item.account_id,
        "status": item.status,
        "review_status": item.review_status,
        "trace_id": item.trace_id,
        "updated_at": _iso(item.updated_at),
    }


def _trace_row(item: TraceEvent) -> dict:
    return {
        "id": item.id,
        "trace_id": item.trace_id,
        "stage": item.stage,
        "agent_name": item.agent_name,
        "account_id": item.account_id or "",
        "model_name": item.model_name,
        "status": item.status,
        "duration_ms": item.duration_ms,
        "error": item.error_message,
        "created_at": _iso(item.created_at),
    }


def dashboard(db: Session) -> dict:
    all_tasks = list(db.scalars(select(Task).order_by(Task.updated_at.desc())))
    verification_tasks = [item for item in all_tasks if _is_verification_record(item.account_id)]
    tasks = [item for item in all_tasks if not _is_verification_record(item.account_id)]
    recent_tasks = tasks[:8]
    trace_candidates = list(db.scalars(select(TraceEvent).order_by(TraceEvent.created_at.desc()).limit(120)))
    recent_traces = [item for item in trace_candidates if not _is_verification_record(item.account_id or "")][:12]
    operational_task_ids = {item.id for item in tasks}
    result_statuses = [
        status for task_id, status in db.execute(select(TaskResult.task_id, TaskResult.status)).all()
        if task_id in operational_task_ids
    ]
    success_count = sum(status in {"ok", "completed", "success"} for status in result_statuses)
    routes = read_settings().get("routes", [])
    status_counts = Counter(item.status or "unknown" for item in tasks)
    liveclip_count = sum(item.task_type in {"live_clip", "live_clips", "video_clip_viral_extraction"} for item in tasks)
    product_visual_count = db.scalar(select(func.count()).select_from(ProductVisualTask)) or 0
    return {
        "account_count": db.scalar(select(func.count()).select_from(Account)) or 0,
        "pending_topics": db.scalar(select(func.count()).select_from(ContentTopic)) or 0,
        "pending_materials": db.scalar(select(func.count()).select_from(Material)) or 0,
        "exported_videos": db.scalar(select(func.count()).select_from(EditExport)) or 0,
        "task_count": len(tasks),
        "verification_task_count": len(verification_tasks),
        "liveclip_count": liveclip_count,
        "product_visual_count": product_visual_count,
        "trace_count": db.scalar(select(func.count()).select_from(TraceEvent)) or 0,
        "success_rate": round(success_count / len(result_statuses) * 100, 1) if result_statuses else 0,
        "ready_model_routes": sum(bool(item.get("ready")) for item in routes),
        "model_route_count": len(routes),
        "task_status_counts": dict(status_counts),
        "recent_tasks": [_task_row(item) for item in recent_tasks],
        "recent_traces": [_trace_row(item) for item in recent_traces],
        "model_routes": routes,
        "review_7d_pending": 0,
        "review_14d_pending": 0,
        "weekly_growth_suggestions": ["强化3秒钩子", "围绕价格差异做系列", "每条视频保留明确咨询 CTA"],
    }
