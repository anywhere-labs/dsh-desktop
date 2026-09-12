from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time


DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 15 * 60


def signed_delivery_package_download_url(package_id: str, *, ttl_seconds: int | None = None) -> str:
    token = create_delivery_package_download_token(package_id, ttl_seconds=ttl_seconds)
    return f"/api/liveclip/delivery-packages/{package_id}/download?token={token}"


def create_delivery_package_download_token(package_id: str, *, ttl_seconds: int | None = None) -> str:
    expires_at = int(time.time()) + int(ttl_seconds or _token_ttl_seconds())
    payload = f"{package_id}|{expires_at}"
    signature = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return f"{expires_at}.{encoded_signature}"


def verify_delivery_package_download_token(package_id: str, token: str) -> bool:
    try:
        expires_raw, signature = token.split(".", 1)
        expires_at = int(expires_raw)
    except (ValueError, AttributeError):
        return False
    if expires_at < int(time.time()):
        return False
    payload = f"{package_id}|{expires_at}"
    expected = base64.urlsafe_b64encode(
        hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).digest()
    ).decode("ascii").rstrip("=")
    return hmac.compare_digest(signature, expected)


def _token_ttl_seconds() -> int:
    try:
        return max(60, int(os.getenv("LIVECLIP_DOWNLOAD_TOKEN_TTL_SECONDS", DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS)))
    except ValueError:
        return DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS


def _secret() -> bytes:
    return os.getenv("LIVECLIP_DOWNLOAD_TOKEN_SECRET", "local-liveclip-download-token-secret").encode("utf-8")
