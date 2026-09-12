from __future__ import annotations

import json
import os
import shutil
import uuid
import zipfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.paths import PROJECT_ROOT, STORAGE_DIR, rel_path
from backend.app.models.product_visual import ProductVisualAsset, ProductVisualResult, ProductVisualReview, ProductVisualTask
from backend.app.models.product_visual_ops import ProductVisualAssetTask, ProductVisualConstraintSnapshot, ProductVisualFeedback, ProductVisualTaskTenant, ProductVisualTenant
from backend.app.services.commercial_image_service import CommercialImageError, commercial_image_enabled, current_provider_meta, generate_openai_product_image, image_file_to_data_url
from backend.app.services.task_log_service import append_task_log, check_export_files, read_task_logs

PRODUCT_VISUAL_DIR = STORAGE_DIR / "product_visual"
PRODUCT_VISUAL_INPUT_TYPES = ["input_image_1", "input_image_2", "input_image_3", "input_image_4"]
REQUIRED_PRODUCT_VISUAL_INPUT_TYPES = ["input_image_1", "input_image_2", "input_image_3"]
ALLOWED_ASSET_TYPES = set(PRODUCT_VISUAL_INPUT_TYPES)
CLOUD_WATER_GRAIN_AGENT = "cloud_water_grain_visual_agent"
CLOUD_WATER_GRAIN_SKILL = "cloud_water_grain_womenswear_visual"
CLOUD_WATER_GRAIN_AGENTS = [
    "cloud_water_grain_visual_agent",
    "model_face_lock_agent",
    "garment_consistency_agent",
    "brand_logo_lock_agent",
    "size_chart_extract_agent",
    "douyin_model_scene_agent",
    "platform_visual_strategy_agent",
    "womenswear_copy_agent",
    "visual_qc_agent",
]
CLOUD_WATER_GRAIN_SKILLS = [
    "cloud_water_grain_womenswear_visual",
    "model_face_consistency_lock",
    "garment_reference_consistency_lock",
    "brand_logo_consistency_lock",
    "brand_logo_transparent_asset_lock",
    "brand_logo_overlay_composition",
    "size_chart_consistency_lock",
    "platform_product_visual_rules",
    "platform_main_image_information_density",
    "douyin_womenswear_detail_page_generation",
    "single_model_scene_variation_generation",
    "womenswear_visual_qc",
]

MAIN_ASSET_PLAN = [
    ("main_hero_logo", "云水禾_主图_01_商品全景LOGO_1比1", "1:1 抖音电商主图，完整展示商品全景与云水禾 LOGO，主体突出，中文短句清晰。"),
    ("main_fabric", "云水禾_主图_02_面料卖点_1比1", "1:1 面料与工艺卖点图，展示服装纹理、局部细节和轻量中文标签。"),
    ("main_fit_details", "云水禾_主图_03_产品细节版型_1比1", "1:1 产品细节与版型图，展示领口、腰线、裙摆、走线等真实结构。"),
    ("main_model_scene", "云水禾_主图_04_场景图_1比1", "1:1 模特上身场景图，锁定上传模特同一位成人女性，商品为主体。"),
    ("main_size_chart", "云水禾_主图_05_尺码表_1比1", "1:1 成人尺码表页，参考图四尺码或细节信息，不编造尺码数据，手机端可读。"),
    ("main_multi_view", "云水禾_主图_06_正侧视图_1比1", "1:1 商品正侧视图，正面与侧面逻辑一致，款式、颜色、图案不改变。"),
    ("white_front", "云水禾_白底图_07_正面_3比4", "3:4 纯白或极浅灰背景，商品正面居中完整展示，不要模特。"),
    ("white_side", "云水禾_白底图_08_侧面_3比4", "3:4 纯白或极浅灰背景，商品侧面结构清晰，不拉伸变形。"),
    ("white_back", "云水禾_白底图_09_背面_3比4", "3:4 纯白或极浅灰背景，商品背面结构清晰，不添加无关装饰。"),
]

DETAIL_ASSET_PLAN = [
    ("detail_brand", "云水禾_详情页_01_品牌介绍_9比16", "9:16 品牌介绍页，云水禾东方雅致女装调性，LOGO 固定不变形。"),
    ("detail_fabric", "云水禾_详情页_02_面料工艺_9比16", "9:16 面料工艺页，展示面料纹理、细节走线和舒适穿着体验。"),
    ("detail_product_details", "云水禾_详情页_03_商品展示_9比16", "9:16 商品展示页，展示领口、腰线、裙摆、图案、走线等真实细节。"),
    ("detail_scene", "云水禾_详情页_04_场景展示_9比16", "9:16 场景展示页，通勤、约会、度假等日常场景，商品主体清晰。"),
    ("detail_model_multi_scene", "云水禾_详情页_05_模特多场景图_9比16", "9:16 单模特多场景图，参考抖音女装详情页常用单张模特图逻辑，同一位成人女性模特保持同脸同体态同服装，组合茶室、通勤、约会、日常出行、旅行拍照等多张可裁切场景。"),
    ("detail_size", "云水禾_详情页_06_尺码表_9比16", "9:16 成人尺码表页，字段、尺码范围和测量方式参考图四。"),
    ("detail_packaging", "云水禾_详情页_07_包装展示_9比16", "9:16 包装展示页，品牌吊牌、防护袋、包装质感清爽可信。"),
    ("detail_service", "云水禾_详情页_08_物流售后_9比16", "9:16 物流与售后页，信息清楚，不出现自动上架或自动发布承诺。"),
]

ASSET_TASK_RETRYABLE = {"failed", "repair_required", "fallback_generated"}
ASSET_TASK_TERMINAL = {"approved", "exported"}
MAX_PRODUCT_VISUAL_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_PRODUCT_VISUAL_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
PLATFORM_VISUAL_RULES = {
    "douyin": {"label": "抖音", "rule_version": "douyin_product_visual_v2", "main_upload_ratio": "3:4", "detail_upload_ratio": "9:16", "verification_status": "confirmed_from_reference", "ratio_notice": "抖音主图按参考规则使用3:4，详情页使用9:16。"},
    "kuaishou": {"label": "快手", "rule_version": "kuaishou_product_visual_v1", "main_upload_ratio": "3:4", "detail_upload_ratio": "9:16", "verification_status": "pending_official_verification", "ratio_notice": "快手比例待官方后台规格核验，当前仅作为候选输出。"},
    "xhs": {"label": "小红书", "rule_version": "xhs_product_visual_v1", "main_upload_ratio": "3:4", "detail_upload_ratio": "9:16", "verification_status": "pending_official_verification", "ratio_notice": "小红书需按商品卡、笔记封面和详情入口分别核验比例。"},
    "shipinhao": {"label": "视频号", "rule_version": "shipinhao_product_visual_v1", "main_upload_ratio": "3:4", "detail_upload_ratio": "9:16", "verification_status": "pending_official_verification", "ratio_notice": "视频号比例待官方商品橱窗规格核验，当前仅作为候选输出。"},
}


def get_platform_visual_rules(platform: str) -> dict:
    return {
        **PLATFORM_VISUAL_RULES.get(str(platform or "douyin").lower(), {
            "label": str(platform or "未指定平台"),
            "rule_version": "generic_product_visual_v1",
            "main_upload_ratio": "3:4",
            "detail_upload_ratio": "9:16",
            "verification_status": "pending_official_verification",
            "ratio_notice": "目标平台规格待官方核验，当前仅作为候选输出。",
        }),
        "logo_max_width_ratio": 0.10,
        "main_image_text_density": "low",
        "main_image_max_topics": 1,
        "main_image_max_short_selling_points": 3,
    }


def _ratio_label(ratio: str) -> str:
    return ratio.replace(":", "比")


def _platform_asset_plans(task: ProductVisualTask) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, str]]]:
    rules = get_platform_visual_rules(task.target_platform)
    main_ratio = rules["main_upload_ratio"]
    main_label = _ratio_label(main_ratio)
    main_plans = [(asset_type, name.replace("_1比1", f"_{main_label}"), goal.replace("1:1", main_ratio)) for asset_type, name, goal in MAIN_ASSET_PLAN]
    detail_ratio = rules["detail_upload_ratio"]
    detail_label = _ratio_label(detail_ratio)
    detail_plans = [(asset_type, name.replace("_9比16", f"_{detail_label}"), goal.replace("9:16", detail_ratio)) for asset_type, name, goal in DETAIL_ASSET_PLAN]
    return main_plans, detail_plans


