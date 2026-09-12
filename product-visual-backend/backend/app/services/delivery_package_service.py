from __future__ import annotations

import json
import hashlib
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.contracts.delivery_package_contract import (
    DeliveryAsset,
    DeliveryClip,
    DeliveryCustomerSummary,
    DeliveryPackageManifest,
)
from backend.app.core.paths import EXPORTS_DIR, PROJECT_ROOT, rel_path
from backend.app.media.video_probe import probe_video
from backend.app.models.task import Task, TaskResult
from backend.app.services.edit_plan_normalizer import (
    normalize_edit_plan,
    normalize_packaging_plan,
)
from backend.app.services.liveclip_download_token_service import signed_delivery_package_download_url


DELIVERY_PACKAGE_DIRNAME = "delivery_package"
DELIVERY_PACKAGE_ZIP = "delivery_package.zip"
JIANYING_REBUILD_NOTE = "剪映/CapCut 相关内容为交换包/复建包，并非官方完整项目格式。"


def create_delivery_package(
    db: Session,
    job_id: str,
    *,
    require_approval: bool = True,
) -> dict:
    task, result = _latest_liveclip_result(db, job_id)
    if not task:
        return _blocked(["job_id"], "未找到直播切片任务。")
    if not result:
        return _blocked(["completed_task_result"], "请先生成切片结果。")

    result_json = result.result_json or {}
    qa_status = (result_json.get("qa_result") or {}).get("qa_status")
    if qa_status != "passed":
        return _blocked(
            ["qa_pass"],
            "请先完成 QA 修复，通过后再导出交付包。",
            result_json=result_json,
        )

    review_status = result_json.get("review_status") or task.review_status
    if require_approval and review_status not in {"pass", "approved"}:
        return _blocked(
            ["approved_review"],
            "请先通过人工审核，再导出交付包。",
            result_json=result_json,
        )

    invalid_clips = _invalid_final_clips(result_json)
    if invalid_clips:
        blocked = _blocked(
            ["playable_final_clips"],
            "部分成片无法播放，请先重新生成失败片段并通过 QA。",
            result_json=result_json,
        )
        blocked["invalid_clips"] = invalid_clips
        return blocked

    package_dir = _package_dir(job_id)
    _prepare_package_dirs(package_dir)
    manifest = _build_manifest(task, result, package_status="package_ready")
    assets_by_section = _materialize_package_assets(package_dir, manifest, result_json)
    manifest = manifest.model_copy(
        update={
            "previews": assets_by_section["previews"],
            "subtitles": assets_by_section["subtitles"],
            "copywriting": assets_by_section["copywriting"],
            "edit_plans": assets_by_section["edit_plans"],
            "qa_reports": assets_by_section["qa_reports"],
            "exchange_assets": assets_by_section["exchange_assets"],
            "debug_assets": assets_by_section["debug_assets"],
            "download_url": signed_delivery_package_download_url(manifest.package_id),
        }
    )
    manifest_path = package_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(_dump_model(manifest), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary_path = package_dir / "delivery_summary.md"
    summary_path.write_text(_delivery_summary_md(manifest), encoding="utf-8")
    zip_path = _zip_package(package_dir)
    manifest = manifest.model_copy(
        update={
            "metadata": {
                **manifest.metadata,
                "manifest_path": rel_path(manifest_path),
                "package_dir": rel_path(package_dir),
                "package_zip": rel_path(zip_path),
            },
        }
    )
    manifest_path.write_text(
        json.dumps(_dump_model(manifest), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "status": "ok",
        "message": "交付包已生成。",
        "data": {
            "package_id": manifest.package_id,
            "manifest": _dump_model(manifest),
            "manifest_path": rel_path(manifest_path),
            "package_dir": rel_path(package_dir),
            "package_zip": rel_path(zip_path),
            "download_url": manifest.download_url,
        },
    }


def get_delivery_package(package_id: str) -> dict:
    manifest_path = _find_manifest_by_package_id(package_id)
    if not manifest_path:
        return _blocked(["package_id"], "交付包不存在。")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    package_zip = (PROJECT_ROOT / (manifest.get("metadata") or {}).get("package_zip", "")).resolve()
    return {
        "status": "ok",
        "message": "交付包详情",
        "data": {
            "package_id": package_id,
            "manifest": manifest,
            "manifest_path": rel_path(manifest_path),
            "package_zip": rel_path(package_zip) if package_zip.exists() else "",
            "download_url": signed_delivery_package_download_url(package_id),
        },
    }


def get_delivery_package_download_path(package_id: str) -> Path | None:
    manifest = get_delivery_package(package_id)
    if manifest["status"] != "ok":
        return None
    rel = (manifest["data"].get("manifest") or {}).get("metadata", {}).get("package_zip")
    if not rel:
        return None
    path = (PROJECT_ROOT / rel).resolve()
    if not _is_inside_project(path) or not path.is_file():
        return None
    return path


def build_delivery_package_preview(db: Session, job_id: str) -> dict:
    task, result = _latest_liveclip_result(db, job_id)
    if not task:
        return _blocked(["job_id"], "未找到直播切片任务。")
    if not result:
        return _blocked(["completed_task_result"], "请先生成切片结果。")
    manifest = _build_manifest(task, result, package_status="blocked")
    return {
        "status": "ok",
        "message": "交付包预览",
        "data": {"manifest": _dump_model(manifest)},
    }


def _invalid_final_clips(result_json: dict[str, Any]) -> list[str]:
    segments = result_json.get("segments") or result_json.get("slice_segments") or []
    invalid: list[str] = []
    for item in segments:
        clip_id = str(item.get("clip_id") or item.get("slice_id") or "unknown_clip")
        files = item.get("files") or {}
        rel = str((item.get("render") or {}).get("final_mp4") or files.get("final_clip") or "")
        if not rel:
            invalid.append(clip_id)
            continue
        probe = probe_video((PROJECT_ROOT / rel).resolve())
        if (
            probe.get("status") != "ok"
            or not probe.get("has_video")
            or float(probe.get("duration") or 0) <= 0
        ):
            invalid.append(clip_id)
    return invalid


def _latest_liveclip_result(db: Session, job_id: str) -> tuple[Task | None, TaskResult | None]:
    task = db.get(Task, job_id)
    result = (
        db.scalar(
            select(TaskResult)
            .where(TaskResult.task_id == job_id)
            .order_by(TaskResult.created_at.desc())
        )
        if task
        else None
    )
    return task, result


def _build_manifest(
    task: Task,
    result: TaskResult,
    *,
    package_status: str,
) -> DeliveryPackageManifest:
    result_json = result.result_json or {}
    attempt_id = str(result_json.get("attempt_id") or (result_json.get("batch_state") or {}).get("attempt_id") or result.id)
    package_hash = hashlib.sha256(
        json.dumps(
            {
                "job_id": task.id,
                "attempt_id": attempt_id,
                "project_id": result_json.get("project_id") or task.account_id,
                "clips": [
                    item.get("clip_id") or item.get("slice_id")
                    for item in (result_json.get("slice_segments") or result_json.get("segments") or [])
                ],
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:20]
    package_id = f"liveclip_{task.id}_{package_hash}"[:120]
    clips = [_manifest_clip(item) for item in (result_json.get("slice_segments") or result_json.get("segments") or [])]
    qa_result = result_json.get("qa_result") or {}
    review_status = result_json.get("review_status") or task.review_status
    batch_state = result_json.get("batch_state") or {}
    return DeliveryPackageManifest(
        package_id=package_id,
        job_id=task.id,
        project_id=str(result_json.get("project_id") or task.account_id or "live_clip_project"),
        package_status=package_status,  # type: ignore[arg-type]
        created_at=_stable_created_at(result),
        clips=clips,
        download_url=signed_delivery_package_download_url(package_id),
        customer_summary=DeliveryCustomerSummary(
            title="直播切片交付包",
            status_label=_customer_status_label(result_json, task),
            clip_count=len(clips),
            subtitle_count=sum(1 for item in clips if item.subtitle),
            qa_status=str(qa_result.get("qa_status") or ""),
            review_status=str(review_status or ""),
            package_note=JIANYING_REBUILD_NOTE,
            next_action=_customer_next_action(result_json, task),
        ),
        dag_version=str(result_json.get("dag_version") or "liveclip_dag_v1_4_1"),
        execution_time=_execution_time_summary(batch_state),
        worker_summary=_worker_summary(result_json),
        metadata={
            "source_video": result_json.get("source_video") or {},
            "attempt_id": attempt_id,
            "result_id": result.id,
            "capcut_jianying_boundary": JIANYING_REBUILD_NOTE,
        },
    )


def _manifest_clip(item: dict[str, Any]) -> DeliveryClip:
    distribution = item.get("distribution") or {}
    files = item.get("files") or {}
    return DeliveryClip(
        clip_id=str(item.get("clip_id") or item.get("slice_id") or ""),
        title=str(item.get("title") or item.get("suggested_title") or distribution.get("douyin_title") or ""),
        caption=str(item.get("summary") or item.get("suggested_caption") or distribution.get("video_caption") or ""),
        source_start=float(item.get("start_seconds") or 0),
        source_end=float(item.get("end_seconds") or 0),
        duration_seconds=float(item.get("duration_seconds") or item.get("duration") or 0),
        final_clip=str((item.get("render") or {}).get("final_mp4") or files.get("final_clip") or ""),
        subtitle=str(files.get("subtitle") or ""),
        cover=str(files.get("cover") or ""),
        qa_status=str(item.get("qa_status") or (item.get("qa") or item.get("qa_result") or {}).get("qa_status") or ""),
        review_status=str(item.get("review_status") or ""),
    )


def _materialize_package_assets(
    package_dir: Path,
    manifest: DeliveryPackageManifest,
    result_json: dict[str, Any],
) -> dict[str, list[DeliveryAsset]]:
    assets = {
        "previews": [],
        "subtitles": [],
        "copywriting": [],
        "edit_plans": [],
        "qa_reports": [],
        "exchange_assets": [],
        "debug_assets": [],
    }
    segments = result_json.get("segments") or result_json.get("slice_segments") or []
    artifacts = result_json.get("artifacts") or {}

    for segment in segments:
        clip_id = str(segment.get("clip_id") or segment.get("slice_id") or uuid.uuid4().hex[:8])
        files = segment.get("files") or {}
        _copy_assets(
            package_dir,
            "final_clips",
            [(f"{clip_id}_final_clip", "最终成片", "final_clip", files.get("final_clip"))],
        )
        assets["previews"].extend(
            _copy_assets(
                package_dir,
                "previews",
                [
                    (f"{clip_id}_final", "成片预览", "final_clip", files.get("final_clip")),
                    (f"{clip_id}_cover", "封面预览", "cover", files.get("cover")),
                ],
            )
        )
        assets["subtitles"].extend(
            _copy_assets(
                package_dir,
                "subtitles",
                [
                    (f"{clip_id}_srt", "SRT 字幕", "srt", files.get("subtitle")),
                    (f"{clip_id}_ass", "ASS 字幕", "ass", files.get("ass_subtitle")),
                ],
            )
        )

    assets["subtitles"].extend(
        _copy_assets(
            package_dir,
            "subtitles",
            [("srt_zip", "字幕文件包", "srt_zip", artifacts.get("srt_zip"))],
        )
    )

    copywriting_json = package_dir / "copywriting" / "copywriting.json"
    copywriting_md = package_dir / "copywriting" / "copywriting.md"
    copywriting_payload = _copywriting_payload(segments)
    copywriting_json.write_text(json.dumps(copywriting_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    copywriting_md.write_text(_copywriting_md(copywriting_payload), encoding="utf-8")
    assets["copywriting"].extend(
        [
            _asset_from_path("copywriting_json", "标题文案 JSON", "copywriting_json", copywriting_json),
            _asset_from_path("copywriting_md", "标题文案说明", "copywriting_markdown", copywriting_md),
        ]
    )

    edit_plan = normalize_edit_plan(manifest.job_id, result_json)
    packaging_plan = normalize_packaging_plan(manifest.job_id, result_json)
    edit_plan_path = package_dir / "edit_plans" / "edit_plan.json"
    packaging_plan_path = package_dir / "edit_plans" / "packaging_plan.json"
    edit_plan_path.write_text(json.dumps(_dump_model(edit_plan), ensure_ascii=False, indent=2), encoding="utf-8")
    packaging_plan_path.write_text(json.dumps(_dump_model(packaging_plan), ensure_ascii=False, indent=2), encoding="utf-8")
    assets["edit_plans"].extend(
        [
            _asset_from_path("edit_plan_json", "剪辑计划", "edit_plan", edit_plan_path),
            _asset_from_path("packaging_plan_json", "包装计划", "packaging_plan", packaging_plan_path),
        ]
    )
    assets["edit_plans"].extend(
        _copy_assets(
            package_dir,
            "edit_plans",
            [("timeline_json", "时间线 JSON", "timeline_json", artifacts.get("timeline_json"))],
        )
    )

    qa_path = package_dir / "qa_reports" / "qa_result.json"
    qa_path.write_text(json.dumps(result_json.get("qa_result") or {}, ensure_ascii=False, indent=2), encoding="utf-8")
    per_clip_qa_path = package_dir / "qa_reports" / "per_clip_qa.json"
    per_clip_qa_path.write_text(
        json.dumps(
            [
                {
                    "clip_id": item.get("clip_id") or item.get("slice_id"),
                    "qa": item.get("qa") or item.get("qa_result") or {},
                }
                for item in segments
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    assets["qa_reports"].extend(
        [
            _asset_from_path("qa_result_json", "QA 摘要", "qa_result", qa_path),
            _asset_from_path("per_clip_qa_json", "逐条切片 QA", "per_clip_qa", per_clip_qa_path),
        ]
    )

    assets["exchange_assets"].extend(
        _copy_assets(
            package_dir,
            "exchange",
            [
                ("exchange_package_zip", "时间线交换包", "exchange_package", artifacts.get("exchange_package_zip")),
                ("otio_timeline", "OTIO 时间线", "otio", artifacts.get("otio_timeline")),
                ("edl_file", "EDL 文件", "edl", artifacts.get("edl_file")),
                ("xml_file", "XML 交换文件", "xml", artifacts.get("xml_file")),
                ("jianying_rebuild_package_zip", "剪映交换包/复建包", "jianying_rebuild_package", artifacts.get("jianying_project_zip")),
                ("jianying_rebuild_readme", "剪映复建说明", "jianying_rebuild_readme", artifacts.get("jianying_project_readme")),
            ],
            note=JIANYING_REBUILD_NOTE,
        )
    )

    return assets


def _copy_assets(
    package_dir: Path,
    section: str,
    entries: list[tuple[str, str, str, str | None]],
    *,
    customer_visible: bool = True,
    note: str = "",
) -> list[DeliveryAsset]:
    output: list[DeliveryAsset] = []
    for asset_id, label, asset_type, rel in entries:
        source = _project_file(rel)
        if not source:
            continue
        target = package_dir / section / source.name
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        output.append(
            _asset_from_path(
                asset_id,
                label,
                asset_type,
                source,
                package_path=target,
                customer_visible=customer_visible,
                note=note,
            )
        )
    return output


def _asset_from_path(
    asset_id: str,
    label: str,
    asset_type: str,
    path: Path,
    *,
    package_path: Path | None = None,
    customer_visible: bool = True,
    note: str = "",
) -> DeliveryAsset:
    package_path = package_path or path
    return DeliveryAsset(
        asset_id=asset_id,
        label=label,
        type=asset_type,
        path=rel_path(path),
        package_path=rel_path(package_path),
        exists=path.exists(),
        size_bytes=path.stat().st_size if path.exists() else 0,
        customer_visible=customer_visible,
        note=note,
    )


def _copywriting_payload(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = []
    for item in segments:
        distribution = item.get("distribution") or {}
        payload.append(
            {
                "clip_id": item.get("clip_id") or item.get("slice_id") or "",
                "title": item.get("title") or item.get("suggested_title") or distribution.get("douyin_title") or "",
                "caption": item.get("suggested_caption") or distribution.get("video_caption") or "",
                "cover_text": distribution.get("cover_text") or "",
                "hashtags": distribution.get("hashtags") or [],
                "platform_titles": {
                    key: value
                    for key, value in distribution.items()
                    if key.endswith("_title") and value
                },
            }
        )
    return payload


def _copywriting_md(items: list[dict[str, Any]]) -> str:
    lines = ["# 标题与文案建议", ""]
    for item in items:
        lines.extend(
            [
                f"## {item.get('clip_id')}",
                "",
                f"- 标题：{item.get('title') or '-'}",
                f"- 文案：{item.get('caption') or '-'}",
                f"- 封面文案：{item.get('cover_text') or '-'}",
                f"- 话题：{' '.join(item.get('hashtags') or []) or '-'}",
                "",
            ]
        )
    return "\n".join(lines)


def _delivery_summary_md(manifest: DeliveryPackageManifest) -> str:
    summary = manifest.customer_summary
    clips = manifest.clips
    passed = "通过" if str(summary.qa_status).lower() in {"passed", "pass", "true"} else (summary.qa_status or "-")
    return "\n".join(
        [
            "# 直播切片交付摘要",
            "",
            "## 本次交付概览",
            "",
            f"本次共生成 **{summary.clip_count} 条短视频**，每条均已整理成可预览成片，并配套字幕、标题文案和 QA 摘要。",
            "",
            f"- 字幕状态：{'已生成' if summary.subtitle_count else '未生成'}",
            f"- QA 状态：{passed}",
            f"- 审核状态：{'已通过' if summary.review_status in {'pass', 'approved'} else (summary.review_status or '-')}",
            f"- 交付包下载：{manifest.download_url}",
            "",
            "## 短视频清单",
            "",
            *[
                "\n".join(
                    [
                        f"### {index}. {clip.title or clip.clip_id}",
                        "",
                        f"- Clip ID：`{clip.clip_id}`",
                        f"- 时长：{clip.duration_seconds:.2f} 秒",
                        f"- 字幕：{'已生成' if clip.subtitle else '未生成'}",
                        f"- QA：{_customer_qa_label(clip.qa_status or summary.qa_status)}",
                        f"- 建议使用：可作为直播回放切片、商品种草短视频或客户二次审核素材。",
                        "",
                    ]
                )
                for index, clip in enumerate(clips, start=1)
            ],
            "## 使用建议",
            "",
            "- 优先挑选标题和画面都清晰的片段用于短视频平台发布。",
            "- 发布前建议再人工确认商品信息、价格、活动口径和平台合规要求。",
            "- 如需精修，可基于字幕文件、标题文案和交换素材继续二次编辑。",
            "",
            "## 交付说明",
            "",
            "交付包内包含成片、字幕、标题文案、QA 摘要和交换素材。剪映/CapCut 相关内容仅作为交换包/复建包使用，不承诺为官方工程文件或可直接导入的完整项目。",
            "",
        ]
    )


def _prepare_package_dirs(package_dir: Path) -> None:
    if package_dir.exists():
        shutil.rmtree(package_dir)
    for name in [
        "final_clips",
        "previews",
        "subtitles",
        "copywriting",
        "edit_plans",
        "qa_reports",
        "exchange",
        "debug_assets",
    ]:
        (package_dir / name).mkdir(parents=True, exist_ok=True)


def _zip_package(package_dir: Path) -> Path:
    zip_path = package_dir.parent / DELIVERY_PACKAGE_ZIP
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package_dir.rglob("*")):
            if path.is_file():
                arcname = str(path.relative_to(package_dir.parent))
                info = zipfile.ZipInfo(arcname)
                info.date_time = (1980, 1, 1, 0, 0, 0)
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
    return zip_path


def _package_dir(job_id: str) -> Path:
    return EXPORTS_DIR / job_id / DELIVERY_PACKAGE_DIRNAME


def _project_file(rel: str | None) -> Path | None:
    if not rel:
        return None
    path = (PROJECT_ROOT / rel).resolve()
    if not _is_inside_project(path) or not path.is_file():
        return None
    return path


def _is_inside_project(path: Path) -> bool:
    try:
        path.resolve().relative_to(PROJECT_ROOT.resolve())
        return True
    except ValueError:
        return False


def _find_manifest_by_package_id(package_id: str) -> Path | None:
    for manifest_path in EXPORTS_DIR.glob(f"*/{DELIVERY_PACKAGE_DIRNAME}/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if manifest.get("package_id") == package_id:
            return manifest_path
    return None


def _customer_status_label(result_json: dict[str, Any], task: Task) -> str:
    status = result_json.get("status") or task.status
    review_status = result_json.get("review_status") or task.review_status
    if status == "failed":
        return "生成失败"
    if status in {"running", "created"}:
        return "正在生成切片"
    if review_status in {"pass", "approved"}:
        return "审核通过，可生成交付包"
    if status == "ok" or review_status == "pending_review":
        return "等待审核"
    return "素材已就绪" if task.material_id else "素材待上传"


def _customer_next_action(result_json: dict[str, Any], task: Task) -> list[str]:
    qa_status = (result_json.get("qa_result") or {}).get("qa_status")
    review_status = result_json.get("review_status") or task.review_status
    if qa_status != "passed":
        return ["请先完成 QA 修复，通过后再导出交付包。"]
    if review_status not in {"pass", "approved"}:
        return ["请先通过人工审核，再导出交付包。"]
    return ["可以下载交付包。"]


def _customer_qa_label(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"passed", "pass", "true"}:
        return "通过"
    if normalized in {"failed", "fail", "false"}:
        return "未通过"
    return str(value or "-")


def _stable_created_at(result: TaskResult) -> str:
    value = getattr(result, "created_at", None)
    if value:
        try:
            return value.replace(tzinfo=timezone.utc).isoformat()
        except AttributeError:
            return str(value)
    return datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()


def _execution_time_summary(batch_state: dict[str, Any]) -> dict[str, Any]:
    stages = batch_state.get("stages") or {}
    return {
        "source": "batch_state",
        "stage_count": len(stages),
        "completed_stage_count": sum(
            1 for item in stages.values() if isinstance(item, dict) and item.get("status") == "completed"
        ),
        "total_duration_ms": batch_state.get("duration_ms") or 0,
    }


def _worker_summary(result_json: dict[str, Any]) -> dict[str, Any]:
    return {
        "dag_version": str(result_json.get("dag_version") or "liveclip_dag_v1_4_1"),
        "cpu_workers": ["ffmpeg_agent", "scene_detect_agent", "clip_score_agent"],
        "gpu_workers": ["whisper_agent", "caption_agent"],
        "io_workers": ["delivery_agent"],
    }


def _blocked(
    missing_inputs: list[str],
    message: str,
    *,
    result_json: dict[str, Any] | None = None,
) -> dict:
    return {
        "status": "blocked",
        "message": message,
        "data": {"result": result_json or {}},
        "missing_inputs": missing_inputs,
        "warnings": [],
        "next_action": [message],
    }


def _dump_model(model: Any) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return model.dict()
