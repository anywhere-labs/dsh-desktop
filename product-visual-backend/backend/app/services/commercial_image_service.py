from __future__ import annotations

import base64
import io
import mimetypes
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

from backend.app.core.paths import rel_path

OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations"


class CommercialImageError(RuntimeError):
    pass


def commercial_image_enabled() -> bool:
    provider = os.getenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "auto").strip().lower()
    if provider == "mock":
        return False
    return bool(os.getenv("OPENAI_API_KEY"))


def current_provider_meta() -> dict[str, Any]:
    provider = os.getenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "auto").strip().lower()
    return {
        "requested_provider": provider,
        "active_provider": _active_provider() if commercial_image_enabled() else "mock",
        "api_base": os.getenv("OPENAI_API_BASE", "https://api.apimart.ai/v1"),
        "model": os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2"),
        "size": os.getenv("OPENAI_IMAGE_SIZE", "1:1"),
        "resolution": os.getenv("OPENAI_IMAGE_RESOLUTION", "2k"),
        "quality": os.getenv("OPENAI_IMAGE_QUALITY", "medium"),
        "has_openai_key": bool(os.getenv("OPENAI_API_KEY")),
    }


def generate_openai_product_image(
    *,
    task_id: str,
    out_dir: Path,
    kind: str,
    index: int,
    prompt: str,
    reference_image_urls: list[str] | None = None,
) -> dict[str, Any]:
    active_provider = _active_provider()
    if active_provider == "stepfun":
        return _generate_stepfun_product_image(
            task_id=task_id,
            out_dir=out_dir,
            kind=kind,
            index=index,
            prompt=prompt,
            reference_image_urls=reference_image_urls or [],
        )
    if active_provider == "apimart":
        return _generate_apimart_product_image(
            task_id=task_id,
            out_dir=out_dir,
            kind=kind,
            index=index,
            prompt=prompt,
            reference_image_urls=reference_image_urls or [],
        )

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise CommercialImageError("OPENAI_API_KEY is not configured")

    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    size = os.getenv("OPENAI_IMAGE_SIZE", "1024x1024")
    quality = os.getenv("OPENAI_IMAGE_QUALITY", "medium")
    output_format = os.getenv("OPENAI_IMAGE_OUTPUT_FORMAT", "png")

    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "output_format": output_format,
        "n": 1,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    response = _request_with_retry("post", _openai_compatible_image_endpoint(), json=payload, headers=headers, timeout=180)
    if response.status_code >= 400:
        raise CommercialImageError(f"OpenAI image API failed: {response.status_code} {response.text[:500]}")

    data = response.json()
    image_items = data.get("data") or []
    if not image_items or not image_items[0].get("b64_json"):
        raise CommercialImageError("OpenAI image API response did not include b64_json")

    suffix = "jpg" if output_format == "jpeg" else output_format
    name = f"{kind}_{index:02d}.{suffix}"
    path = out_dir / name
    path.write_bytes(base64.b64decode(image_items[0]["b64_json"]))

    return {
        "id": f"{kind}_{index:03d}",
        "name": ("主图" if kind == "main" else "详情页") + f"{index:02d}",
        "url": f"/api/product-visual/tasks/{task_id}/files/results/{name}",
        "path": rel_path(path),
        "provider": active_provider,
        "model": model,
        "format": output_format,
        "usage": data.get("usage") or {},
    }


