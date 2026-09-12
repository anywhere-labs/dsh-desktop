from __future__ import annotations


def api_response(status: str = "ok", message: str = "", data: dict | None = None,
                 trace_id: str = "", missing_inputs: list[str] | None = None,
                 warnings: list[str] | None = None, next_action: list[str] | None = None) -> dict:
    return {
        "status": status,
        "message": message,
        "data": data or {},
        "trace_id": trace_id,
        "missing_inputs": missing_inputs or [],
        "warnings": warnings or [],
        "next_action": next_action or [],
    }

