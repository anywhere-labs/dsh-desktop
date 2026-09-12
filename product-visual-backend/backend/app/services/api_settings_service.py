from __future__ import annotations

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from pathlib import Path
from typing import Any

from backend.app.core.paths import PROJECT_ROOT

ENV_PATH = PROJECT_ROOT / ".env"

DEFAULT_SETTINGS = {
    "PRODUCT_VISUAL_IMAGE_PROVIDER": "apimart",
    "OPENAI_API_BASE": "https://api.apimart.ai/v1",
    "OPENAI_IMAGE_MODEL": "gpt-image-2",
    "OPENAI_TEXT_MODEL": "gpt-4.1-mini",
    "OPENAI_VISION_MODEL": "gpt-4.1-mini",
    "OPENAI_IMAGE_SIZE": "1:1",
    "OPENAI_IMAGE_RESOLUTION": "2k",
    "OPENAI_IMAGE_QUALITY": "medium",
    "OPENAI_IMAGE_OUTPUT_FORMAT": "png",
    "STEPFUN_IMAGE_CFG_SCALE": "1.0",
    "STEPFUN_IMAGE_STEPS": "8",
    "STEPFUN_IMAGE_SEED": "1",
    "STEPFUN_IMAGE_TEXT_MODE": "true",
}

MODULE_CONSUMERS = [
    "product_visual",
    "brand_strategy",
    "data_capture",
    "live_clips",
    "analysis_report",
]

INTENT_ROUTES = {
    "product_visual": {
        "label": "商品图与详情页",
        "capability": "image_generation",
        "model_env": "OPENAI_IMAGE_MODEL",
        "endpoint": "/images/generations",
        "skill": "cloud_water_grain_womenswear_visual",
    },
    "brand_strategy": {
        "label": "品牌策略",
        "capability": "text_reasoning",
        "model_env": "OPENAI_TEXT_MODEL",
        "endpoint": "/chat/completions",
        "skill": "brand_strategy_agent",
    },
    "data_capture": {
        "label": "数据抓取分析",
        "capability": "text_extraction",
        "model_env": "OPENAI_TEXT_MODEL",
        "endpoint": "/chat/completions",
        "skill": "commerce_data_capture_agent",
    },
    "live_clips": {
        "label": "直播切片分发",
        "capability": "caption_and_clip_reasoning",
        "model_env": "OPENAI_TEXT_MODEL",
        "endpoint": "/chat/completions",
        "skill": "video_content_repurposing_workflow",
    },
    "analysis_report": {
        "label": "数据分析报告",
        "capability": "report_reasoning",
        "model_env": "OPENAI_TEXT_MODEL",
        "endpoint": "/chat/completions",
        "skill": "analysis_report_agent",
    },
    "vision_analysis": {
        "label": "图片/视频视觉分析",
        "capability": "vision_reasoning",
        "model_env": "OPENAI_VISION_MODEL",
        "endpoint": "/chat/completions",
        "skill": "visual_analysis_agent",
    },
}

INTENT_ALIASES = {
    "material": "product_visual",
    "product": "product_visual",
    "image": "product_visual",
    "images": "product_visual",
    "商品图": "product_visual",
    "详情页": "product_visual",
    "brand": "brand_strategy",
    "strategy": "brand_strategy",
    "品牌": "brand_strategy",
    "crawl": "data_capture",
    "capture": "data_capture",
    "data": "data_capture",
    "数据": "data_capture",
    "liveclip": "live_clips",
    "live_clips": "live_clips",
    "clip": "live_clips",
    "直播切片": "live_clips",
    "report": "analysis_report",
    "analysis": "analysis_report",
    "报告": "analysis_report",
    "vision": "vision_analysis",
    "视觉": "vision_analysis",
}


