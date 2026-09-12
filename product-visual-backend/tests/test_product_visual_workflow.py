from fastapi.testclient import TestClient
import logging

from backend.main import app
from backend.app.core.database import SessionLocal
from backend.app.models.product_visual import ProductVisualTask
from backend.app.services.commercial_image_service import CommercialImageError
from backend.app.services import product_visual_service


def test_platform_rules_define_upload_ratio_logo_limit_and_pending_verification():
    douyin = product_visual_service.get_platform_visual_rules("douyin")
    assert douyin["main_upload_ratio"] == "3:4"
    assert douyin["detail_upload_ratio"] == "9:16"
    assert douyin["verification_status"] == "confirmed_from_reference"
    assert douyin["logo_max_width_ratio"] == 0.10
    assert douyin["main_image_text_density"] == "low"

    other = product_visual_service.get_platform_visual_rules("xhs")
    assert other["verification_status"] == "pending_official_verification"
    assert other["ratio_notice"]


def test_logo_transparency_check_requires_alpha_source():
    png_with_alpha = bytearray(b"\x89PNG\r\n\x1a\n" + b"\x00" * 18)
    png_with_alpha[25] = 6
    assert product_visual_service.check_logo_transparency(bytes(png_with_alpha), "image/png") == "transparent"
    assert product_visual_service.check_logo_transparency(b"jpeg", "image/jpeg") == "not_transparent"
    assert product_visual_service.check_logo_transparency(b"unknown", "image/png") == "unknown"


def test_title_variants_accept_short_style_lists():
    task = ProductVisualTask(
        product_name="连衣裙",
        core_selling_points_json=["云水禾", "新中式", "桑蚕丝"],
        style_direction_json=["抖音电商", "东方雅致"],
    )
    assert product_visual_service._title_variants(task)


def test_logo_upload_blocks_explicitly_opaque_source():
    with TestClient(app) as client:
        created = client.post("/api/product-visual/tasks", json={"product_name": "透明LOGO测试", "target_platform": "douyin"}).json()
        task_id = created["data"]["task_id"]
        blocked = client.post(
            f"/api/product-visual/tasks/{task_id}/assets",
            data={"asset_type": "input_image_1"},
            files={"file": ("logo.jpg", b"opaque", "image/jpeg")},
        ).json()
        assert blocked["status"] == "blocked"
        assert blocked["missing_inputs"] == ["logo_transparency"]


def test_product_visual_upload_replaces_slot_before_generation_and_locks_after_start():
    with TestClient(app) as client:
        created = client.post("/api/product-visual/tasks", json={"product_name": "替换上传测试", "target_platform": "douyin"}).json()
        task_id = created["data"]["task_id"]
        first = client.post(f"/api/product-visual/tasks/{task_id}/assets", data={"asset_type": "input_image_2"}, files={"file": ("first.png", b"first", "image/png")}).json()
        second = client.post(f"/api/product-visual/tasks/{task_id}/assets", data={"asset_type": "input_image_2"}, files={"file": ("second.png", b"second", "image/png")}).json()
        assert first["status"] == second["status"] == "ok"
        assert second["data"]["file_name"] == "second.png"
        with SessionLocal() as db:
            task = db.get(ProductVisualTask, task_id)
            task.status = "running"
            db.commit()
        blocked = client.post(f"/api/product-visual/tasks/{task_id}/assets", data={"asset_type": "input_image_2"}, files={"file": ("third.png", b"third", "image/png")}).json()
        assert blocked["status"] == "blocked"
        assert blocked["missing_inputs"] == ["asset_role_locked"]


def test_product_visual_save_draft_does_not_regress_active_or_terminal_statuses():
    protected_statuses = ["running", "pending_review", "completed", "exported"]

    with TestClient(app) as client:
        for protected_status in protected_statuses:
            created = client.post(
                "/api/product-visual/tasks",
                json={"product_name": "状态单调性测试", "target_platform": "douyin"},
            ).json()
            task_id = created["data"]["task_id"]
            with SessionLocal() as db:
                task = db.get(ProductVisualTask, task_id)
                task.status = protected_status
                task.progress = 100 if protected_status != "running" else 35
                db.commit()

            saved = client.post(
                f"/api/product-visual/tasks/{task_id}/draft",
                json={"product_name": f"{protected_status}-已更新", "target_platform": "douyin"},
            ).json()

            assert saved["status"] == "ok"
            assert saved["data"]["status"] == protected_status
            assert saved["data"]["product_name"] == f"{protected_status}-已更新"


