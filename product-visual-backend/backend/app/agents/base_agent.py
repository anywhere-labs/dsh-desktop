from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.core.trace import finish_trace, trace_event


class BaseAgent:
    name = "base_agent"
    stage = "base"

    def run_logic(self, payload: dict) -> dict:
        return payload

    def run(self, db: Session, payload: dict, account_id: str | None = None, video_id: str | None = None) -> tuple[str, dict]:
        with trace_event(db, account_id=account_id, video_id=video_id, stage=self.stage, agent_name=self.name, input_json=payload) as (trace_id, event):
            output = self.run_logic(payload)
            finish_trace(db, event, output, output.get("status", "ok"), output.get("confidence_score", 0.82))
            return trace_id, output