def _generate_stepfun_product_image(
    *,
    task_id: str,
    out_dir: Path,
    kind: str,
    index: int,
    prompt: str,
    reference_image_urls: list[str],
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise CommercialImageError("OPENAI_API_KEY is not configured")
    if not reference_image_urls:
        raise CommercialImageError("StepFun image edit requires a reference image")

    source_name, source_bytes, mime_type = _decode_reference_data_url(reference_image_urls[0])
    api_base = os.getenv("OPENAI_API_BASE", "https://api.stepfun.ai/v1").rstrip("/")
    model = os.getenv("OPENAI_IMAGE_MODEL", "step-image-edit-2")
    output_format = os.getenv("OPENAI_IMAGE_OUTPUT_FORMAT", "png").lower()
    if output_format not in {"png", "jpg", "jpeg", "webp"}:
        output_format = "png"
    response = _request_with_retry(
        "post",
        f"{api_base}/images/edits",
        headers={"Authorization": f"Bearer {api_key}"},
        data={
            "model": model,
            "prompt": prompt,
            "response_format": "b64_json",
            "cfg_scale": os.getenv("STEPFUN_IMAGE_CFG_SCALE", "1.0"),
            "steps": os.getenv("STEPFUN_IMAGE_STEPS", "8"),
            "seed": os.getenv("STEPFUN_IMAGE_SEED", "1"),
            "text_mode": os.getenv("STEPFUN_IMAGE_TEXT_MODE", "true"),
        },
        files={"image": (source_name, io.BytesIO(source_bytes), mime_type)},
        timeout=180,
    )
    if response.status_code >= 400:
        raise CommercialImageError(f"StepFun image edit API failed: {response.status_code} {response.text[:500]}")

    payload = response.json()
    image_items = payload.get("data") or []
    encoded = image_items[0].get("b64_json") if image_items and isinstance(image_items[0], dict) else ""
    if not encoded:
        raise CommercialImageError("StepFun image edit response did not include b64_json")

    suffix = "jpg" if output_format == "jpeg" else output_format
    name = f"{kind}_{index:02d}.{suffix}"
    path = out_dir / name
    path.write_bytes(base64.b64decode(encoded))
    if not path.exists() or path.stat().st_size <= 0:
        raise CommercialImageError("StepFun image edit produced an empty output file")
    return {
        "id": f"{kind}_{index:03d}",
        "name": ("主图" if kind == "main" else "详情页") + f"{index:02d}",
        "url": f"/api/product-visual/tasks/{task_id}/files/results/{name}",
        "path": rel_path(path),
        "provider": "stepfun",
        "model": model,
        "format": suffix,
        "usage": payload.get("usage") or {},
    }


def _decode_reference_data_url(value: str) -> tuple[str, bytes, str]:
    if not value.startswith("data:") or ";base64," not in value:
        raise CommercialImageError("StepFun reference image must be a base64 data URL")
    header, encoded = value.split(",", 1)
    mime_type = header[5:].split(";", 1)[0] or "image/png"
    extension = {
        "image/webp": ".webp",
        "image/png": ".png",
        "image/jpeg": ".jpg",
    }.get(mime_type, mimetypes.guess_extension(mime_type) or ".png")
    if extension == ".jpe":
        extension = ".jpg"
    try:
        content = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise CommercialImageError("StepFun reference image contains invalid base64 data") from exc
    if not content:
        raise CommercialImageError("StepFun reference image is empty")
    return f"input{extension}", content, mime_type


def _generate_apimart_product_image(
    *,
    task_id: str,
    out_dir: Path,
    kind: str,
    index: int,
    prompt: str,
    reference_image_urls: list[str],
) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise CommercialImageError("OPENAI_API_KEY is not configured")

    api_base = os.getenv("OPENAI_API_BASE", "https://api.apimart.ai/v1").rstrip("/")
    model = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    size = os.getenv("OPENAI_IMAGE_SIZE", "1:1")
    resolution = os.getenv("OPENAI_IMAGE_RESOLUTION", "2k")
    output_format = os.getenv("OPENAI_IMAGE_OUTPUT_FORMAT", "png")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
    }
    if reference_image_urls:
        payload["image_urls"] = reference_image_urls
    response = _request_with_retry("post", f"{api_base}/images/generations", json=payload, headers=headers, timeout=120)
    if response.status_code >= 400 and reference_image_urls:
        retry_payload = {key: value for key, value in payload.items() if key != "image_urls"}
        response = _request_with_retry("post", f"{api_base}/images/generations", json=retry_payload, headers=headers, timeout=120)
    if response.status_code >= 400:
        raise CommercialImageError(f"APIMart image API failed: {response.status_code} {response.text[:500]}")
    created = response.json()
    task_ref = _extract_apimart_task_ref(created)
    if task_ref:
        task_payload = _poll_apimart_task(api_base, task_ref, headers)
        image_url = _extract_apimart_image_url(task_payload)
    else:
        image_url = _extract_apimart_image_url(created)
    image_response = _request_with_retry("get", image_url, timeout=120)
    if image_response.status_code >= 400:
        raise CommercialImageError(f"APIMart image download failed: {image_response.status_code}")

    suffix = _suffix_from_url(image_url, output_format)
    name = f"{kind}_{index:02d}.{suffix}"
    path = out_dir / name
    path.write_bytes(image_response.content)
    return {
        "id": f"{kind}_{index:03d}",
        "name": ("主图" if kind == "main" else "详情页") + f"{index:02d}",
        "url": f"/api/product-visual/tasks/{task_id}/files/results/{name}",
        "path": rel_path(path),
        "provider": "apimart",
        "model": model,
        "format": suffix,
        "remote_task_id": task_ref or "",
    }


