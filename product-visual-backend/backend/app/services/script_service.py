from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.app.agents.material_planner_agent import MaterialPlannerAgent
from backend.app.agents.script_director_agent import ScriptDirectorAgent
from backend.app.models.script import Script, ScriptShot
from backend.app.models.topic import ContentTopic


def generate_script(db: Session, topic: ContentTopic, payload: dict) -> tuple[str, dict]:
    trace_id, output = ScriptDirectorAgent().run(db, {**topic.topic_json, **payload, "topic_id": topic.id}, account_id=topic.account_id)
    script = Script(
        id=uuid.uuid4().hex,
        account_id=topic.account_id,
        topic_id=topic.id,
        title=output["title"],
        hook_3s=output["hook_3s"],
        target_audience=output["target_audience"],
        core_pain_point=output["core_pain_point"],
        duration=output["duration"],
        script_json=output,
    )
    db.add(script)
    for shot in output["shots"]:
        db.add(ScriptShot(id=uuid.uuid4().hex, script_id=script.id, shot_json=shot))
    db.commit()
    output["script_id"] = script.id
    return trace_id, output


def get_script(db: Session, script_id: str) -> Script | None:
    return db.get(Script, script_id)


def revise_script(db: Session, script: Script, payload: dict) -> tuple[str, dict]:
    trace_id, output = ScriptDirectorAgent().run(db, {**script.script_json, **payload}, account_id=script.account_id)
    script.script_json = output
    script.version = "v2"
    db.commit()
    output["script_id"] = script.id
    return trace_id, output


def material_plan(db: Session, script: Script) -> tuple[str, dict]:
    return MaterialPlannerAgent().run(db, script.script_json, account_id=script.account_id)

