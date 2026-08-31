"""Operational endpoints and authorized private object delivery."""

import json
import os
from hmac import compare_digest
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

from ..http.errors import ApiError
from ..http.utils import json_response
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies

router = APIRouter()


def _build_metadata() -> dict[str, str]:
    return {
        "version": os.getenv("LUG_BUILD_VERSION", "dev"),
        "sha": os.getenv("LUG_BUILD_SHA", "unknown"),
    }


@router.get("/healthz")
async def healthz(request: Request):
    context = request.app.state.context
    return json_response(
        {
            "status": "ok",
            "service": "lug-api",
            **_build_metadata(),
            "persistence": context.store.provider,
            "storage": context.file_storage.provider,
            "rateLimitStore": context.rate_limiter.store_name,
        },
        request=request,
    )


@router.get("/livez")
async def livez(request: Request):
    return json_response(
        {"status": "ok", "service": "lug-api", **_build_metadata()}, request=request
    )


@router.get("/version")
async def version(request: Request):
    return json_response({"service": "lug-api", **_build_metadata()}, request=request)


@router.get("/readyz")
async def readyz(request: Request):
    _require_operations_access(request)
    context = request.app.state.context
    try:
        await context.store.get_settings()
        await context.file_storage.ready()
        await context.rate_limiter.ready()
    except Exception as error:
        context.logger.warning(
            "readiness.failed",
            {"errorType": type(error).__name__, "errorMessage": str(error)[:500]},
        )
        return json_response(
            {"status": "not_ready", "service": "lug-api", **_build_metadata()},
            503,
            request,
        )
    return json_response(
        {"status": "ready", "service": "lug-api", **_build_metadata()}, request=request
    )


@router.get("/metrics")
async def metrics(request: Request):
    _require_operations_access(request)
    context = request.app.state.context
    response = PlainTextResponse(
        context.metrics.prometheus(), media_type="text/plain; version=0.0.4"
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-Id"] = request.state.request_id
    return response


@router.get("/api/openapi.json")
async def openapi_json(request: Request):
    return _contract_response(request, "openapi.json", "application/json")


@router.api_route("/uploads/{filename:path}", methods=["GET", "HEAD"])
async def private_upload(filename: str, request: Request):
    context = request.app.state.context
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход для доступа к файлу.")
    upload = context.file_storage.resolve(f"/uploads/{filename}")
    if not upload or not await context.file_storage.exists(upload):
        raise ApiError(404, "Файл не найден.")
    if not await context.store.can_user_read_upload(user["id"], upload["url"]):
        raise ApiError(403, "Недостаточно прав для доступа к файлу.")
    suffix = Path(upload["url"]).suffix.lower()
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".avif": "image/avif",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".bmp": "image/bmp",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
    }
    disposition = (
        "inline"
        if suffix
        in {
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".gif",
            ".avif",
            ".heic",
            ".heif",
            ".tif",
            ".tiff",
            ".bmp",
            ".mp4",
            ".webm",
            ".mov",
        }
        else "attachment"
    )
    signed_url = await context.file_storage.signed_url(upload)
    headers = {
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition,
        "X-Request-Id": request.state.request_id,
    }
    if signed_url:
        headers["Location"] = signed_url
        return Response(status_code=302, headers=headers)
    content = await context.file_storage.read(upload)
    return Response(
        content,
        media_type=media.get(suffix, "application/octet-stream"),
        headers=headers,
    )


def _contract_response(request: Request, filename: str, media_type: str) -> Response:
    path = (
        Path(request.app.state.context.config.root)
        / "packages"
        / "contracts"
        / filename
    )
    if not path.exists():
        raise ApiError(404, "Контракт API не найден.")
    content = path.read_text(encoding="utf-8")
    if filename.endswith(".json"):
        content = json.dumps(json.loads(content), ensure_ascii=False)
    response = Response(content, media_type=media_type)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-Id"] = request.state.request_id
    return response


def _require_operations_access(request: Request) -> None:
    config = request.app.state.context.config
    if config.operations_token:
        if compare_digest(
            request.headers.get("authorization", ""),
            f"Bearer {config.operations_token}",
        ):
            return
    elif (request.client and request.client.host) in {"127.0.0.1", "::1", "localhost"}:
        return
    raise ApiError(404, "Маршрут не найден.")