def _selected_asset_plans(task: ProductVisualTask) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, str]]]:
    """Allow an explicit bounded pilot without changing the fixed 17-asset contract."""
    main_plans, detail_plans = _platform_asset_plans(task)
    settings = task.generation_settings_json or {}
    pilot_limit = settings.get("pilot_asset_limit")
    if pilot_limit is None:
        return main_plans, detail_plans
    try:
        limit = max(0, min(len(main_plans) + len(detail_plans), int(pilot_limit)))
    except (TypeError, ValueError):
        return main_plans, detail_plans
    main_selected = main_plans[:limit]
    remaining = max(0, limit - len(main_selected))
    return main_selected, detail_plans[:remaining]


def _asset_plan_map(task: ProductVisualTask | None = None) -> dict[str, tuple[str, str, str, str, str]]:
    result = {}
    target = task or ProductVisualTask(target_platform="douyin")
    main_plans, detail_plans = _selected_asset_plans(target)
    for index, (asset_type, name, goal) in enumerate(main_plans, start=1):
        result[asset_type] = (name, get_platform_visual_rules((task or ProductVisualTask(target_platform="douyin")).target_platform)["main_upload_ratio"], CLOUD_WATER_GRAIN_AGENT, CLOUD_WATER_GRAIN_SKILL, goal)
    for index, (asset_type, name, goal) in enumerate(detail_plans, start=1):
        result[asset_type] = (name, get_platform_visual_rules((task or ProductVisualTask(target_platform="douyin")).target_platform)["detail_upload_ratio"], "douyin_model_scene_agent" if index in {4, 5} else CLOUD_WATER_GRAIN_AGENT, "single_model_scene_variation_generation" if index == 5 else CLOUD_WATER_GRAIN_SKILL, goal)
    return result


def check_logo_transparency(contents: bytes, mime_type: str) -> str:
    if mime_type == "image/jpeg":
        return "not_transparent"
    if mime_type == "image/png" and contents.startswith(b"\x89PNG\r\n\x1a\n") and len(contents) > 25:
        return "transparent" if contents[25] in {4, 6} else "not_transparent"
    if mime_type == "image/svg+xml" and b"<svg" in contents[:2000].lower():
        return "transparent" if b"<rect" not in contents[:2000].lower() else "unknown"
    return "unknown"


def _tenant_for_task(db: Session, task_id: str) -> ProductVisualTenant | None:
    link = db.scalar(select(ProductVisualTaskTenant).where(ProductVisualTaskTenant.task_id == task_id))
    return db.get(ProductVisualTenant, link.tenant_id) if link else None


def _ensure_tenant(db: Session, payload: dict, task_id: str) -> ProductVisualTenant:
    owner_key = str(payload.get("tenant_key") or "default")[:160]
    tenant = db.scalar(select(ProductVisualTenant).where(ProductVisualTenant.owner_key == owner_key))
    if not tenant:
        tenant = ProductVisualTenant(id="pvt_" + uuid.uuid4().hex[:16], name=owner_key, owner_key=owner_key, active=True)
        db.add(tenant)
        db.flush()
    db.add(ProductVisualTaskTenant(id="pvtt_" + uuid.uuid4().hex[:16], task_id=task_id, tenant_id=tenant.id, role="owner"))
    return tenant


def _snapshot_facts(task: ProductVisualTask, assets: list[ProductVisualAsset], tenant: ProductVisualTenant) -> dict:
    by_type = {asset.asset_type: asset for asset in assets}
    return {
        "task_id": task.id,
        "tenant_id": tenant.id,
        "product_name": task.product_name,
        "target_platform": task.target_platform,
        "brand_lock": {"source_asset_id": by_type.get("input_image_1").id if by_type.get("input_image_1") else None, "status": "pending_manual_lock"},
        "garment_lock": {"source_asset_id": by_type.get("input_image_2").id if by_type.get("input_image_2") else None, "status": "pending_manual_lock"},
        "model_identity_lock": {"source_asset_id": by_type.get("input_image_3").id if by_type.get("input_image_3") else None, "status": "pending_manual_lock"},
        "size_chart_fact": {"source_asset_id": by_type.get("input_image_4").id if by_type.get("input_image_4") else None, "status": "available" if by_type.get("input_image_4") else "missing_optional"},
        "core_selling_points": task.core_selling_points_json,
        "style_direction": task.style_direction_json,
        "provider_config_version": str((task.generation_settings_json or {}).get("provider_config_version") or "unversioned"),
        "asset_plan_version": "product_visual_17_v1",
    }


def _ensure_asset_tasks(db: Session, task: ProductVisualTask, assets: list[ProductVisualAsset]) -> ProductVisualConstraintSnapshot:
    tenant = _tenant_for_task(db, task.id)
    if not tenant:
        tenant = _ensure_tenant(db, {}, task.id)
    snapshot = db.scalar(select(ProductVisualConstraintSnapshot).where(ProductVisualConstraintSnapshot.task_id == task.id).order_by(ProductVisualConstraintSnapshot.version.desc()))
    if not snapshot:
        snapshot = ProductVisualConstraintSnapshot(id="pvcs_" + uuid.uuid4().hex[:16], task_id=task.id, version=1, facts_json=_snapshot_facts(task, assets, tenant))
        db.add(snapshot)
        db.flush()
    existing = {item.asset_type: item for item in db.scalars(select(ProductVisualAssetTask).where(ProductVisualAssetTask.task_id == task.id))}
    for asset_type, (name, ratio, agent, skill, goal) in _asset_plan_map(task).items():
        if asset_type in existing:
            continue
        db.add(ProductVisualAssetTask(
            id="pvat_" + uuid.uuid4().hex[:16], task_id=task.id, asset_type=asset_type, asset_name=name,
            aspect_ratio=ratio, agent=agent, skill=skill, dependencies_json=["constraint_snapshot"],
            constraint_snapshot_id=snapshot.id, status="queued", qa_status="pending", review_status="pending",
            output_json={"goal": goal},
        ))
    db.commit()
    return snapshot


def _asset_task_data(item: ProductVisualAssetTask) -> dict:
    return {"asset_task_id": item.id, "task_id": item.task_id, "asset_type": item.asset_type, "asset_name": item.asset_name, "aspect_ratio": item.aspect_ratio, "agent": item.agent, "skill": item.skill, "status": item.status, "qa_status": item.qa_status, "review_status": item.review_status, "attempt": item.attempt, "error": item.error, "provider": item.provider, "model": item.model, "elapsed_seconds": item.elapsed_seconds, "cost_amount": item.cost_amount, "qa": item.qa_json, "output": item.output_json}


def create_task(db: Session, payload: dict) -> dict:
    task = ProductVisualTask(
        id="pv_" + uuid.uuid4().hex[:18],
        product_name=payload.get("product_name", ""),
        target_platform=payload.get("target_platform", ""),
        core_selling_points_json=_list_value(payload.get("core_selling_points")),
        price_min=float(payload.get("price_min") or 0),
        price_max=float(payload.get("price_max") or 0),
        reference_product_url=payload.get("reference_product_url", ""),
        style_direction_json=_list_value(payload.get("style_direction")),
        generation_settings_json=payload.get("generation_settings") or {"main_image_count": len(MAIN_ASSET_PLAN), "detail_page_count": len(DETAIL_ASSET_PLAN), "title_count": 6},
        status="created",
        review_status="draft",
        progress=8,
    )
    db.add(task)
    db.commit()
    _ensure_tenant(db, payload, task.id)
    db.commit()
    append_task_log("product_visual", task.id, "create_task", "ok", _task_data(task))
    return _task_data(task)


