from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.config import PROJECT_NAME, VERSION
from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.media.ffmpeg_service import check_ffmpeg
from backend.app.services.dashboard_service import dashboard

router = APIRouter()


@router.get("/api/health")
def health():
    return api_response("ok", "service healthy", {"service": PROJECT_NAME, "version": VERSION})


@router.get("/api/capabilities")
def capabilities():
    media = check_ffmpeg()
    status = "ok" if media["ready"] else "partial"
    return api_response(status, "环境能力检查完成", {"media": media}, "", [] if media["ready"] else ["ffmpeg"], [] if media["ready"] else ["FFmpeg 不可用时自动剪辑会 blocked"], [] if media["ready"] else ["安装 FFmpeg 或跳过自动导出"])


@router.get("/api/dashboard")
def dashboard_api(db: Session = Depends(get_db)):
    return api_response("ok", "dashboard", dashboard(db))

