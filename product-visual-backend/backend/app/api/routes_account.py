from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.response import api_response
from backend.app.services.account_service import diagnose_account, get_account, import_account

router = APIRouter()


@router.post("/api/account/import")
def import_api(payload: dict, db: Session = Depends(get_db)):
    account = import_account(db, payload)
    return api_response("ok", "账号导入成功", {"account_id": account.id, "name": account.name})


@router.get("/api/account/{account_id}")
def get_api(account_id: str, db: Session = Depends(get_db)):
    account = get_account(db, account_id)
    if not account:
        return api_response("blocked", "账号不存在", {}, "", ["account_id"], [], ["先导入账号"])
    return api_response("ok", "账号详情", {"id": account.id, "name": account.name, "platform": account.platform, "industry": account.industry, "positioning": account.positioning, "target_audience": account.target_audience_json})


@router.post("/api/account/{account_id}/diagnose")
def diagnose_api(account_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    account = get_account(db, account_id)
    if not account:
        return api_response("blocked", "账号不存在", {}, "", ["account_id"], [], ["先导入账号"])
    trace_id, output = diagnose_account(db, account, payload or {})
    return api_response("ok", "账号诊断完成", output, trace_id)