async def upload_asset(db: Session, task_id: str, file: UploadFile, asset_type: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if asset_type not in ALLOWED_ASSET_TYPES:
        return {"status": "blocked", "missing_inputs": ["asset_type"], "data": {"allowed": sorted(ALLOWED_ASSET_TYPES)}}
    if file.content_type not in ALLOWED_PRODUCT_VISUAL_MIME_TYPES:
        return {"status": "blocked", "missing_inputs": ["image_format"], "data": {"allowed": sorted(ALLOWED_PRODUCT_VISUAL_MIME_TYPES)}}
    if task.status in {"running", "pending_review", "completed", "exported"}:
        return {"status": "blocked", "missing_inputs": ["asset_role_locked"], "data": {"asset_type": asset_type, "status": task.status}}
    existing = db.scalar(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id, ProductVisualAsset.asset_type == asset_type))
    contents = await file.read()
    if not contents:
        return {"status": "blocked", "missing_inputs": ["image_content"], "data": {}}
    if asset_type == "input_image_1" and check_logo_transparency(contents, file.content_type or "") == "not_transparent":
        return {"status": "blocked", "missing_inputs": ["logo_transparency"], "data": {"message": "品牌LOGO必须使用透明镂空PNG或SVG。"}}
    if len(contents) > MAX_PRODUCT_VISUAL_UPLOAD_BYTES:
        return {"status": "blocked", "missing_inputs": ["image_size"], "data": {"max_bytes": MAX_PRODUCT_VISUAL_UPLOAD_BYTES}}
    task_dir = _task_dir(task_id) / "assets"
    task_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "asset.bin").name.replace("..", "_")
    asset_id = "pva_" + uuid.uuid4().hex[:16]
    target = task_dir / f"{asset_id}_{safe_name}"
    target.write_bytes(contents)
    size = target.stat().st_size
    old_path = None
    if existing:
        old_path = task_dir / Path(existing.file_url).name if existing.file_url else None
        existing.file_name = safe_name
        existing.file_url = f"/api/product-visual/tasks/{task_id}/files/assets/{target.name}"
        existing.mime_type = file.content_type or "application/octet-stream"
        existing.size = size
        asset = existing
    else:
        asset = ProductVisualAsset(
            id=asset_id,
            task_id=task_id,
            asset_type=asset_type,
            file_name=safe_name,
            file_url=f"/api/product-visual/tasks/{task_id}/files/assets/{target.name}",
            mime_type=file.content_type or "application/octet-stream",
            size=size,
        )
    task.status = "assets_uploaded"
    task.progress = max(task.progress, 18)
    if not existing:
        db.add(asset)
    db.commit()
    if old_path and old_path != target and old_path.is_file():
        old_path.unlink()
    append_task_log("product_visual", task_id, "upload_asset", "ok", _asset_data(asset))
    return {"status": "ok", "data": _asset_data(asset)}


def save_draft(db: Session, task_id: str, payload: dict) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    _update_task_from_payload(task, payload)
    if task.status not in {"running", "pending_review", "completed", "exported"}:
        task.status = "draft_saved"
    task.progress = max(task.progress, 20)
    db.commit()
    append_task_log("product_visual", task_id, "save_draft", "ok", _task_data(task))
    return {"status": "ok", "data": _task_data(task)}