def load_env_file() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def read_settings() -> dict[str, Any]:
    load_env_file()
    api_key = os.getenv("OPENAI_API_KEY", "")
    settings = {
        "provider": os.getenv("PRODUCT_VISUAL_IMAGE_PROVIDER", DEFAULT_SETTINGS["PRODUCT_VISUAL_IMAGE_PROVIDER"]),
        "api_base": os.getenv("OPENAI_API_BASE", DEFAULT_SETTINGS["OPENAI_API_BASE"]),
        "model": os.getenv("OPENAI_IMAGE_MODEL", DEFAULT_SETTINGS["OPENAI_IMAGE_MODEL"]),
        "text_model": os.getenv("OPENAI_TEXT_MODEL", DEFAULT_SETTINGS["OPENAI_TEXT_MODEL"]),
        "vision_model": os.getenv("OPENAI_VISION_MODEL", DEFAULT_SETTINGS["OPENAI_VISION_MODEL"]),
        "size": os.getenv("OPENAI_IMAGE_SIZE", DEFAULT_SETTINGS["OPENAI_IMAGE_SIZE"]),
        "resolution": os.getenv("OPENAI_IMAGE_RESOLUTION", DEFAULT_SETTINGS["OPENAI_IMAGE_RESOLUTION"]),
        "quality": os.getenv("OPENAI_IMAGE_QUALITY", DEFAULT_SETTINGS["OPENAI_IMAGE_QUALITY"]),
        "output_format": os.getenv("OPENAI_IMAGE_OUTPUT_FORMAT", DEFAULT_SETTINGS["OPENAI_IMAGE_OUTPUT_FORMAT"]),
        "cfg_scale": os.getenv("STEPFUN_IMAGE_CFG_SCALE", DEFAULT_SETTINGS["STEPFUN_IMAGE_CFG_SCALE"]),
        "steps": os.getenv("STEPFUN_IMAGE_STEPS", DEFAULT_SETTINGS["STEPFUN_IMAGE_STEPS"]),
        "seed": os.getenv("STEPFUN_IMAGE_SEED", DEFAULT_SETTINGS["STEPFUN_IMAGE_SEED"]),
        "text_mode": os.getenv("STEPFUN_IMAGE_TEXT_MODE", DEFAULT_SETTINGS["STEPFUN_IMAGE_TEXT_MODE"]),
        "has_api_key": bool(api_key),
        "api_key_masked": _mask_key(api_key),
    }
    settings["consumers"] = MODULE_CONSUMERS
    settings["routes"] = build_model_routes(settings)
    return settings


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = _read_env_pairs()
    field_map = {
        "provider": "PRODUCT_VISUAL_IMAGE_PROVIDER",
        "api_base": "OPENAI_API_BASE",
        "model": "OPENAI_IMAGE_MODEL",
        "text_model": "OPENAI_TEXT_MODEL",
        "vision_model": "OPENAI_VISION_MODEL",
        "size": "OPENAI_IMAGE_SIZE",
        "resolution": "OPENAI_IMAGE_RESOLUTION",
        "quality": "OPENAI_IMAGE_QUALITY",
        "output_format": "OPENAI_IMAGE_OUTPUT_FORMAT",
        "cfg_scale": "STEPFUN_IMAGE_CFG_SCALE",
        "steps": "STEPFUN_IMAGE_STEPS",
        "seed": "STEPFUN_IMAGE_SEED",
        "text_mode": "STEPFUN_IMAGE_TEXT_MODE",
    }
    mapped = {
        env_key: payload[field]
        for field, env_key in field_map.items()
        if field in payload and payload[field] is not None and str(payload[field]).strip()
    }
    api_key = str(payload.get("api_key") or "").strip()
    if api_key:
        mapped["OPENAI_API_KEY"] = api_key
    elif "OPENAI_API_KEY" in current:
        mapped["OPENAI_API_KEY"] = current["OPENAI_API_KEY"]

    current.update({key: str(value).strip() for key, value in mapped.items() if str(value).strip()})
    _write_env_pairs(current)
    for key, value in current.items():
        os.environ[key] = value
    return read_settings()


def validate_settings() -> dict[str, Any]:
    settings = read_settings()
    missing = []
    if not settings["api_base"]:
        missing.append("api_base")
    if not settings["model"]:
        missing.append("model")
    if not settings["has_api_key"]:
        missing.append("api_key")
    return {
        "status": "ok" if not missing else "blocked",
        "missing_inputs": missing,
        "data": {
            **settings,
            "image_generation_endpoint": f"{settings['api_base'].rstrip('/')}/images/generations" if settings["api_base"] else "",
            "task_poll_endpoint": f"{settings['api_base'].rstrip('/')}/tasks/{{task_id}}" if settings["api_base"] else "",
            "routes": settings["routes"],
        },
    }