def test_product_visual_status_failure_returns_trace_id_and_logs_exception(monkeypatch, caplog):
    def fail_status(_db, _task_id):
        raise RuntimeError("status probe exploded")

    monkeypatch.setattr(product_visual_service, "get_status", fail_status)
    caplog.set_level(logging.ERROR)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/product-visual/tasks/pv_broken/status")

    payload = response.json()
    assert response.status_code == 500
    assert payload["status"] == "failed"
    assert payload["trace_id"]
    assert payload["message"] == "状态查询失败"
    assert payload["trace_id"] in caplog.text
    assert "pv_broken" in caplog.text


def test_product_visual_task_workflow_runs(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "mock")
    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={
                "product_name": "连衣裙",
                "target_platform": "douyin",
                "core_selling_points": ["云水禾", "新中式", "桑蚕丝", "碎花", "无袖连衣裙", "女", "春夏", "中长款", "收腰显瘦", "日常通勤", "气质女装"],
                "price_min": 129,
                "price_max": 299,
                "style_direction": ["抖音电商", "东方雅致", "日常通勤"],
                "generation_settings": {"main_image_count": 3, "detail_page_count": 5, "title_count": 5},
            },
        ).json()
        assert created["status"] == "ok"
        task_id = created["data"]["task_id"]
        assert task_id.startswith("pv_")

        for asset_type, file_name in [
            ("input_image_1", "tu_1_logo.png"),
            ("input_image_2", "tu_2_product.png"),
            ("input_image_3", "tu_3_model.png"),
            ("input_image_4", "tu_4_detail.png"),
        ]:
            upload = client.post(
                f"/api/product-visual/tasks/{task_id}/assets",
                data={"asset_type": asset_type},
                files={"file": (file_name, b"fake image bytes", "image/png")},
            ).json()
            assert upload["status"] == "ok"
            assert upload["data"]["asset_type"] == asset_type

        draft = client.post(f"/api/product-visual/tasks/{task_id}/draft", json=created["data"]).json()
        assert draft["status"] == "ok"

        run = client.post(f"/api/product-visual/tasks/{task_id}/run", json={}).json()
        assert run["status"] == "ok"
        assert run["data"]["status"] == "pending_review"
        assert len(run["data"]["main_images"]) == 9
        assert len(run["data"]["detail_pages"]) == 8
        assert len(run["data"]["assets"]) == 17
        assert len(run["data"]["asset_tasks"]) == 17
        assert run["data"]["constraint_snapshot_id"].startswith("pvcs_")
        assert {item["status"] for item in run["data"]["asset_tasks"]} == {"fallback_generated"}
        assert [item["name"] for item in run["data"]["main_images"]] == [
            "云水禾_主图_01_商品全景LOGO_3比4",
            "云水禾_主图_02_面料卖点_3比4",
            "云水禾_主图_03_产品细节版型_3比4",
            "云水禾_主图_04_场景图_3比4",
            "云水禾_主图_05_尺码表_3比4",
            "云水禾_主图_06_正侧视图_3比4",
            "云水禾_白底图_07_正面_3比4",
            "云水禾_白底图_08_侧面_3比4",
            "云水禾_白底图_09_背面_3比4",
        ]
        assert [item["name"] for item in run["data"]["detail_pages"]] == [
            "云水禾_详情页_01_品牌介绍_9比16",
            "云水禾_详情页_02_面料工艺_9比16",
            "云水禾_详情页_03_商品展示_9比16",
            "云水禾_详情页_04_场景展示_9比16",
            "云水禾_详情页_05_模特多场景图_9比16",
            "云水禾_详情页_06_尺码表_9比16",
            "云水禾_详情页_07_包装展示_9比16",
            "云水禾_详情页_08_物流售后_9比16",
        ]
        assert run["data"]["title_candidates"]
        assert run["data"]["generation_meta"]["agent"] == "cloud_water_grain_visual_agent"
        assert run["data"]["generation_meta"]["skill"] == "cloud_water_grain_womenswear_visual"
        assert run["data"]["generation_meta"]["agents_called"] == [
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
        assert "model_face_consistency_lock" in run["data"]["generation_meta"]["skills_called"]
        assert "single_model_scene_variation_generation" in run["data"]["generation_meta"]["skills_called"]
        assert run["data"]["main_images"][0]["asset_type"] == "main_hero_logo"
        assert run["data"]["main_images"][-1]["asset_type"] == "white_back"
        assert run["data"]["detail_pages"][0]["asset_type"] == "detail_brand"
        assert run["data"]["detail_pages"][4]["asset_type"] == "detail_model_multi_scene"
        assert run["data"]["detail_pages"][-1]["asset_type"] == "detail_service"
        qa = run["data"]["consistency_qa"]
        assert qa["agent"] == "visual_qc_agent"
        assert qa["skill"] == "womenswear_visual_qc"
        assert qa["garment_consistency"]["status"] == "ok"
        assert qa["passed"] is True
        original_titles = run["data"]["title_candidates"]

        refreshed_titles = client.post(f"/api/product-visual/tasks/{task_id}/titles/refresh", json={}).json()
        assert refreshed_titles["status"] == "ok"
        assert refreshed_titles["data"]["title_candidates"]
        assert refreshed_titles["data"]["title_candidates"] != original_titles
        assert refreshed_titles["data"]["title_refresh_meta"]["agent"] == "product_title_agent"
        assert refreshed_titles["data"]["title_refresh_meta"]["skill"] == "product_title_refresh_skill"

        status = client.get(f"/api/product-visual/tasks/{task_id}/status").json()
        assert status["status"] == "ok"
        assert status["data"]["progress"] == 100
        assert status["data"]["current_step"] == "等待审核"
        assert len(status["data"]["steps"]) == 6
        assert status["data"]["logs"]
        assert [asset["asset_type"] for asset in status["data"]["uploaded_assets"]] == [
            "input_image_1",
            "input_image_2",
            "input_image_3",
            "input_image_4",
        ]

        result = client.get(f"/api/product-visual/tasks/{task_id}/result").json()
        assert result["status"] == "ok"
        assert result["data"]["click_strategy_scores"]["product_recognition"] == 86
        platform_score = result["data"]["platform_score"]
        assert platform_score["platform"] == "douyin"
        assert platform_score["rule_version"] == "douyin_product_visual_v2"
        assert platform_score["source"] == "rule_based_output_contract"
        assert 0 <= platform_score["overall"] <= 100
        assert set(platform_score["dimensions"]) == {"exposure_fit", "click", "value_understanding", "conversion"}
        assert len(platform_score["asset_scores"]) == 17
        assert set(platform_score["group_scores"]) == {"main_group", "white_background_group", "detail_group", "model_scene_group"}
        assert platform_score["asset_scores"][0]["asset_name"] == "云水禾_主图_01_商品全景LOGO_3比4"
        assert platform_score["asset_scores"][0]["rule_evidence"]
        assert result["data"]["generation_meta"]["skill"] == "cloud_water_grain_womenswear_visual"
        assert result["data"]["generation_meta"]["generated_at"]
        assert result["data"]["consistency_qa"]["chinese_copy_clarity"]["status"] == "ok"
        assert [asset["asset_type"] for asset in result["data"]["uploaded_assets"]] == [
            "input_image_1",
            "input_image_2",
            "input_image_3",
            "input_image_4",
        ]

        review = client.post(f"/api/product-visual/tasks/{task_id}/review", json={"action": "submit", "comment": "提交审核"}).json()
        assert review["status"] == "ok"
        assert review["data"]["review_status"] == "pending_review"
        blocked_export = client.post(f"/api/product-visual/tasks/{task_id}/export", json={"formats": ["image_zip", "copywriting_package", "json_fields"]}).json()
        assert blocked_export["status"] == "blocked"
        assert blocked_export["missing_inputs"] == ["business_approval"]
        approved = client.post(f"/api/product-visual/tasks/{task_id}/review", json={"action": "approved", "comment": "审核通过"}).json()
        assert approved["status"] == "ok"
        exported = client.post(f"/api/product-visual/tasks/{task_id}/export", json={"formats": ["image_zip", "copywriting_package", "json_fields"]}).json()
        assert exported["status"] == "ok"
        assert len(exported["data"]["downloads"]) == 3
        retry_target = run["data"]["asset_tasks"][0]["asset_task_id"]
        retried = client.post(f"/api/product-visual/tasks/{task_id}/asset-tasks/{retry_target}/retry").json()
        assert retried["status"] == "ok"
        feedback = client.post(f"/api/product-visual/tasks/{task_id}/feedback", json={"platform": "douyin", "variant": "main_01", "impressions": 1000, "clicks": 80, "conversions": 4, "spend": 20, "revenue": 120}).json()
        assert feedback["status"] == "ok"


def test_product_visual_auto_mode_without_key_does_not_use_local_placeholder(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "auto")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(product_visual_service, "commercial_image_enabled", lambda: False)
    with TestClient(app) as client:
        created = client.post("/api/product-visual/tasks", json={"product_name": "无 Key 失败测试", "target_platform": "douyin"}).json()
        task_id = created["data"]["task_id"]
        for asset_type in ["input_image_1", "input_image_2", "input_image_3"]:
            uploaded = client.post(f"/api/product-visual/tasks/{task_id}/assets", data={"asset_type": asset_type}, files={"file": (f"{asset_type}.png", b"fake image bytes", "image/png")}).json()
            assert uploaded["status"] == "ok"
        run = client.post(f"/api/product-visual/tasks/{task_id}/run", json={}).json()
        assert run["status"] == "blocked"
        assert run["data"]["status"] == "failed"
        assert run["data"]["generation_meta"]["fallback"] is False
        assert "未生成本地占位图" in run["data"]["generation_meta"]["generation_error"]


def test_product_visual_export_blocks_incomplete_asset_set(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "mock")
    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={"product_name": "不完整资产测试", "target_platform": "douyin"},
        ).json()
        task_id = created["data"]["task_id"]
        approved = client.post(
            f"/api/product-visual/tasks/{task_id}/review",
            json={"action": "approved", "comment": "测试批准"},
        ).json()
        assert approved["status"] == "ok"

        original_get_result = product_visual_service.get_result
        monkeypatch.setattr(
            product_visual_service,
            "get_result",
            lambda db, current_task_id: {
                "status": "ok",
                "data": {
                    "task_id": current_task_id,
                    "main_images": [{}] * 8,
                    "detail_pages": [{}] * 8,
                    "title_candidates": [],
                },
            },
        )
        try:
            exported = client.post(f"/api/product-visual/tasks/{task_id}/export", json={}).json()
        finally:
            monkeypatch.setattr(product_visual_service, "get_result", original_get_result)
        assert exported["status"] == "blocked"
        assert exported["missing_inputs"] == ["complete_asset_qa"]
        assert exported["data"]["main_images_count"] == 8
        assert exported["data"]["detail_pages_count"] == 8