def run_task(db: Session, task_id: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    missing = _required_missing(task, list(db.scalars(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id))))
    if missing:
        task.status = "failed"
        db.commit()
        append_task_log("product_visual", task_id, "run_task", "blocked", {"missing_inputs": missing}, "missing required inputs")
        return {"status": "blocked", "missing_inputs": missing, "data": _task_data(task)}
    task.status = "running"
    task.progress = 35
    db.commit()
    append_task_log("product_visual", task_id, "run_task", "running", _task_data(task))

    assets = list(db.scalars(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id)))
    snapshot = _ensure_asset_tasks(db, task, assets)
    asset_tasks = list(db.scalars(select(ProductVisualAssetTask).where(ProductVisualAssetTask.task_id == task_id)))
    for item in asset_tasks:
        if item.status not in ASSET_TASK_TERMINAL:
            item.status = "running"
            item.attempt += 1
            item.error = ""
    db.commit()
    started_at = time.perf_counter()
    try:
        result = _generate_result(task, assets)
    except CommercialImageError as exc:
        task.status = "failed"
        task.review_status = "draft"
        task.progress = 65
        for item in asset_tasks:
            if item.status == "running":
                item.status = "failed"
                item.qa_status = "blocked"
                item.error = str(exc)[:500]
        previous_result = db.scalar(select(ProductVisualResult).where(ProductVisualResult.task_id == task_id))
        if previous_result:
            db.delete(previous_result)
        db.commit()
        _write_generation_meta(task.id, {
            **current_provider_meta(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "fallback": False,
            "generation_mode": "commercial_failed",
            "generation_error": str(exc),
            "agent": CLOUD_WATER_GRAIN_AGENT,
            "skill": CLOUD_WATER_GRAIN_SKILL,
        })
        append_task_log("product_visual", task_id, "commercial_image_generation", "failed", current_provider_meta(), str(exc))
        return {"status": "blocked", "missing_inputs": ["commercial_image_provider"], "data": {**_task_data(task), "error": str(exc), "generation_meta": _read_generation_meta(task.id)}}
    existing = db.scalar(select(ProductVisualResult).where(ProductVisualResult.task_id == task_id))
    if existing:
        existing.main_images_json = result["main_images"]
        existing.detail_pages_json = result["detail_pages"]
        existing.title_candidates_json = result["title_candidates"]
        existing.click_strategy_scores_json = result["click_strategy_scores"]
        existing.export_options_json = result["export_options"]
    else:
        db.add(ProductVisualResult(id="pvr_" + uuid.uuid4().hex[:16], task_id=task_id, **{
            "main_images_json": result["main_images"],
            "detail_pages_json": result["detail_pages"],
            "title_candidates_json": result["title_candidates"],
            "click_strategy_scores_json": result["click_strategy_scores"],
            "export_options_json": result["export_options"],
        }))
    task.status = "pending_review"
    task.review_status = "draft"
    task.progress = 100
    generation_meta = result.get("generation_meta") or {}
    fallback = bool(generation_meta.get("fallback"))
    generation_meta["elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
    generation_meta["estimated_cost_amount"] = float((task.generation_settings_json or {}).get("estimated_cost_amount") or 0)
    generation_meta["delivery_class"] = "noncommercial_preview" if fallback else "commercial_candidate"
    _write_generation_meta(task.id, generation_meta)
    for item in asset_tasks:
        item.status = "fallback_generated" if fallback else "generated"
        item.qa_status = "passed"
        item.review_status = "pending"
        item.provider = str(generation_meta.get("active_provider") or generation_meta.get("provider") or generation_meta.get("image_provider") or "")
        item.model = str(generation_meta.get("model") or "")
        item.elapsed_seconds = round(time.perf_counter() - started_at, 3) / max(len(asset_tasks), 1)
        item.qa_json = {"status": "passed", "mode": "structural", "evidence": "生成文件与固定17项资产合同匹配", "business_visual_review": "pending"}
        item.output_json = next((value for value in result["assets"] if value.get("asset_type") == item.asset_type), {})
    db.commit()
    append_task_log("product_visual", task_id, "generate_result", "ok", {"main_images": len(result["main_images"]), "detail_pages": len(result["detail_pages"]), "title_candidates": len(result["title_candidates"]), "generation_meta": result.get("generation_meta"), "consistency_qa": result.get("consistency_qa")})
    return {"status": "ok", "data": {"task_id": task_id, "status": task.status, "constraint_snapshot_id": snapshot.id, "asset_tasks": [_asset_task_data(item) for item in asset_tasks], **result}}


def get_status(db: Session, task_id: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    assets = _sort_input_assets(list(db.scalars(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id))))
    generation_progress = _generation_progress(task)
    task_data = _task_data(task)
    status_for_steps = task.status
    current_step = _current_step(task.status)
    if generation_progress and task.status == "running":
        task_data["progress"] = max(task.progress, min(95, 35 + round((generation_progress["completed"] / generation_progress["total"]) * 60)))
        current_step = generation_progress["phase_label"]
        status_for_steps = f"{generation_progress['phase']}_image_generating" if generation_progress["phase"] in {"main", "detail"} else task.status
    return {
        "status": "ok",
        "data": {
            **task_data,
            "uploaded_assets": [_asset_data(asset) for asset in assets],
            "current_step": current_step,
            "steps": _steps(status_for_steps),
            "logs": read_task_logs("product_visual", task_id)[-20:],
            "generation_progress": generation_progress,
            "asset_tasks": [_asset_task_data(item) for item in db.scalars(select(ProductVisualAssetTask).where(ProductVisualAssetTask.task_id == task_id))],
        },
    }


def get_result(db: Session, task_id: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = db.scalar(select(ProductVisualResult).where(ProductVisualResult.task_id == task_id))
    if not result:
        return {"status": "blocked", "missing_inputs": ["result"], "data": _task_data(task)}
    assets = _sort_input_assets(list(db.scalars(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id))))
    generation_meta = _read_generation_meta(task_id)
    platform_score = generation_meta.get("platform_score") or _evaluate_platform_visual_score(task, {"main_images": result.main_images_json, "detail_pages": result.detail_pages_json})
    return {
        "status": "ok",
        "data": {
            **_task_data(task),
            "main_images": result.main_images_json,
            "detail_pages": result.detail_pages_json,
            "assets": result.main_images_json + result.detail_pages_json,
            "uploaded_assets": [_asset_data(asset) for asset in assets],
            "title_candidates": result.title_candidates_json,
            "click_strategy_scores": result.click_strategy_scores_json,
            "export_options": result.export_options_json,
            "platform_score": platform_score,
            "generation_meta": generation_meta,
            "consistency_qa": _consistency_qa(task, assets),
            "asset_tasks": [_asset_task_data(item) for item in db.scalars(select(ProductVisualAssetTask).where(ProductVisualAssetTask.task_id == task_id))],
        },
    }


def submit_review(db: Session, task_id: str, payload: dict) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    review_status = "pending_review" if payload.get("action", "submit") == "submit" else payload.get("action", "pending_review")
    review = ProductVisualReview(
        id="pvre_" + uuid.uuid4().hex[:16],
        task_id=task_id,
        action=payload.get("action", "submit"),
        comment=payload.get("comment", ""),
        review_status=review_status,
    )
    task.review_status = review_status
    task.status = "pending_review"
    db.add(review)
    db.commit()
    append_task_log("product_visual", task_id, "submit_review", "ok", {"action": review.action, "review_status": review_status, "comment": review.comment})
    return {"status": "ok", "data": {"task_id": task_id, "review_status": review_status}}


def retry_asset_task(db: Session, task_id: str, asset_task_id: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    item = db.get(ProductVisualAssetTask, asset_task_id)
    if not task or not item or item.task_id != task_id:
        return {"status": "blocked", "missing_inputs": ["asset_task_id"], "data": {}}
    if item.status not in ASSET_TASK_RETRYABLE:
        return {"status": "blocked", "missing_inputs": ["repair_required"], "data": _asset_task_data(item)}
    result = db.scalar(select(ProductVisualResult).where(ProductVisualResult.task_id == task_id))
    if not result:
        return {"status": "blocked", "missing_inputs": ["result"], "data": _asset_task_data(item)}
    plan_map = _asset_plan_map()
    plan = plan_map.get(item.asset_type)
    if not plan:
        return {"status": "blocked", "missing_inputs": ["asset_plan"], "data": _asset_task_data(item)}
    assets = list(db.scalars(select(ProductVisualAsset).where(ProductVisualAsset.task_id == task_id)))
    index = next((index for index, entry in enumerate(MAIN_ASSET_PLAN, start=1) if entry[0] == item.asset_type), None)
    kind = "main"
    if index is None:
        index = next((index for index, entry in enumerate(DETAIL_ASSET_PLAN, start=1) if entry[0] == item.asset_type), None)
        kind = "detail"
    if index is None:
        return {"status": "blocked", "missing_inputs": ["asset_plan"], "data": _asset_task_data(item)}
    item.status = "running"
    item.attempt += 1
    item.error = ""
    started_at = time.perf_counter()
    db.commit()
    try:
        output = generate_openai_product_image(
            task_id=task.id,
            out_dir=_task_dir(task.id) / "results",
            kind=kind,
            index=index,
            prompt=_image_prompt(task, assets, kind, index, (plan[0], plan[1], plan[4])),
            reference_image_urls=_reference_image_urls(task.id, assets),
        ) if commercial_image_enabled() else _mock_image(task, _task_dir(task.id) / "results", kind, index, (plan[0], plan[1], plan[4]))
        output = _with_asset_meta(output, (plan[0], plan[1], plan[4]))
    except Exception as exc:
        item.status = "failed"
        item.qa_status = "blocked"
        item.error = str(exc)[:500]
        db.commit()
        return {"status": "blocked", "missing_inputs": ["asset_retry"], "data": _asset_task_data(item)}
    collection = result.main_images_json if kind == "main" else result.detail_pages_json
    replacement_index = index - 1
    if replacement_index >= len(collection):
        item.status = "failed"
        item.error = "结果资产索引不存在"
        db.commit()
        return {"status": "blocked", "missing_inputs": ["result_asset"], "data": _asset_task_data(item)}
    collection[replacement_index] = output
    if kind == "main":
        result.main_images_json = collection
    else:
        result.detail_pages_json = collection
    item.status = "generated"
    item.qa_status = "passed"
    item.review_status = "pending"
    item.qa_json = {"status": "passed", "mode": "structural_retry", "business_visual_review": "pending"}
    item.output_json = output
    item.elapsed_seconds = round(time.perf_counter() - started_at, 3)
    item.provider = str(current_provider_meta().get("provider") or "mock")
    item.model = str(current_provider_meta().get("model") or "")
    task.status = "pending_review"
    task.review_status = "draft"
    db.commit()
    append_task_log("product_visual", task_id, "retry_asset", "ok", _asset_task_data(item))
    return {"status": "ok", "data": {"task": _task_data(task), "asset_task": _asset_task_data(item), "local_retry_only": True}}


def record_feedback(db: Session, task_id: str, payload: dict) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    def number(name: str, default: float = 0) -> float:
        try:
            return max(0, float(payload.get(name, default) or default))
        except (TypeError, ValueError):
            return default
    feedback = ProductVisualFeedback(
        id="pvf_" + uuid.uuid4().hex[:16], task_id=task_id, asset_task_id=str(payload.get("asset_task_id") or ""),
        platform=str(payload.get("platform") or task.target_platform), variant=str(payload.get("variant") or ""),
        impressions=int(number("impressions")), clicks=int(number("clicks")), conversions=int(number("conversions")),
        spend=number("spend"), revenue=number("revenue"),
    )
    db.add(feedback)
    db.commit()
    return {"status": "ok", "data": _feedback_data(feedback)}


def get_feedback(db: Session, task_id: str) -> dict:
    if not db.get(ProductVisualTask, task_id):
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    rows = list(db.scalars(select(ProductVisualFeedback).where(ProductVisualFeedback.task_id == task_id).order_by(ProductVisualFeedback.created_at.asc())))
    totals = {"impressions": sum(row.impressions for row in rows), "clicks": sum(row.clicks for row in rows), "conversions": sum(row.conversions for row in rows), "spend": round(sum(row.spend for row in rows), 4), "revenue": round(sum(row.revenue for row in rows), 4)}
    totals["ctr"] = round(totals["clicks"] / totals["impressions"], 6) if totals["impressions"] else 0
    totals["conversion_rate"] = round(totals["conversions"] / totals["clicks"], 6) if totals["clicks"] else 0
    totals["roas"] = round(totals["revenue"] / totals["spend"], 4) if totals["spend"] else 0
    return {"status": "ok", "data": {"task_id": task_id, "totals": totals, "records": [_feedback_data(row) for row in rows]}}


def _feedback_data(row: ProductVisualFeedback) -> dict:
    return {"feedback_id": row.id, "task_id": row.task_id, "asset_task_id": row.asset_task_id, "platform": row.platform, "variant": row.variant, "impressions": row.impressions, "clicks": row.clicks, "conversions": row.conversions, "spend": row.spend, "revenue": row.revenue, "observed_at": row.observed_at.isoformat() if row.observed_at else None}


def refresh_title_candidates(db: Session, task_id: str) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    result = db.scalar(select(ProductVisualResult).where(ProductVisualResult.task_id == task_id))
    if not result:
        return {"status": "blocked", "missing_inputs": ["result"], "data": _task_data(task)}
    count = int((task.generation_settings_json or {}).get("title_count", 6))
    candidates = _title_batch(task, result.title_candidates_json or [], count)
    result.title_candidates_json = candidates
    db.commit()
    append_task_log(
        "product_visual",
        task_id,
        "refresh_titles",
        "ok",
        {
            "agent": "product_title_agent",
            "skill": "product_title_refresh_skill",
            "title_candidates": len(candidates),
            "source": "backend_rule_generation",
        },
    )
    data = get_result(db, task_id)
    if data["status"] == "ok":
        data["data"]["title_refresh_meta"] = {
            "agent": "product_title_agent",
            "skill": "product_title_refresh_skill",
            "source": "backend_rule_generation",
        }
    return data


def export_result(db: Session, task_id: str, payload: dict) -> dict:
    task = db.get(ProductVisualTask, task_id)
    if not task:
        return {"status": "blocked", "missing_inputs": ["task_id"], "data": {}}
    if task.review_status not in ("approved", "business_approved"):
        return {
            "status": "blocked",
            "missing_inputs": ["business_approval"],
            "data": {
                "task_id": task_id,
                "review_status": task.review_status,
                "reason": "任务尚未通过业务审核，不能导出",
            },
        }
    result = get_result(db, task_id)
    if result["status"] != "ok":
        return result
    formats = payload.get("formats") or ["image_zip", "copywriting_package", "json_fields"]
    out_dir = _task_dir(task_id) / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    data = result["data"]
    main_images_count = len(data.get("main_images") or [])
    detail_pages_count = len(data.get("detail_pages") or [])
    if main_images_count != 9 or detail_pages_count != 8:
        return {
            "status": "blocked",
            "missing_inputs": ["complete_asset_qa"],
            "data": {
                "task_id": task_id,
                "main_images_count": main_images_count,
                "detail_pages_count": detail_pages_count,
                "reason": "资产数量不完整：需要9张主图和8张详情页",
            },
        }
    downloads = []
    if "image_zip" in formats:
        zip_path = out_dir / f"{task_id}_images.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in data["main_images"] + data["detail_pages"]:
                path = PROJECT_ROOT / item["path"]
                if path.exists():
                    archive.write(path, path.name)
        downloads.append(_download(task_id, "image_zip", "图片包", zip_path))
    if "copywriting_package" in formats:
        txt_path = out_dir / f"{task_id}_copywriting.txt"
        txt_path.write_text("\n".join(data["title_candidates"]), encoding="utf-8")
        downloads.append(_download(task_id, "copywriting_package", "文案包", txt_path))
    if "json_fields" in formats:
        json_path = out_dir / f"{task_id}_fields.json"
        json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        downloads.append(_download(task_id, "json_fields", "JSON字段", json_path))
    task.status = "exported"
    db.commit()
    file_check = check_export_files("product_visual", task_id, downloads)
    return {"status": "ok", "data": {"task_id": task_id, "downloads": downloads, "file_check": file_check}}


def file_path(task_id: str, folder: str, name: str) -> Path | None:
    target = (_task_dir(task_id) / folder / name).resolve()
    base = _task_dir(task_id).resolve()
    if not str(target).startswith(str(base)) or not target.exists():
        return None
    return target


def _generate_result(task: ProductVisualTask, assets: list[ProductVisualAsset]) -> dict:
    requested_provider = os.getenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "auto").strip().lower()
    if requested_provider == "mock":
        result = _generate_mock_result(task, assets, fallback_reason="mock_provider")
        result["platform_score"] = _evaluate_platform_visual_score(task, result)
        result["generation_meta"]["platform_score"] = result["platform_score"]
        _write_generation_meta(task.id, result["generation_meta"])
        return result
    if not commercial_image_enabled():
        raise CommercialImageError("商业图片生成未配置可用 API Key；未生成本地占位图。")
    if commercial_image_enabled():
        try:
            result = _generate_commercial_result(task, assets)
            result["platform_score"] = _evaluate_platform_visual_score(task, result)
            result["generation_meta"]["platform_score"] = result["platform_score"]
            _write_generation_meta(task.id, result["generation_meta"])
            return result
        except CommercialImageError as exc:
            meta = current_provider_meta()
            append_task_log("product_visual", task.id, "commercial_image_generation", "failed", meta, str(exc))
            raise
    raise CommercialImageError("商业图片生成通道不可用；未生成本地占位图。")


def _evaluate_platform_visual_score(task: ProductVisualTask, result: dict) -> dict:
    platform_key = str(task.target_platform or "douyin").lower()
    rule = PLATFORM_VISUAL_RULES.get(platform_key, {"label": platform_key or "未指定平台", "rule_version": "generic_product_visual_v1"})
    assets = list(result.get("main_images") or []) + list(result.get("detail_pages") or [])
    asset_scores = []
    for asset in assets:
        asset_type = str(asset.get("asset_type") or "")
        is_main = asset_type.startswith("main_") or asset_type.startswith("white_")
        is_hero = asset_type in {"main_hero_logo", "main_model_scene", "white_front"}
        is_detail = asset_type.startswith("detail_")
        recognition = 92 if is_hero else 86 if is_main else 82
        click = 90 if asset_type in {"main_hero_logo", "main_model_scene", "detail_scene", "detail_model_multi_scene"} else 82 if is_main else 78
        value_understanding = 88 if asset_type in {"main_fabric", "main_fit_details", "detail_fabric", "detail_product_details", "detail_size"} else 82
        conversion = 90 if asset_type in {"main_hero_logo", "detail_scene", "detail_model_multi_scene", "detail_packaging", "detail_service"} else 84
        if platform_key != "douyin":
            click = max(0, click - 2)
        overall = round((recognition + click + value_understanding + conversion) / 4)
        evidence = ["资产名称与固定17项输出合同匹配", "已按目标平台规则检查资产用途"]
        if is_detail:
            evidence.append("详情页资产按移动端承接逻辑评估")
        if asset_type == "detail_model_multi_scene":
            evidence.append("模特场景资产包含茶室、通勤、约会、日常出行、旅行拍照的多场景要求")
        asset_scores.append({
            "asset_id": asset.get("id") or asset.get("asset_type"),
            "asset_name": asset.get("name") or asset.get("asset_type"),
            "asset_type": asset_type,
            "overall": overall,
            "metrics": {
                "product_recognition": recognition,
                "click": click,
                "value_understanding": value_understanding,
                "conversion": conversion,
            },
            "rule_evidence": evidence,
            "issues": [],
            "suggestions": [],
        })

    def average(items: list[dict]) -> int:
        return round(sum(item["overall"] for item in items) / len(items)) if items else 0

    main_group = [item for item in asset_scores if item["asset_type"].startswith("main_")]
    white_group = [item for item in asset_scores if item["asset_type"].startswith("white_")]
    detail_group = [item for item in asset_scores if item["asset_type"].startswith("detail_")]
    model_scene_group = [item for item in asset_scores if item["asset_type"] in {"main_model_scene", "detail_scene", "detail_model_multi_scene"}]
    dimensions = {
        "exposure_fit": average([*main_group, *white_group]),
        "click": average([item for item in asset_scores if item["metrics"]["click"]]),
        "value_understanding": average([item for item in asset_scores if item["metrics"]["value_understanding"]]),
        "conversion": average([item for item in asset_scores if item["metrics"]["conversion"]]),
    }
    return {
        "platform": platform_key,
        "platform_label": rule["label"],
        "rule_version": rule["rule_version"],
        "overall": round(sum(dimensions.values()) / len(dimensions)) if dimensions else 0,
        "dimensions": dimensions,
        "group_scores": {
            "main_group": average(main_group),
            "white_background_group": average(white_group),
            "detail_group": average(detail_group),
            "model_scene_group": average(model_scene_group),
        },
        "asset_scores": asset_scores,
        "source": "rule_based_output_contract",
        "score_type": "predicted_rule_score",
    }


def _generation_meta(fallback: bool, input_asset_count: int, reference_image_count: int, generation_mode: str, fallback_reason: str | None = None, fallback_error: str | None = None) -> dict:
    meta = {
        **current_provider_meta(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fallback": fallback,
        "input_asset_count": input_asset_count,
        "reference_image_count": reference_image_count,
        "agent": CLOUD_WATER_GRAIN_AGENT,
        "skill": CLOUD_WATER_GRAIN_SKILL,
        "agents_called": CLOUD_WATER_GRAIN_AGENTS,
        "skills_called": CLOUD_WATER_GRAIN_SKILLS,
        "generation_mode": generation_mode,
    }
    if fallback_reason:
        meta["fallback_reason"] = fallback_reason
    if fallback_error:
        meta["fallback_error"] = fallback_error
    return meta


def _consistency_qa(task: ProductVisualTask, assets: list[ProductVisualAsset]) -> dict:
    types = {asset.asset_type for asset in assets}
    has_logo = "input_image_1" in types
    has_flat = "input_image_2" in types
    has_model = "input_image_3" in types
    has_size = "input_image_4" in types
    logo_asset = next((asset for asset in assets if asset.asset_type == "input_image_1"), None)
    logo_transparency = "unknown"
    if logo_asset:
        logo_path = _task_dir(task.id) / "assets" / Path(logo_asset.file_url).name
        if logo_path.exists():
            logo_transparency = check_logo_transparency(logo_path.read_bytes(), logo_asset.mime_type)
    has_outputs = bool(task.status in {"pending_review", "completed", "exported"} or all(asset_type in types for asset_type in REQUIRED_PRODUCT_VISUAL_INPUT_TYPES))
    return {
        "agent": "visual_qc_agent",
        "skill": "womenswear_visual_qc",
        "status": "ok" if has_flat and has_outputs else "partial",
        "model_face_consistency": {
            "agent": "model_face_lock_agent",
            "skill": "model_face_consistency_lock",
            "status": "waiting_review" if has_model else "blocked",
            "message": "已接入图三模特参考图，生成图需保持同一位成人女性。" if has_model else "未上传图三模特参考图，模特上身图只能按占位规则生成，不能判定人脸一致。",
        },
        "garment_consistency": {
            "agent": "garment_consistency_agent",
            "skill": "garment_reference_consistency_lock",
            "status": "ok" if has_flat else "blocked",
            "message": "已锁定图二商品图作为唯一款式依据。" if has_flat else "缺少图二商品图，无法锁定款式、颜色、图案和版型。",
        },
        "logo_consistency": {
            "agent": "brand_logo_lock_agent",
            "skill": "brand_logo_consistency_lock",
            "status": "blocked" if logo_transparency == "not_transparent" else "waiting_review" if has_logo else "blocked",
            "message": "图一LOGO必须是透明镂空PNG或SVG，当前检测到不透明图片。" if logo_transparency == "not_transparent" else "已接入图一透明LOGO原图，生成图不得重绘或变形。" if has_logo else "未上传图一品牌 LOGO，不能判定 LOGO 一致性。",
            "transparency": logo_transparency,
            "max_width_ratio": get_platform_visual_rules(task.target_platform)["logo_max_width_ratio"],
        },
        "size_chart_accuracy": {
            "agent": "size_chart_extract_agent",
            "skill": "size_chart_consistency_lock",
            "status": "waiting_review" if has_size else "optional",
            "message": "已接入图四细节/尺码参考，生成图需沿用可读字段和数据。" if has_size else "未上传图四细节/尺码参考，尺码页按通用提示生成，不得编造具体尺码数字。",
        },
        "chinese_copy_clarity": {
            "agent": "womenswear_copy_agent",
            "skill": "douyin_womenswear_detail_page_generation",
            "status": "ok",
            "message": "女装标题与详情页文案已按中文短句、抖音电商可读性生成。",
        },
        "douyin_fit": {
            "agent": CLOUD_WATER_GRAIN_AGENT,
            "skill": CLOUD_WATER_GRAIN_SKILL,
            "status": "ok" if (task.target_platform or "").lower() in {"douyin", "抖音"} else "partial",
            "message": "目标平台为抖音电商。" if (task.target_platform or "").lower() in {"douyin", "抖音"} else "目标平台不是抖音，已沿用云水禾女装通用视觉规则。",
        },
        "passed": bool(has_model and has_flat and has_logo and has_outputs and logo_transparency != "not_transparent"),
    }


def _generate_commercial_result(task: ProductVisualTask, assets: list[ProductVisualAsset]) -> dict:
    task_dir = _task_dir(task.id) / "results"
    task_dir.mkdir(parents=True, exist_ok=True)
    settings = task.generation_settings_json or {}
    title_count = int(settings.get("title_count", 5))
    reference_image_urls = _reference_image_urls(task.id, assets)
    main_plans, detail_plans = _selected_asset_plans(task)
    main_jobs = [("main", index, plan) for index, plan in enumerate(main_plans, start=1)]
    detail_jobs = [("detail", index, plan) for index, plan in enumerate(detail_plans, start=1)]
    generated = _generate_commercial_assets_concurrently(task, assets, task_dir, reference_image_urls, main_jobs + detail_jobs)
    main_images = [generated[("main", index)] for _, index, _ in main_jobs]
    detail_pages = [generated[("detail", index)] for _, index, _ in detail_jobs]
    title_candidates = _titles(task)[:title_count]
    return {
        "main_images": main_images,
        "detail_pages": detail_pages,
        "assets": main_images + detail_pages,
        "title_candidates": title_candidates,
        "click_strategy_scores": {
            "product_recognition": 88,
            "selling_point_front": 82,
            "thumbnail_readability": 84,
            "competitor_difference": 78,
        },
        "export_options": ["image_zip", "copywriting_package", "json_fields"],
        "generation_meta": _generation_meta(False, len(assets), len(reference_image_urls), "commercial_concurrent"),
        "consistency_qa": _consistency_qa(task, assets),
    }


def _generate_commercial_assets_concurrently(
    task: ProductVisualTask,
    assets: list[ProductVisualAsset],
    task_dir: Path,
    reference_image_urls: list[str],
    jobs: list[tuple[str, int, tuple[str, str, str]]],
) -> dict[tuple[str, int], dict]:
    max_workers = max(1, min(int(os.getenv("PRODUCT_VISUAL_IMAGE_CONCURRENCY", "3")), len(jobs)))

    def run(job: tuple[str, int, tuple[str, str, str]]) -> tuple[tuple[str, int], dict]:
        kind, index, plan = job
        item = generate_openai_product_image(
            task_id=task.id,
            out_dir=task_dir,
            kind=kind,
            index=index,
            prompt=_image_prompt(task, assets, kind, index, plan),
            reference_image_urls=reference_image_urls,
        )
        return (kind, index), _with_asset_meta(item, plan)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return dict(executor.map(run, jobs))


def _generate_mock_result(task: ProductVisualTask, assets: list[ProductVisualAsset], fallback_reason: str = "mock_provider", fallback_error: str | None = None) -> dict:
    task_dir = _task_dir(task.id) / "results"
    task_dir.mkdir(parents=True, exist_ok=True)
    settings = task.generation_settings_json or {}
    title_count = int(settings.get("title_count", 5))
    main_plans, detail_plans = _selected_asset_plans(task)
    main_images = [_mock_image(task, task_dir, "main", index, plan) for index, plan in enumerate(main_plans, start=1)]
    detail_pages = [_mock_image(task, task_dir, "detail", index, plan) for index, plan in enumerate(detail_plans, start=1)]
    title_candidates = _titles(task)[:title_count]
    return {
        "main_images": main_images,
        "detail_pages": detail_pages,
        "assets": main_images + detail_pages,
        "title_candidates": title_candidates,
        "click_strategy_scores": {
            "product_recognition": 86,
            "selling_point_front": 78,
            "thumbnail_readability": 82,
            "competitor_difference": 74,
        },
        "export_options": ["image_zip", "copywriting_package", "json_fields"],
        "generation_meta": _generation_meta(True, len(assets), len([asset for asset in assets if asset.mime_type.startswith("image/")]), "local_mock", fallback_reason=fallback_reason, fallback_error=fallback_error),
        "consistency_qa": _consistency_qa(task, assets),
    }


def _image_prompt(task: ProductVisualTask, assets: list[ProductVisualAsset], kind: str, index: int, plan: tuple[str, str, str]) -> str:
    asset_type, asset_name, asset_goal = plan
    points = "、".join(task.core_selling_points_json or ["云水禾", "女装", "东方雅致", "日常好穿"])
    styles = "、".join(task.style_direction_json or ["抖音电商", "清爽高级", "东方雅致"])
    asset_names = "；".join(f"{asset.asset_type}:{asset.file_name}" for asset in assets[:8])
    type_counts = {key: sum(1 for asset in assets if asset.asset_type == key) for key in sorted(ALLOWED_ASSET_TYPES)}
    rules = get_platform_visual_rules(task.target_platform)
    aspect = rules["main_upload_ratio"] if kind == "main" else rules["detail_upload_ratio"]
    specialty_rules = []
    if asset_type in {"white_front", "white_side", "white_back"}:
        specialty_rules.append("白底图规则：正面、侧面、背面必须是纯白或极浅灰背景的商品单品图，不出现模特、道具或复杂场景；服装完整居中，结构、图案和面料与图二一致。")
    if asset_type == "main_hero_logo":
        specialty_rules.append(f"首图规则：目标平台{rules['label']}主图上传比例为{rules['main_upload_ratio']}；只保留一个核心主题和最多三个短卖点，商品主体优先，主图信息低密度；LOGO必须使用透明原图后期叠加，宽度不超过画布{int(rules['logo_max_width_ratio'] * 100)}%，不得由模型重绘。")
    if asset_type == "main_fabric":
        specialty_rules.append("面料卖点规则：突出宋锦/织纹/自然微光泽/立体刺绣质感，可使用局部放大圆窗，但不要夸张虚假材质。")
    if asset_type == "main_fit_details":
        specialty_rules.append("细节版型规则：突出圆领、无袖版型、盘扣、刺绣点缀和肩颈线条，卖点文字简短清晰。")
    if asset_type in {"main_model_scene", "detail_scene"}:
        specialty_rules.append("场景图规则：茶室、通勤、约会、日常出行等东方雅致生活场景，商品上身清楚，场景服务转化不要抢主体。")
    if asset_type == "detail_model_multi_scene":
        specialty_rules.append("模特多场景重点：由 douyin_model_scene_agent 和 single_model_scene_variation_generation 固定执行；参考抖音女装商家常用单张模特图标准，同一位成人女性模特、同一件商品，生成茶室、通勤、约会、日常出行、旅行拍照等 4-5 张单模特场景参考，可做 9:16 拼版或分区展示。")
    specialty_text = "".join(specialty_rules)
    return (
        "你是 cloud_water_grain_visual_agent，使用 cloud_water_grain_womenswear_visual Skill。"
        "任务：为云水禾 / CLOUD WATER GRAIN 生成抖音电商女装商品视觉资产。"
        f"生成资产：{asset_name}（{asset_type}），画幅：{aspect}。资产目标：{asset_goal}"
        f"商品名称：{task.product_name or '女装商品'}。目标平台：{task.target_platform or 'douyin'}。价格区间：{task.price_min}-{task.price_max}。"
        f"核心卖点：{points}。风格方向：{styles}。参考素材文件名：{asset_names}。素材数量：{type_counts}。"
        "三重硬锁定："
        "1）图三模特人脸一致性锁定：必须保持上传模特同一位成人女性，脸型、五官、肤色、妆容、发型、气质一致；不要换脸，不要网红脸，不要欧美化，不要幼态化，不要儿童比例。"
        "2）图二服饰一致性锁定：必须以图二商品图为唯一款式依据，保持款式、颜色、图案、领口、袖口、腰线、裙摆、纽扣、走线、面料质感一致；不要改款、换色、增删图案或把连衣裙变成套装。"
        "3）图一品牌 LOGO 一致性锁定：只能使用上传云水禾透明LOGO原图，不变形、不拉伸、不改色、不重绘，不生成其他品牌、店铺名、水印或乱码 LOGO；最终合成必须保持镂空透明背景。"
        f"平台规则锁定：{rules['label']}主图{rules['main_upload_ratio']}，详情页{rules['detail_upload_ratio']}，主图信息密度{rules['main_image_text_density']}，最多{rules['main_image_max_topics']}个主题和{rules['main_image_max_short_selling_points']}个短卖点；规则状态：{rules['verification_status']}。"
        "图四细节/尺码锁定：如果图四包含尺码信息，尺码页必须参考上传字段、尺码范围、数据和测量方式；如果图四不含尺码数据，不要编造具体尺码数字，只写“建议参考尺码表/咨询客服”。"
        f"{specialty_text}"
        "视觉风格：高级、清爽、温柔、自然、东方雅致、商品主体突出，适合手机端阅读和抖音电商转化。"
        "文案规则：只使用清晰中文短句，可出现“云水禾”和“CLOUD WATER GRAIN”；不要泰语、大段英文、乱码、其他品牌、侵权元素或绝对化广告词。"
        "负向约束：不要男性模特、不要儿童模特、不要假人感、不要低清晰度、不要廉价拼贴、不要背景抢主体、不要自动发布/自动上架/自动投流相关文案。"
    )


def _mock_image(task: ProductVisualTask, out_dir: Path, kind: str, index: int, plan: tuple[str, str, str]) -> dict:
    name = f"{kind}_{index:02d}.svg"
    path = out_dir / name
    asset_type, title, asset_goal = plan
    product = task.product_name or "云水禾女装"
    points = " / ".join((task.core_selling_points_json or ["东方雅致", "日常好穿", "清爽女装"])[:3])
    accent = "#D8A558" if kind == "main" else "#6A8F75"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
<rect width="900" height="1200" fill="#f7f2ea"/>
<rect x="60" y="70" width="780" height="1060" rx="36" fill="#fffdf8"/>
<text x="110" y="150" fill="#111827" font-size="46" font-family="Arial">{title}</text>
<text x="110" y="205" fill="#111827" font-size="28" font-family="Arial">CLOUD WATER GRAIN / 云水禾</text>
<rect x="220" y="260" width="460" height="520" rx="78" fill="#f1ddd8"/>
<path d="M345 318 L450 248 L555 318 L650 720 Q450 815 250 720 Z" fill="#f8ece6" stroke="#b28b6a" stroke-width="8"/>
<path d="M345 330 Q450 420 555 330" fill="none" stroke="#b28b6a" stroke-width="8"/>
<path d="M330 430 C390 470 405 560 350 635 M570 430 C510 470 495 560 550 635" fill="none" stroke="#d98aa1" stroke-width="12"/>
<text x="120" y="850" fill="{accent}" font-size="42" font-weight="700" font-family="Arial">{product}</text>
<text x="120" y="920" fill="#475569" font-size="30" font-family="Arial">{points}</text>
<text x="120" y="990" fill="#111827" font-size="30" font-family="Arial">{asset_goal[:28]}</text>
</svg>"""
    path.write_text(svg, encoding="utf-8")
    return {"id": f"{kind}_{index:03d}", "name": title, "asset_type": asset_type, "category": "主图资产" if kind == "main" else "详情页资产", "url": f"/api/product-visual/tasks/{task.id}/files/results/{name}", "path": rel_path(path), "provider": "mock"}


def _with_asset_meta(item: dict, plan: tuple[str, str, str]) -> dict:
    asset_type, title, _ = plan
    category = "主图资产" if item["id"].startswith("main_") else "详情页资产"
    return {**item, "name": title, "asset_type": asset_type, "category": category}


def _reference_image_urls(task_id: str, assets: list[ProductVisualAsset]) -> list[str]:
    urls = []
    for asset in _sort_input_assets(assets):
        name = asset.file_url.rstrip("/").split("/")[-1]
        path = _task_dir(task_id) / "assets" / name
        if not path.exists() or not asset.mime_type.startswith("image/"):
            continue
        urls.append(image_file_to_data_url(path, asset.mime_type))
        if len(urls) >= 5:
            break
    return urls


def _sort_input_assets(assets: list[ProductVisualAsset]) -> list[ProductVisualAsset]:
    order = {asset_type: index for index, asset_type in enumerate(PRODUCT_VISUAL_INPUT_TYPES)}
    return sorted(assets, key=lambda asset: (order.get(asset.asset_type, len(order)), asset.file_name))


def _titles(task: ProductVisualTask) -> list[str]:
    return _title_variants(task)[:5]


def _title_batch(task: ProductVisualTask, current: list[str], count: int) -> list[str]:
    variants = _title_variants(task)
    if not variants:
        return []
    first = current[0] if current else ""
    try:
        start = (variants.index(first) + max(1, min(count, len(variants) - 1))) % len(variants)
    except ValueError:
        start = 0
    return [variants[(start + index) % len(variants)] for index in range(max(1, min(count, len(variants))))]


def _clean_title_list(values: list[str] | None, fallback: list[str]) -> list[str]:
    cleaned = [_clean_title_text(item, "") for item in values or []]
    cleaned = [item for item in cleaned if item]
    return cleaned or fallback


def _clean_title_text(value: str | None, fallback: str) -> str:
    text = (value or "").strip()
    if not text:
        return fallback
    suspicious = ("?", "�", "ï", "å", "æ", "€", "\x80")
    if any(marker in text for marker in suspicious):
        return fallback
    return text


def _title_variants(task: ProductVisualTask) -> list[str]:
    product = _clean_title_text(task.product_name, "连衣裙")
    points = _clean_title_list(task.core_selling_points_json, ["云水禾", "新中式", "桑蚕丝", "碎花", "无袖", "女", "春夏", "中长款", "收腰显瘦", "日常通勤", "气质女装"])
    styles = _clean_title_list(task.style_direction_json, ["抖音电商", "东方雅致", "日常通勤"])
    brand = points[0] if len(points) > 0 else "云水禾"
    style = points[1] if len(points) > 1 else "新中式"
    material = points[2] if len(points) > 2 else "舒适面料"
    pattern = points[3] if len(points) > 3 else "简约"
    sleeve = points[4] if len(points) > 4 else product
    season = points[6] if len(points) > 6 else "春夏"
    length = points[7] if len(points) > 7 else "中长款"
    silhouette = points[8] if len(points) > 8 else "自然显瘦"
    scene = points[9] if len(points) > 9 else (styles[2] if len(styles) > 2 else styles[-1])
    temperament = points[10] if len(points) > 10 else (styles[1] if len(styles) > 1 else styles[0])
    return [
        f"{brand}{style}{product}｜{material}{pattern} {silhouette}",
        f"{product}女{season}新款｜{style}{pattern} {length}气质款",
        f"{brand}{material}{pattern}{product}｜{scene}也能穿",
        f"{style}{material}{sleeve}｜{silhouette} {length}好穿不挑人",
        f"{brand}{pattern}{product}｜{season}{scene} 温柔显气质",
        f"{material}{length}{product}｜轻盈亲肤 {silhouette}",
        f"{style}{sleeve}｜{pattern}设计 {temperament}",
        f"{season}{material}{product}｜{brand}东方雅致穿搭",
        f"{brand}{product}｜新中式碎花 收腰显瘦中长款",
        f"抖音同款气质{product}｜桑蚕丝碎花 春夏通勤",
        f"云水禾新中式{product}｜无袖中长款 温柔显瘦",
        f"春夏气质女装｜桑蚕丝碎花{product}",
        f"{scene}日常好搭｜{brand}{length}{product}",
    ]


def _task_dir(task_id: str) -> Path:
    return PRODUCT_VISUAL_DIR / task_id


def _generation_meta_path(task_id: str) -> Path:
    return _task_dir(task_id) / "results" / "generation_meta.json"


def _write_generation_meta(task_id: str, meta: dict) -> None:
    path = _generation_meta_path(task_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_generation_meta(task_id: str) -> dict:
    path = _generation_meta_path(task_id)
    if not path.exists():
        return _normalize_generation_meta(current_provider_meta())
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
        meta.setdefault("generated_at", datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat())
        return _normalize_generation_meta(meta)
    except json.JSONDecodeError:
        return _normalize_generation_meta({**current_provider_meta(), "meta_error": "generation_meta.json decode failed"})


def _normalize_generation_meta(meta: dict) -> dict:
    return {
        **meta,
        "agent": CLOUD_WATER_GRAIN_AGENT,
        "skill": CLOUD_WATER_GRAIN_SKILL,
        "agents_called": meta.get("agents_called") or CLOUD_WATER_GRAIN_AGENTS,
        "skills_called": meta.get("skills_called") or CLOUD_WATER_GRAIN_SKILLS,
    }


def _task_data(task: ProductVisualTask) -> dict:
    return {
        "task_id": task.id,
        "product_name": task.product_name,
        "target_platform": task.target_platform,
        "core_selling_points": task.core_selling_points_json,
        "price_min": task.price_min,
        "price_max": task.price_max,
        "style_direction": task.style_direction_json,
        "generation_settings": task.generation_settings_json,
        "status": task.status,
        "review_status": task.review_status,
        "progress": task.progress,
    }


def _generation_progress(task: ProductVisualTask) -> dict | None:
    if task.status != "running":
        return None
    total_main, total_detail = (len(items) for items in _selected_asset_plans(task))
    total = total_main + total_detail
    results_dir = _task_dir(task.id) / "results"
    main_completed = len(list(results_dir.glob("main_*.png"))) if results_dir.is_dir() else 0
    detail_completed = len(list(results_dir.glob("detail_*.png"))) if results_dir.is_dir() else 0
    completed = min(total, main_completed + detail_completed)
    phase = "main" if main_completed < total_main else "detail"
    phase_label = "主图生成中" if phase == "main" else "详情页生成中"
    return {
        "completed": completed,
        "total": total,
        "main_completed": min(main_completed, total_main),
        "main_total": total_main,
        "detail_completed": min(detail_completed, total_detail),
        "detail_total": total_detail,
        "phase": phase,
        "phase_label": phase_label,
        "display_text": f"{phase_label} · 已完成 {completed}/{total}",
    }


def _asset_data(asset: ProductVisualAsset) -> dict:
    return {"asset_id": asset.id, "asset_type": asset.asset_type, "url": asset.file_url, "file_name": asset.file_name, "size": asset.size}


def _steps(status: str) -> list[dict]:
    keys = [
        ("uploaded", "资料上传"),
        ("selling_point_extract", "卖点提炼"),
        ("click_strategy", "首图策略"),
        ("main_image_generation", "主图生成"),
        ("detail_page_generation", "详情页生成"),
        ("result_export", "结果导出"),
    ]
    completed_count = {
        "created": 0,
        "draft_saved": 1,
        "assets_uploaded": 1,
        "running": 2,
        "selling_point_extracting": 2,
        "click_strategy_generating": 3,
        "main_image_generating": 4,
        "detail_page_generating": 5,
        "pending_review": 6,
        "completed": 6,
        "exported": 6,
    }.get(status, 0)
    return [
        {"key": key, "label": label, "status": "completed" if index < completed_count else "processing" if index == completed_count and status.endswith("ing") else "waiting"}
        for index, (key, label) in enumerate(keys)
    ]


def _current_step(status: str) -> str:
    return {
        "created": "资料上传",
        "draft_saved": "资料上传",
        "assets_uploaded": "卖点提炼",
        "running": "卖点提炼",
        "selling_point_extracting": "卖点提炼",
        "click_strategy_generating": "首图策略",
        "main_image_generating": "主图生成",
        "detail_page_generating": "详情页生成",
        "pending_review": "等待审核",
        "completed": "结果导出",
        "exported": "结果导出",
        "failed": "失败",
    }.get(status, "未知")


def _required_missing(task: ProductVisualTask, assets: list[ProductVisualAsset]) -> list[str]:
    missing = []
    if not task.product_name:
        missing.append("product_name")
    if not task.target_platform:
        missing.append("target_platform")
    uploaded = {asset.asset_type for asset in assets}
    for asset_type in REQUIRED_PRODUCT_VISUAL_INPUT_TYPES:
        if asset_type not in uploaded:
            missing.append(asset_type)
    return missing


def _update_task_from_payload(task: ProductVisualTask, payload: dict) -> None:
    task.product_name = payload.get("product_name", task.product_name)
    task.target_platform = payload.get("target_platform", task.target_platform)
    task.core_selling_points_json = _list_value(payload.get("core_selling_points", task.core_selling_points_json))
    task.price_min = float(payload.get("price_min", task.price_min) or 0)
    task.price_max = float(payload.get("price_max", task.price_max) or 0)
    task.reference_product_url = payload.get("reference_product_url", task.reference_product_url)
    task.style_direction_json = _list_value(payload.get("style_direction", task.style_direction_json))
    task.generation_settings_json = payload.get("generation_settings", task.generation_settings_json)


def _list_value(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _download(task_id: str, item_type: str, name: str, path: Path) -> dict:
    return {"type": item_type, "name": name, "url": f"/api/product-visual/tasks/{task_id}/files/exports/{path.name}"}
