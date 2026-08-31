"""FastAPI request parsing and response security helpers."""

import json
from hashlib import sha256
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from ..config import AppConfig
from ..security.auth import CSRF_COOKIE, SESSION_COOKIE
from .errors import ApiError


async def read_json(request: Request, max_bytes: int) -> dict[str, Any]:
    raw_length = request.headers.get("content-length")
    if raw_length and not raw_length.isdecimal():
        raise ApiError(400, "Некорректная длина запроса.")
    declared = int(raw_length) if raw_length else 0
    if declared > max_bytes:
        raise ApiError(
            413, f"Файл или запрос превышает лимит {round(max_bytes / 1024 / 1024)} МБ."
        )
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise ApiError(415, "Сжатые тела запросов не поддерживаются.")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise ApiError(
                413,
                f"Файл или запрос превышает лимит {round(max_bytes / 1024 / 1024)} МБ.",
            )
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(400, "Некорректный формат запроса.") from exc
    if not isinstance(value, dict):
        raise ApiError(400, "Некорректный формат запроса.")
    return value


def json_response(
    data: Any,
    status_code: int = 200,
    request: Request | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    response = JSONResponse(data, status_code=status_code, headers=headers or {})
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("Pragma", "no-cache")
    response.headers.setdefault("Vary", "Cookie")
    if request is not None:
        response.headers["X-Request-Id"] = request.state.request_id
    return response


def public_json_response(data: Any, request: Request) -> JSONResponse | Response:
    """Return a cacheable public projection with safe conditional requests."""
    encoded = json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    etag = f'"{sha256(encoded).hexdigest()[:24]}"'
    if request.headers.get("if-none-match", "").strip() == etag:
        response = Response(status_code=304)
    else:
        response = JSONResponse(data)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
    response.headers["Vary"] = "Accept-Encoding"
    response.headers["X-Request-Id"] = request.state.request_id
    return response


def set_session_cookie(
    response: Response, token: str, config: AppConfig, max_age: int | None = None
) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=config.session_ttl_ms // 1000 if max_age is None else max_age,
        httponly=True,
        samesite="lax",
        secure=config.secure_cookies,
        path="/",
    )


def set_csrf_cookie(response: Response, token: str, config: AppConfig) -> None:
    response.set_cookie(
        CSRF_COOKIE,
        token,
        max_age=604800,
        httponly=False,
        samesite="lax",
        secure=config.secure_cookies,
        path="/",
    )


def set_security_headers(
    response: Response, secure: bool, csp: bool = False
) -> Response:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    if csp:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; media-src 'self' https:; frame-src 'self' https://rutube.ru https://vk.com https://vkvideo.ru; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'"
        )
    if secure:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response