def _poll_apimart_task(api_base: str, task_ref: str, headers: dict[str, str]) -> dict[str, Any]:
    for _ in range(int(os.getenv("OPENAI_IMAGE_TASK_POLL_ATTEMPTS", "180"))):
        response = _request_with_retry("get", f"{api_base}/tasks/{task_ref}", headers=headers, timeout=30)
        if response.status_code >= 400:
            raise CommercialImageError(f"APIMart task polling failed: {response.status_code} {response.text[:500]}")
        payload = response.json()
        status = _extract_apimart_status(payload)
        if status in {"succeeded", "success", "completed", "done"}:
            return payload
        if status in {"failed", "error", "cancelled", "canceled"}:
            raise CommercialImageError(f"APIMart image task failed: {str(payload)[:500]}")
        time.sleep(float(os.getenv("OPENAI_IMAGE_TASK_POLL_SECONDS", "2")))
    raise CommercialImageError(f"APIMart image task timed out: {task_ref}")


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    attempts = int(os.getenv("OPENAI_IMAGE_HTTP_RETRY_ATTEMPTS", "5"))
    delay = float(os.getenv("OPENAI_IMAGE_HTTP_RETRY_SECONDS", "1.5"))
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return requests.request(method, url, **kwargs)
        except (requests.exceptions.SSLError, requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last_error = exc
            if attempt >= attempts:
                break
            time.sleep(delay * attempt)
    raise CommercialImageError(f"HTTP request failed after {attempts} attempts: {type(last_error).__name__} {str(last_error)[:300]}")


def image_file_to_data_url(path: Path, mime_type: str = "") -> str:
    mime = mime_type or mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _candidate_dicts(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        rows: list[dict[str, Any]] = []
        for item in payload:
            rows.extend(_candidate_dicts(item))
        return rows
    if not isinstance(payload, dict):
        return []
    rows = [payload]
    data = payload.get("data")
    if isinstance(data, list):
        rows.extend(_candidate_dicts(data))
    elif isinstance(data, dict):
        rows.append(data)
    return rows


def _extract_apimart_task_ref(payload: Any) -> str:
    for item in _candidate_dicts(payload):
        task_ref = item.get("task_id") or item.get("id")
        if task_ref:
            return str(task_ref)
    return ""


def _extract_apimart_status(payload: Any) -> str:
    for item in _candidate_dicts(payload):
        status = item.get("status")
        if status:
            return str(status).lower()
    return ""


def _extract_apimart_image_url(payload: Any) -> str:
    candidates = payload if isinstance(payload, list) else [payload]
    for item in candidates:
        if isinstance(item, str) and item.startswith(("http://", "https://")):
            return item
        if not isinstance(item, dict):
            continue
        data = item.get("data") or item
        if isinstance(data, list):
            try:
                return _extract_apimart_image_url(data)
            except CommercialImageError:
                continue
        if not isinstance(data, dict):
            continue
        result = data.get("result") or data.get("output") or {}
        if isinstance(result, list):
            try:
                return _extract_apimart_image_url(result)
            except CommercialImageError:
                result = {}
        images = []
        if isinstance(result, dict):
            images = result.get("images") or result.get("data") or []
        images = images or data.get("images") or data.get("urls") or data.get("url") or data.get("image_url") or []
        if isinstance(images, str):
            return images
        if not isinstance(images, list):
            images = [images]
        if images:
            first = images[0]
            if isinstance(first, str):
                return first
            if not isinstance(first, dict):
                continue
            urls = first.get("url") or first.get("urls") or first.get("image_url")
            if isinstance(urls, list) and urls:
                return urls[0]
            if isinstance(urls, str):
                return urls
    raise CommercialImageError(f"APIMart task result did not include image url: {str(payload)[:500]}")


def _active_provider() -> str:
    provider = os.getenv("PRODUCT_VISUAL_IMAGE_PROVIDER", "auto").strip().lower()
    api_base = os.getenv("OPENAI_API_BASE", "https://api.apimart.ai/v1").lower()
    if provider in {"apimart", "openai", "stepfun"}:
        return provider
    if provider and provider not in {"auto", "mock"}:
        return provider
    if "stepfun" in api_base:
        return "stepfun"
    return "apimart" if "apimart" in api_base else "openai"


def _openai_compatible_image_endpoint() -> str:
    api_base = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1").rstrip("/")
    if _active_provider() == "codox" and api_base == "https://codox-xaas.tidescend.com":
        api_base = f"{api_base}/v1"
    if api_base.endswith("/images/generations"):
        return api_base
    return f"{api_base}/images/generations"


def _suffix_from_url(url: str, fallback: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower().lstrip(".")
    if suffix in {"png", "jpg", "jpeg", "webp"}:
        return "jpg" if suffix == "jpeg" else suffix
    return "jpg" if fallback == "jpeg" else fallback