def probe_text_model(model: str = "") -> dict[str, Any]:
    """Make a minimal OpenAI-compatible request without exposing credentials."""
    settings = read_settings()
    selected_model = str(model or settings.get("text_model") or "").strip()
    api_base = _effective_api_base(str(settings.get("provider") or ""), str(settings.get("api_base") or ""))
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    missing = [name for name, value in (("api_key", api_key), ("api_base", api_base), ("text_model", selected_model)) if not value]
    if missing:
        return {"status": "blocked", "missing_inputs": missing, "data": {"model": selected_model, "provider": settings.get("provider", "")}}
    body = json.dumps({
        "model": selected_model,
        "messages": [{"role": "user", "content": "Reply with OK only."}],
        "temperature": 0,
        "max_tokens": 8,
        "stream": False,
    }).encode("utf-8")
    request = Request(
        f"{api_base.rstrip('/')}/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        has_reply = bool(((payload.get("choices") or [{}])[0].get("message") or {}).get("content"))
        return {
            "status": "ok" if has_reply else "blocked",
            "missing_inputs": [] if has_reply else ["model_reply"],
            "data": {
                "provider": settings.get("provider", ""),
                "model": selected_model,
                "endpoint": f"{api_base.rstrip('/')}/chat/completions",
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "verified": has_reply,
            },
        }
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        reason = getattr(exc, "reason", None) or str(exc)
        return {
            "status": "blocked",
            "missing_inputs": ["provider_connection"],
            "data": {"provider": settings.get("provider", ""), "model": selected_model, "verified": False, "error": str(reason)[:240]},
        }


def build_model_routes(settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = settings or read_settings()
    provider = str(data.get("provider") or DEFAULT_SETTINGS["PRODUCT_VISUAL_IMAGE_PROVIDER"]).lower()
    api_base = _effective_api_base(provider, str(data.get("api_base") or DEFAULT_SETTINGS["OPENAI_API_BASE"]))
    routes = []
    for intent, route in INTENT_ROUTES.items():
        model = data.get(_public_model_key(route["model_env"])) or os.getenv(route["model_env"], DEFAULT_SETTINGS.get(route["model_env"], ""))
        endpoint = "/images/edits" if provider == "stepfun" and intent == "product_visual" else route["endpoint"]
        capability = "image_edit" if provider == "stepfun" and intent == "product_visual" else route["capability"]
        provider_supports_route = provider != "stepfun" or intent == "product_visual"
        routes.append({
            "intent": intent,
            "label": route["label"],
            "provider": provider,
            "capability": capability,
            "model": model,
            "endpoint": f"{api_base}{endpoint}",
            "skill": route["skill"],
            "ready": bool(data.get("has_api_key") and model and api_base and provider_supports_route),
        })
    return routes


def resolve_model_route(payload: dict[str, Any]) -> dict[str, Any]:
    settings = read_settings()
    intent = _normalize_intent(payload)
    route = next((item for item in settings["routes"] if item["intent"] == intent), None)
    if not route:
        route = next(item for item in settings["routes"] if item["intent"] == "analysis_report")
    return {
        **route,
        "matched_intent": intent,
        "input": {
            "intent": payload.get("intent", ""),
            "module": payload.get("module", ""),
            "task_type": payload.get("task_type", ""),
        },
        "api_key_masked": settings["api_key_masked"],
    }


def _read_env_pairs() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    pairs: dict[str, str] = {}
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        pairs[key.strip()] = value.strip()
    return pairs


def _write_env_pairs(pairs: dict[str, str]) -> None:
    ordered_keys = [
        "APP_HOST",
        "APP_PORT",
        "DATABASE_URL",
        "PRODUCT_VISUAL_IMAGE_PROVIDER",
        "OPENAI_API_BASE",
        "OPENAI_API_KEY",
        "OPENAI_IMAGE_MODEL",
        "OPENAI_TEXT_MODEL",
        "OPENAI_VISION_MODEL",
        "OPENAI_IMAGE_SIZE",
        "OPENAI_IMAGE_RESOLUTION",
        "OPENAI_IMAGE_QUALITY",
        "OPENAI_IMAGE_OUTPUT_FORMAT",
        "STEPFUN_IMAGE_CFG_SCALE",
        "STEPFUN_IMAGE_STEPS",
        "STEPFUN_IMAGE_SEED",
        "STEPFUN_IMAGE_TEXT_MODE",
    ]
    lines = ["# Local runtime settings. Do not commit this file."]
    seen = set()
    for key in ordered_keys:
        if key in pairs:
            lines.append(f"{key}={pairs[key]}")
            seen.add(key)
    for key in sorted(k for k in pairs if k not in seen):
        lines.append(f"{key}={pairs[key]}")
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 10:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def _public_model_key(env_key: str) -> str:
    return {
        "OPENAI_IMAGE_MODEL": "model",
        "OPENAI_TEXT_MODEL": "text_model",
        "OPENAI_VISION_MODEL": "vision_model",
    }.get(env_key, "model")


def _normalize_intent(payload: dict[str, Any]) -> str:
    raw = " ".join(str(payload.get(key) or "") for key in ("intent", "module", "task_type")).strip().lower()
    if not raw:
        return "analysis_report"
    for alias, intent in INTENT_ALIASES.items():
        if alias.lower() in raw:
            return intent
    if "video" in raw or "caption" in raw or "subtitle" in raw:
        return "live_clips"
    if "image" in raw or "product" in raw:
        return "product_visual"
    return "analysis_report"


def _effective_api_base(provider: str, api_base: str) -> str:
    base = str(api_base or "").rstrip("/")
    if provider == "codox" and base == "https://codox-xaas.tidescend.com":
        return f"{base}/v1"
    return base