def test_product_visual_upload_validates_format_size_and_role_replacement():
    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={"product_name": "上传校验测试", "target_platform": "douyin"},
        ).json()
        task_id = created["data"]["task_id"]
        invalid = client.post(
            f"/api/product-visual/tasks/{task_id}/assets",
            data={"asset_type": "input_image_1"},
            files={"file": ("logo.txt", b"not an image", "text/plain")},
        ).json()
        assert invalid["status"] == "blocked"
        assert invalid["missing_inputs"] == ["image_format"]
        uploaded = client.post(
            f"/api/product-visual/tasks/{task_id}/assets",
            data={"asset_type": "input_image_1"},
            files={"file": ("logo.png", b"fake image bytes", "image/png")},
        ).json()
        assert uploaded["status"] == "ok"
        replacement = client.post(
            f"/api/product-visual/tasks/{task_id}/assets",
            data={"asset_type": "input_image_1"},
            files={"file": ("logo-2.png", b"fake image bytes", "image/png")},
        ).json()
        assert replacement["status"] == "ok"
        assert replacement["data"]["file_name"] == "logo-2.png"


def test_product_visual_run_allows_optional_detail_size_reference(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "mock")
    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={
                "product_name": "连衣裙",
                "target_platform": "douyin",
                "core_selling_points": ["云水禾", "新中式", "桑蚕丝", "碎花", "无袖连衣裙", "女", "春夏", "中长款", "收腰显瘦", "日常通勤", "气质女装"],
                "style_direction": ["抖音电商", "东方雅致", "日常通勤"],
                "generation_settings": {"main_image_count": 9, "detail_page_count": 8, "title_count": 6},
            },
        ).json()
        assert created["status"] == "ok"
        task_id = created["data"]["task_id"]

        for asset_type, file_name in [
            ("input_image_1", "tu_1_logo.png"),
            ("input_image_2", "tu_2_product.png"),
            ("input_image_3", "tu_3_model.png"),
        ]:
            upload = client.post(
                f"/api/product-visual/tasks/{task_id}/assets",
                data={"asset_type": asset_type},
                files={"file": (file_name, b"fake image bytes", "image/png")},
            ).json()
            assert upload["status"] == "ok"

        run = client.post(f"/api/product-visual/tasks/{task_id}/run", json={}).json()
        assert run["status"] == "ok"
        assert run["missing_inputs"] == []
        assert run["data"]["status"] == "pending_review"

        result = client.get(f"/api/product-visual/tasks/{task_id}/result").json()
        assert result["status"] == "ok"
        assert [asset["asset_type"] for asset in result["data"]["uploaded_assets"]] == [
            "input_image_1",
            "input_image_2",
            "input_image_3",
        ]
        assert result["data"]["consistency_qa"]["size_chart_accuracy"]["status"] == "optional"
        assert result["data"]["consistency_qa"]["passed"] is True


