from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from backend.app.core.response import api_response
from backend.app.services import api_settings_service

router = APIRouter()


class ModelRouteRequest(BaseModel):
    intent: str = ""
    module: str = ""
    task_type: str = ""


class ModelProbeRequest(BaseModel):
    model: str = ""


@router.get("/api/config/image-provider")
def get_image_provider_config():
    return api_response("ok", "success", api_settings_service.read_settings())


@router.get("/api/config/model-provider")
def get_model_provider_config():
    return api_response("ok", "success", api_settings_service.read_settings())


@router.post("/api/config/image-provider")
def save_image_provider_config(payload: dict):
    data = api_settings_service.save_settings(payload)
    return api_response("ok", "saved", data)


@router.post("/api/config/model-provider")
def save_model_provider_config(payload: dict):
    return api_response("ok", "saved", api_settings_service.save_settings(payload))


@router.get("/api/config/model-provider/routes")
def get_model_provider_routes():
    data = api_settings_service.read_settings()
    return api_response("ok", "success", {"items": data["routes"], "consumers": data["consumers"]})


@router.post("/api/config/model-provider/resolve")
def resolve_model_provider_route(payload: ModelRouteRequest):
    payload_data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    route = api_settings_service.resolve_model_route(payload_data)
    return api_response("ok" if route["ready"] else "blocked", "resolved", route, "", [] if route["ready"] else ["api_key_or_model"])


@router.post("/api/config/image-provider/validate")
def validate_image_provider_config():
    result = api_settings_service.validate_settings()
    return api_response(result["status"], "validated", result["data"], "", result["missing_inputs"])


@router.post("/api/config/model-provider/validate")
def validate_model_provider_config():
    result = api_settings_service.validate_settings()
    return api_response(result["status"], "validated", result["data"], "", result["missing_inputs"])


@router.post("/api/config/model-provider/probe")
def probe_model_provider(payload: ModelProbeRequest):
    result = api_settings_service.probe_text_model(payload.model)
    return api_response(result["status"], "模型连接验证完成", result["data"], "", result["missing_inputs"])
