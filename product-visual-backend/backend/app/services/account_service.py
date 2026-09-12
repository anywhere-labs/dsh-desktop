from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.app.agents.account_diagnosis_agent import AccountDiagnosisAgent
from backend.app.models.account import Account, AccountImport


def import_account(db: Session, payload: dict) -> Account:
    account = Account(
        id=uuid.uuid4().hex,
        name=payload.get("name", "阿乐服装定制 Demo"),
        platform=payload.get("platform", "douyin"),
        industry=payload.get("industry", "服装定制 / 真人口播 / 电商成交"),
        positioning=payload.get("positioning", ""),
        target_audience_json=payload.get("target_audience", {}),
    )
    db.add(account)
    db.add(AccountImport(id=uuid.uuid4().hex, account_id=account.id, source_type=payload.get("source_type", "manual"), raw_data_json=payload))
    db.commit()
    db.refresh(account)
    return account


def get_account(db: Session, account_id: str) -> Account | None:
    return db.get(Account, account_id)


def diagnose_account(db: Session, account: Account, payload: dict) -> tuple[str, dict]:
    trace_id, output = AccountDiagnosisAgent().run(db, {**payload, "account_id": account.id, "name": account.name}, account_id=account.id)
    account.positioning = output["positioning"]
    account.target_audience_json = {"items": output["target_audience"]}
    db.commit()
    return trace_id, output

