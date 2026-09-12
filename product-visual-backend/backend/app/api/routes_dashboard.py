from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.dashboard_service import dashboard

router = APIRouter()


@router.get("/api/dashboard/full")
def full_dashboard(db: Session = Depends(get_db)):
    return api_response("ok", "Dashboard", dashboard(db))

