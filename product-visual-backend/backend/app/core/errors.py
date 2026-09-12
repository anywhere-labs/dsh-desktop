from fastapi import Request
from fastapi.responses import JSONResponse

from backend.app.core.response import api_response


async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=200,
        content=api_response("failed", "接口执行失败", {}, "", [], [str(exc)], ["查看服务日志并重试"]),
    )

