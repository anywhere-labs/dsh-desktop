import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS video_jobs (run_id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, node TEXT NOT NULL, provider TEXT NOT NULL, request_json TEXT NOT NULL, output_json TEXT, output_url TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS video_job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, state TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_manifests (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, asset_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_receipts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, exit_code INTEGER, stdout TEXT, stderr TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, artifact_type TEXT NOT NULL, uri TEXT, qa_status TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL);
"""


class Repository:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True); self.db_path = root / "video-workbench.sqlite3"; self.lock = threading.RLock()
        with self.connect() as db: db.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, check_same_thread=False); db.row_factory = sqlite3.Row; return db

    @staticmethod
    def add_event(db: sqlite3.Connection, run_id: str, state: str, detail: str, timestamp: str) -> None:
        db.execute("INSERT INTO video_job_events(run_id,state,detail,created_at) VALUES(?,?,?,?)", (run_id, state, detail, timestamp))

    def create_job(self, job: dict[str, Any], request_json: str, assets: list[dict[str, Any]]) -> None:
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO video_jobs(run_id,idempotency_key,state,workspace_id,project_id,node,provider,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (job["runId"], job["idempotencyKey"], job["state"], job["workspaceId"], job["projectId"], job["node"], job["provider"], request_json, job["createdAt"], job["updatedAt"]))
            for asset in assets: db.execute("INSERT INTO asset_manifests(run_id,asset_json,created_at) VALUES(?,?,?)", (job["runId"], json.dumps(asset, ensure_ascii=False), job["createdAt"]))
            self.add_event(db, job["runId"], "QUEUED", "accepted", job["createdAt"])

    def find_key(self, key: str) -> dict[str, Any] | None:
        with self.lock, self.connect() as db:
            row = db.execute("SELECT * FROM video_jobs WHERE idempotency_key=?", (key,)).fetchone(); return self.job(row) if row else None

    def get(self, run_id: str) -> dict[str, Any] | None:
        with self.lock, self.connect() as db:
            row = db.execute("SELECT * FROM video_jobs WHERE run_id=?", (run_id,)).fetchone(); return self.job(row) if row else None

    def update(self, run_id: str, state: str, timestamp: str, *, output: str | None = None, output_url: str | None = None, error: str | None = None, detail: str = "") -> dict[str, Any]:
        with self.lock, self.connect() as db:
            db.execute("UPDATE video_jobs SET state=?,output_json=COALESCE(?,output_json),output_url=COALESCE(?,output_url),error=COALESCE(?,error),updated_at=? WHERE run_id=?", (state, output, output_url, error, timestamp, run_id)); self.add_event(db, run_id, state, detail, timestamp)
        return self.get(run_id) or {}

    def receipt(self, run_id: str, code: int, stdout: str, stderr: str, timestamp: str) -> None:
        with self.lock, self.connect() as db: db.execute("INSERT INTO provider_receipts(run_id,exit_code,stdout,stderr,created_at) VALUES(?,?,?,?,?)", (run_id, code, stdout, stderr, timestamp))

    def artifact(self, run_id: str, artifact_type: str, uri: str, qa_status: str, metadata: dict[str, Any], timestamp: str) -> None:
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO artifacts(run_id,artifact_type,uri,qa_status,metadata_json,created_at) VALUES(?,?,?,?,?,?)", (run_id, artifact_type, uri, qa_status, json.dumps(metadata, ensure_ascii=False), timestamp))

    def artifacts(self, run_id: str) -> list[dict[str, Any]]:
        with self.lock, self.connect() as db:
            return [{"id": row["id"], "runId": row["run_id"], "artifactType": row["artifact_type"], "uri": row["uri"], "qaStatus": row["qa_status"], "metadata": json.loads(row["metadata_json"]), "createdAt": row["created_at"]} for row in db.execute("SELECT * FROM artifacts WHERE run_id=? ORDER BY id", (run_id,)).fetchall()]

    def events(self, run_id: str) -> list[dict[str, Any]]:
        with self.lock, self.connect() as db: return [{"id": r["id"], "runId": r["run_id"], "state": r["state"], "detail": r["detail"], "createdAt": r["created_at"]} for r in db.execute("SELECT * FROM video_job_events WHERE run_id=? ORDER BY id", (run_id,)).fetchall()]

    @staticmethod
    def job(row: sqlite3.Row) -> dict[str, Any]:
        result = {"runId": row["run_id"], "idempotencyKey": row["idempotency_key"], "state": row["state"], "workspaceId": row["workspace_id"], "projectId": row["project_id"], "node": row["node"], "provider": row["provider"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]}
        if row["output_json"]: result["output"] = json.loads(row["output_json"])
        if row["output_url"]: result["outputUrl"] = row["output_url"]
        if row["error"]: result["error"] = row["error"]
        return result
