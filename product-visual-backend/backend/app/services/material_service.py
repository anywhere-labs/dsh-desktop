from __future__ import annotations

import re
import subprocess
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.paths import MATERIALS_DIR, rel_path
from backend.app.media.video_probe import probe_video
from backend.app.models.material import Material


MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024
ALLOWED_FILE_TYPES = {"video", "image", "audio", "document"}
VIDEO_CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".flv": "video/x-flv",
    ".ts": "video/mp2t",
}


async def save_material(db: Session, upload: UploadFile, account_id: str, script_id: str = "", file_type: str = "video") -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", account_id or ""):
        return {
            "status": "blocked",
            "missing_inputs": ["account_id"],
            "warnings": ["account_id 格式无效。"],
            "next_action": ["使用字母、数字、下划线或连字符组成的账号 ID。"],
            "data": {},
        }
    safe_name = Path(upload.filename or "material.bin").name.replace("..", "_")
    if len(script_id) > 64:
        return {
            "status": "blocked",
            "missing_inputs": ["script_id"],
            "warnings": ["script_id 不能超过 64 个字符。"],
            "next_action": [],
            "data": {},
        }
    if not safe_name or len(safe_name) > 300:
        return {
            "status": "blocked",
            "missing_inputs": ["file_name"],
            "warnings": ["素材文件名不能超过 300 个字符。"],
            "next_action": [],
            "data": {},
        }
    target_dir = (MATERIALS_DIR / account_id).resolve()
    if not target_dir.is_relative_to(MATERIALS_DIR.resolve()):
        return {"status": "blocked", "missing_inputs": ["account_id"], "warnings": ["素材目录越界。"], "next_action": [], "data": {}}
    if file_type not in ALLOWED_FILE_TYPES:
        return {
            "status": "blocked",
            "missing_inputs": ["file_type"],
            "warnings": ["素材类型无效。"],
            "next_action": ["使用 video、image、audio 或 document。"],
            "data": {},
        }

    extension = Path(safe_name).suffix.lower()
    content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if file_type == "video" and VIDEO_CONTENT_TYPES.get(extension) != content_type:
        return {
            "status": "blocked",
            "missing_inputs": ["supported_video_format"],
            "warnings": ["仅支持扩展名与 MIME 匹配的 MP4 / MOV / FLV / TS 视频。"],
            "next_action": ["上传 MP4、MOV、FLV 或 MPEG-TS 原片。"],
            "data": {},
        }

    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid.uuid4().hex}_{safe_name}"
    size = 0
    stream_error = ""
    try:
        with target.open("wb") as fh:
            while True:
                try:
                    chunk = await upload.read(1024 * 1024)
                except (OSError, EOFError):
                    stream_error = "file_read"
                    break
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_VIDEO_SIZE_BYTES:
                    break
                try:
                    fh.write(chunk)
                except OSError:
                    stream_error = "file_write"
                    break
    except OSError:
        stream_error = "file_write"
    if stream_error:
        target.unlink(missing_ok=True)
        return {
            "status": "blocked",
            "missing_inputs": [stream_error],
            "warnings": ["素材文件读取失败。" if stream_error == "file_read" else "素材文件写入失败。"],
            "next_action": ["重新选择文件后上传。"],
            "data": {},
        }
    if size > MAX_VIDEO_SIZE_BYTES:
        target.unlink(missing_ok=True)
        return {
            "status": "blocked",
            "missing_inputs": ["file_size"],
            "warnings": ["素材文件不能超过 10GB。"],
            "next_action": ["压缩或拆分视频后重新上传。"],
            "data": {},
        }
    if size <= 0:
        target.unlink(missing_ok=True)
        return {"status": "blocked", "missing_inputs": ["non_empty_file"], "warnings": ["空文件不能作为素材"], "next_action": ["上传真实 MP4 / MOV / FLV / TS 原片"], "data": {}}

    probe = {"status": "not_applicable", "duration": 0, "metadata": {}}
    if file_type == "video":
        try:
            probe = probe_video(target)
        except (OSError, ValueError, subprocess.SubprocessError):
            target.unlink(missing_ok=True)
            return {
                "status": "blocked",
                "missing_inputs": ["valid_video"],
                "warnings": ["视频探测失败，文件不是可处理的有效视频。"],
                "next_action": ["检查文件完整性或重新导出后上传。"],
                "data": {},
            }
        if probe.get("status") != "ok":
            target.unlink(missing_ok=True)
            return {
                "status": "blocked",
                "missing_inputs": ["valid_video"],
                "warnings": ["视频探测失败，文件不是可处理的有效视频。"],
                "next_action": ["检查文件完整性或重新导出后上传。"],
                "data": {},
            }

    material = Material(
        id=uuid.uuid4().hex,
        account_id=account_id,
        script_id=script_id,
        file_name=safe_name,
        file_path=rel_path(target),
        file_type=file_type,
        duration=probe.get("duration", 0),
        metadata_json={
            "size": size,
            "extension": extension,
            "content_type": content_type,
            "probe_status": probe.get("status"),
            "probe": probe,
        },
    )
    try:
        db.add(material)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        target.unlink(missing_ok=True)
        return {
            "status": "blocked",
            "missing_inputs": ["material_persistence"],
            "warnings": ["素材记录保存失败。"],
            "next_action": ["稍后重新上传。"],
            "data": {},
        }
    return {"status": "ok", "data": {"material_id": material.id, "file_path": material.file_path, "size": size, "duration": material.duration}, "missing_inputs": [], "warnings": [], "next_action": ["进入自动剪辑"]}


def list_materials(db: Session, account_id: str) -> list[Material]:
    return list(db.scalars(select(Material).where(Material.account_id == account_id)))
