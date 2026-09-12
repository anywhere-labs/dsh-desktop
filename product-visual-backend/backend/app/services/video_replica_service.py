from __future__ import annotations

import uuid
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import UploadFile
from sqlalchemy.orm import Session

from backend.app.core.paths import UPLOADS_DIR, rel_path
from backend.app.media.scene_detect import detect_basic_segments
from backend.app.media.video_probe import probe_video
from backend.app.models.task import Task
from backend.app.video_generation.ingest import build_ingest_record
from backend.app.video_generation.matting import build_matting_request
from backend.app.video_generation.compositing import compose_with_original_audio
from backend.app.video_generation.qa import evaluate_composite
from backend.app.video_generation.tracking import build_tracking_request, validate_selections


WORKFLOW = "pixel_preserved_background_replacement_v1"
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm"}
BACKGROUND_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".mov", ".m4v"}


def create_task(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    task_id = str(payload.get("task_id") or f"replica_{uuid.uuid4().hex[:20]}")
    if db.get(Task, task_id):
        return {"status": "blocked", "missing_inputs": ["task_id_unique"], "data": {}}
    task = Task(
        id=task_id,
        task_type="video_replica",
        workflow=WORKFLOW,
        account_id=str(payload.get("account_id") or ""),
        status="draft",
        input_json={
            "generation_mode": "PIXEL_PRESERVED_BACKGROUND_REPLACEMENT",
            "prompt": str(payload.get("prompt") or ""),
            "background_mode": str(payload.get("background_mode") or "UPLOAD"),
            "assets": [],
            "ingest": None,
        },
    )
    db.add(task)
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


async def upload_source(db: Session, task_id: str, upload: UploadFile) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    filename = Path(upload.filename or "source.mp4").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        return {"status": "blocked", "missing_inputs": ["supported_video_format"], "data": {}}
    target_dir = (UPLOADS_DIR / "video-replica" / task_id).resolve()
    if not target_dir.is_relative_to(UPLOADS_DIR.resolve()):
        return {"status": "blocked", "missing_inputs": ["storage_path"], "data": {}}
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"source{extension}"
    with target.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            handle.write(chunk)
    probe = probe_video(target)
    segments = detect_basic_segments(float(probe.get("duration") or 0))
    try:
        ingest = build_ingest_record(
            task_id=task_id,
            source_path=target,
            probe=probe,
            segments=segments,
        )
    except ValueError as exc:
        target.unlink(missing_ok=True)
        return {"status": "blocked", "missing_inputs": ["valid_video"], "warnings": [str(exc)], "data": {}}
    task.status = "awaiting_selection"
    task.input_json = {**(task.input_json or {}), "assets": [{"role": "SOURCE_VIDEO", "path": rel_path(target)}], "ingest": ingest}
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


async def upload_background(db: Session, task_id: str, upload: UploadFile) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    filename = Path(upload.filename or "background.png").name
    extension = Path(filename).suffix.lower()
    if extension not in BACKGROUND_EXTENSIONS:
        return {"status": "blocked", "missing_inputs": ["supported_background_format"], "data": {}}
    target_dir = (UPLOADS_DIR / "video-replica" / task_id).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"background{extension}"
    with target.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            handle.write(chunk)
    task.input_json = {**(task.input_json or {}), "background": {"path": rel_path(target), "authorized": True}}
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def run_composite(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    payload = task.input_json or {}
    source = Path(((payload.get("ingest") or {}).get("source") or {}).get("path") or "")
    if not source.is_absolute():
        source = Path(__file__).resolve().parents[3] / source
    background = Path(((payload.get("background") or {}).get("path") or ""))
    if not background.is_absolute():
        background = Path(__file__).resolve().parents[3] / background
    mask_dir = Path(((payload.get("tracking") or {}).get("mask_dir") or ""))
    if not all([source.exists(), background.exists(), mask_dir.exists()]):
        return {"status": "blocked", "missing_inputs": ["source_background_tracking"], "data": {}}
    mask_count = sum(1 for path in mask_dir.glob("[0-9][0-9][0-9][0-9][0-9][0-9].png"))
    expected_frames = int(round(float(((payload.get("ingest") or {}).get("probe") or {}).get("duration") or 0) * float(((payload.get("ingest") or {}).get("probe") or {}).get("fps") or 30)))
    if expected_frames > 0 and mask_count < expected_frames:
        return {"status": "blocked", "missing_inputs": ["complete_tracking_masks"], "warnings": [f"tracking masks cover {mask_count} frames; source requires about {expected_frames}"], "data": {}}
    fps = float(((payload.get("ingest") or {}).get("probe") or {}).get("fps") or 30)
    output = (UPLOADS_DIR / "video-replica" / task_id / "composite.mp4").resolve()
    try:
        artifact = compose_with_original_audio(source, background, mask_dir, output, fps)
    except (OSError, RuntimeError) as exc:
        return {"status": "failed", "missing_inputs": [], "warnings": [str(exc)], "data": {}}
    task.input_json = {**payload, "composite": {**artifact, "path": rel_path(output)}}
    task.status = "audio_remux"
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def run_qa(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    payload = task.input_json or {}
    source = Path(((payload.get("ingest") or {}).get("source") or {}).get("path") or "")
    output = Path(((payload.get("composite") or {}).get("path") or ""))
    root = Path(__file__).resolve().parents[3]
    if not source.is_absolute():
        source = root / source
    if not output.is_absolute():
        output = root / output
    report = evaluate_composite(source, output)
    task.input_json = {**payload, "qa": report}
    task.status = "completed" if report["passed"] else "repair_required"
    db.commit()
    return {"status": "ok" if report["passed"] else "blocked", "data": _serialize(task), "warnings": [item["message"] for item in report["failures"]]}


def get_task(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    return {"status": "ok", "data": _serialize(task)}


def save_selections(db: Session, task_id: str, selections: list[dict[str, Any]]) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    missing = validate_selections(selections)
    if missing:
        return {"status": "blocked", "missing_inputs": missing, "data": {}}
    task.input_json = {**(task.input_json or {}), "selections": selections}
    task.status = "ready"
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def prepare_tracking(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    try:
        request = build_tracking_request(task_id, list((task.input_json or {}).get("selections") or []))
    except (RuntimeError, ValueError) as exc:
        return {"status": "blocked", "missing_inputs": ["sam2", "cutie"], "warnings": [str(exc)], "data": {}}
    task.input_json = {**(task.input_json or {}), "tracking_request": request}
    task.status = "queued"
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def run_tracking(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    selections = list((task.input_json or {}).get("selections") or [])
    missing = validate_selections(selections)
    if missing:
        return {"status": "blocked", "missing_inputs": missing, "data": {}}
    ingest = (task.input_json or {}).get("ingest") or {}
    source = ((ingest.get("source") or {}).get("path") or "").strip()
    person = next(item for item in selections if str(item.get("label", "")).lower() == "person")
    python_bin = os.getenv("VIDEO_REPLICA_PYTHON", "").strip()
    sam2_checkpoint = os.getenv("SAM2_CHECKPOINT", "").strip()
    cutie_root = os.getenv("CUTIE_ROOT", "").strip()
    cutie_weights = os.getenv("CUTIE_WEIGHTS", "").strip()
    if not all([source, python_bin, sam2_checkpoint, cutie_root, cutie_weights]):
        return {"status": "blocked", "missing_inputs": ["video_replica_runtime"], "data": {}, "warnings": ["配置 VIDEO_REPLICA_PYTHON、SAM2_CHECKPOINT、CUTIE_ROOT、CUTIE_WEIGHTS 后才能执行跟踪"]}
    output_dir = (UPLOADS_DIR / "video-replica" / task_id / "tracking").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    command = [python_bin, str(Path(__file__).resolve().parents[3] / "scripts/run_video_tracking.py"), "--source", source, "--output-dir", str(output_dir), "--x", str(person["x"]), "--y", str(person["y"]), "--sam2-checkpoint", sam2_checkpoint, "--cutie-root", cutie_root, "--cutie-weights", cutie_weights]
    max_frames = os.getenv("VIDEO_REPLICA_MAX_FRAMES", "0").strip()
    if max_frames:
        command.extend(["--max-frames", max_frames])
    try:
        process = subprocess.run(command, capture_output=True, text=True, timeout=900, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "failed", "missing_inputs": [], "warnings": [f"tracking runner failed: {exc}"], "data": {}}
    if process.returncode != 0:
        return {"status": "failed", "missing_inputs": [], "warnings": [process.stderr[-1000:] or "tracking runner exited with non-zero status"], "data": {}}
    summary_path = output_dir / "tracking-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if summary.get("tracking_quality") != "pass":
        task.input_json = {**(task.input_json or {}), "tracking": summary}
        task.status = "repair_required"
        db.commit()
        return {"status": "blocked", "missing_inputs": ["stable_tracking_masks"], "warnings": [f"tracking produced {len(summary.get('empty_frame_indices') or [])} empty masks"], "data": _serialize(task)}
    task.input_json = {**(task.input_json or {}), "tracking": summary}
    task.status = "tracking"
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def prepare_matting(db: Session, task_id: str) -> dict[str, Any]:
    task = db.get(Task, task_id)
    if task is None or task.task_type != "video_replica":
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    selections = list((task.input_json or {}).get("selections") or [])
    try:
        request = build_matting_request(task_id, selections)
    except (RuntimeError, ValueError) as exc:
        return {"status": "blocked", "missing_inputs": ["matting_runtime"], "warnings": [str(exc)], "data": {}}
    task.input_json = {**(task.input_json or {}), "matting_request": request}
    task.status = "matting"
    db.commit()
    return {"status": "ok", "data": _serialize(task)}


def _serialize(task: Task) -> dict[str, Any]:
    return {
        "task_id": task.id,
        "task_type": task.task_type,
        "workflow": task.workflow,
        "status": task.status,
        "input": task.input_json or {},
        "preservation_policy": {
            "foreground_pixels": True,
            "motion": True,
            "original_audio": True,
            "video_regeneration": False,
            "lip_sync": False,
            "tts": False,
        },
    }
