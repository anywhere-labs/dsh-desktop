from backend.app.services import api_settings_service


def test_save_settings_merges_partial_payload_without_resetting_existing_values(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "OPENAI_API_KEY=local-secret\n"
        "OPENAI_API_BASE=https://existing.example/v1\n"
        "OPENAI_IMAGE_MODEL=existing-image\n"
        "OPENAI_TEXT_MODEL=existing-text\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(api_settings_service, "ENV_PATH", env_path)

    saved = api_settings_service.save_settings({"provider": "openai", "api_base": "https://new.example/v1"})

    assert saved["provider"] == "openai"
    assert saved["api_base"] == "https://new.example/v1"
    assert saved["model"] == "existing-image"
    assert saved["text_model"] == "existing-text"
    assert saved["has_api_key"] is True
    assert "local-secret" in env_path.read_text(encoding="utf-8")

