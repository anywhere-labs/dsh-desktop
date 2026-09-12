from __future__ import annotations

import os
import re

from fastapi import Request
from starlette.responses import JSONResponse


CUSTOMER_MODE_ENV = "LIVECLIP_CUSTOMER_MODE"

_ALLOWED_EXACT_PATHS = {
    "/api/liveclip/upload",
    "/api/liveclip/preflight",
    "/api/liveclip/start",
    "/api/liveclip/status",
    "/api/liveclip/result",
    "/api/liveclip/subtitle",
    "/api/liveclip/copywriting",
    "/api/liveclip/qa",
    "/api/liveclip/approve",
    "/api/liveclip/export",
    "/api/liveclip/logs",
}

_ALLOWED_PATH_PATTERNS = [
    re.compile(r"^/api/liveclip/tasks/[^/]+/clips/[^/]+/(preview|download|subtitle|copywriting)$"),
    re.compile(r"^/api/liveclip/tasks/[^/]+/clips/[^/]+/repair$"),
    re.compile(r"^/api/liveclip/tasks/[^/]+/(repair-summary|restore-previous)$"),
    re.compile(r"^/api/liveclip/tasks/[^/]+/caption-review$"),
    re.compile(r"^/api/liveclip/tasks/[^/]+/versions/[^/]+/activate$"),
    re.compile(r"^/api/liveclip/delivery-packages/[^/]+$"),
    re.compile(r"^/api/liveclip/delivery-packages/[^/]+/download$"),
]


def liveclip_customer_mode_enabled() -> bool:
    return os.getenv(CUSTOMER_MODE_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def is_customer_allowed_route(path: str) -> bool:
    if path in _ALLOWED_EXACT_PATHS:
        return True
    return any(pattern.match(path) for pattern in _ALLOWED_PATH_PATTERNS)


async def liveclip_customer_route_whitelist_middleware(request: Request, call_next):
    if not liveclip_customer_mode_enabled():
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    if is_customer_allowed_route(request.url.path):
        return await call_next(request)
    return JSONResponse(
        status_code=404,
        content={
            "status": "blocked",
            "message": "当前为客户交付模式，该入口不可用。",
            "next_action": "请使用页面上的上传、生成、确认和下载入口。",
            "missing_inputs": ["customer_route"],
            "warnings": ["当前为客户交付模式，该入口不可用。"],
        },
    )