def test_product_visual_run_falls_back_when_commercial_provider_fails(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "apimart")
    monkeypatch.setenv("OPENAI_API_KEY", "test-provider-key")

    def fail_generation(**_kwargs):
        raise CommercialImageError("APIMart image API failed: 401 invalid API key")

    monkeypatch.setattr("backend.app.services.product_visual_service.generate_openai_product_image", fail_generation)

    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={
                "product_name": "连衣裙",
                "target_platform": "douyin",
                "core_selling_points": ["云水禾", "新中式", "桑蚕丝", "碎花", "无袖连衣裙", "女", "春夏", "中长款", "收腰显瘦", "日常通勤", "气质女装"],
                "style_direction": ["抖音电商", "东方雅致", "日常通勤"],
                "generation_settings": {"main_image_count": 9, "detail_page_count": 8, "title_count": 6},
            },
        ).json()
        task_id = created["data"]["task_id"]

        for asset_type, file_name in [
            ("input_image_1", "tu_1_logo.png"),
            ("input_image_2", "tu_2_product.png"),
            ("input_image_3", "tu_3_model.png"),
        ]:
            upload = client.post(
                f"/api/product-visual/tasks/{task_id}/assets",
                data={"asset_type": asset_type},
                files={"file": (file_name, b"fake image bytes", "image/png")},
            ).json()
            assert upload["status"] == "ok"

        run = client.post(f"/api/product-visual/tasks/{task_id}/run", json={}).json()
        assert run["status"] == "blocked"
        assert run["missing_inputs"] == ["commercial_image_provider"]
        assert run["data"]["status"] == "failed"
        assert run["data"]["generation_meta"]["fallback"] is False
        assert run["data"]["generation_meta"]["generation_mode"] == "commercial_failed"
        assert "invalid API key" in run["data"]["generation_meta"]["generation_error"]
        assert client.get(f"/api/product-visual/tasks/{task_id}/result").json()["missing_inputs"] == ["result"]


