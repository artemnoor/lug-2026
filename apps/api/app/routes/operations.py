"""Operational endpoints and authorized private object delivery."""

import json
from hmac import compare_digest
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response

from ..http.errors import ApiError
from ..http.utils import json_response
from ..security.auth import current_user

router = APIRouter()


@router.get("/healthz")
async def healthz(request: Request):
    context = request.app.state.context
    return json_response(
        {
            "status": "ok",
            "service": "lug-api",
            "persistence": context.store.provider,
            "storage": context.file_storage.provider,
            "rateLimitStore": context.rate_limiter.store_name,
        },
        request=request,
    )


@router.get("/livez")
async def livez(request: Request):
    return json_response({"status": "ok", "service": "lug-api"}, request=request)


@router.get("/readyz")
async def readyz(request: Request):
    _require_operations_access(request)
    context = request.app.state.context
    try:
        await context.store.load()
        await context.file_storage.ready()
        await context.rate_limiter.ready()
    except Exception as error:
        context.logger.warning("readiness.failed", {"error": error})
        return json_response(
            {"status": "not_ready", "service": "lug-api"}, 503, request
        )
    return json_response({"status": "ready", "service": "lug-api"}, request=request)


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


@router.get("/api/openapi.yaml")
async def openapi_yaml(request: Request):
    return _contract_response(request, "openapi.yaml", "application/yaml")


@router.api_route("/uploads/{filename:path}", methods=["GET", "HEAD"])
async def private_upload(filename: str, request: Request):
    context = request.app.state.context
    state = await context.store.load()
    user = current_user(request, state)
    if not user:
        raise ApiError(401, "Требуется вход для доступа к файлу.")
    upload = context.file_storage.resolve(f"/uploads/{filename}")
    if not upload or not await context.file_storage.exists(upload):
        raise ApiError(404, "Файл не найден.")
    if not _can_read_upload(state, user, upload["url"]):
        raise ApiError(403, "Недостаточно прав для доступа к файлу.")
    suffix = Path(upload["url"]).suffix.lower()
    media = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
        ".heic": "image/heic", ".heif": "image/heif", ".tif": "image/tiff",
        ".tiff": "image/tiff", ".bmp": "image/bmp", ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    }
    disposition = "inline" if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".heic", ".heif", ".tif", ".tiff", ".bmp", ".mp4", ".webm", ".mov"} else "attachment"
    signed_url = await context.file_storage.signed_url(upload)
    headers = {
        "Cache-Control": "private, no-store",
        "Content-Disposition": disposition,
        "X-Request-Id": request.state.request_id,
    }
    if signed_url:
        headers["Location"] = signed_url
        return Response(status_code=302, headers=headers)
    return FileResponse(upload["path"], media_type=media.get(suffix, "application/octet-stream"), headers=headers)


def _contract_response(request: Request, filename: str, media_type: str) -> Response:
    path = Path(request.app.state.context.config.root) / "packages" / "contracts" / filename
    if not path.exists():
        raise ApiError(404, "Контракт API не найден.")
    content = path.read_text(encoding="utf-8")
    if filename.endswith(".json"):
        content = json.dumps(json.loads(content), ensure_ascii=False)
    response = Response(content, media_type=media_type)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-Id"] = request.state.request_id
    return response


def _can_read_upload(state: dict, user: dict, url: str) -> bool:
    if user.get("role") == "admin" or user.get("studentCardFile") == url:
        return True
    if any(item.get("userId") == user.get("id") and item.get("fileUrl") == url for item in state["achievements"]):
        return True
    if any(item.get("userId") == user.get("id") and item.get("url") == url for item in state["uploads"]):
        return True
    team = next((team for team in state["teams"] if team.get("id") == user.get("teamId")), None)
    return bool(team and team.get("flagUrl") == url)


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