def test_product_visual_status_reports_incremental_generation_progress(monkeypatch):
    monkeypatch.setenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "apimart")
    with TestClient(app) as client:
        created = client.post(
            "/api/product-visual/tasks",
            json={
                "product_name": "连衣裙",
                "target_platform": "douyin",
                "core_selling_points": ["云水禾", "新中式", "桑蚕丝"],
                "style_direction": ["抖音电商", "东方雅致"],
                "generation_settings": {"main_image_count": 9, "detail_page_count": 8, "title_count": 6},
            },
        ).json()
        task_id = created["data"]["task_id"]

        task_dir = product_visual_service._task_dir(task_id) / "results"
        task_dir.mkdir(parents=True, exist_ok=True)
        for index in range(1, 10):
            (task_dir / f"main_{index:02d}.png").write_bytes(b"image")
        for index in range(1, 4):
            (task_dir / f"detail_{index:02d}.png").write_bytes(b"image")

        with SessionLocal() as db:
            task = db.get(ProductVisualTask, task_id)
            task.status = "running"
            task.progress = 35
            db.commit()

        status = client.get(f"/api/product-visual/tasks/{task_id}/status").json()

        assert status["status"] == "ok"
        assert status["data"]["progress"] > 35
        assert status["data"]["current_step"] == "详情页生成中"
        assert status["data"]["generation_progress"] == {
            "completed": 12,
            "total": 17,
            "main_completed": 9,
            "main_total": 9,
            "detail_completed": 3,
            "detail_total": 8,
            "phase": "detail",
            "phase_label": "详情页生成中",
            "display_text": "详情页生成中 · 已完成 12/17",
        }
