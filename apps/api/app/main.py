"""FastAPI composition root and cross-cutting HTTP middleware."""

import os
import re
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import create_config, default_settings
from .context import AppContext, ensure_bootstrap_admin
from .http.errors import ApiError
from .http.utils import json_response, set_csrf_cookie, set_security_headers
from .infrastructure.email import EmailService
from .infrastructure.file_storage import create_file_storage
from .infrastructure.store import create_store
from .observability import (
    Logger,
    Metrics,
    configure_logging,
    configure_tracing,
    normalize_traceparent,
    start_http_span,
    trace_id,
)
from .routes import (
    admin,
    admin_settings,
    auth,
    operations,
    registration,
    user,
    user_notifications,
)
from .security.auth import csrf_valid, parse_cookies
from .security.rate_limit import create_rate_limiter

REQUEST_ID_PATTERN = re.compile(r"^[a-zA-Z0-9._:-]{1,120}$")
MUTATIONS = {"POST", "PATCH", "DELETE", "PUT"}


def _request_id(request: Request) -> str:
    incoming = request.headers.get("x-request-id", "").strip()
    return incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid4())


@asynccontextmanager
async def lifespan(application: FastAPI):
    configure_logging()
    config = create_config()
    logger = Logger("lug-api")
    store = await create_store(
        config.database_provider,
        config.data_dir,
        config.database_url,
        default_settings(),
        config.database_pool_min_size,
        config.database_pool_max_size,
    )
    file_storage = create_file_storage(config)
    email_service = EmailService(
        config.email_mode,
        config.smtp_host,
        config.smtp_port,
        config.smtp_user,
        config.smtp_password,
        config.smtp_from,
        config.smtp_from_name,
        config.smtp_ssl,
        config.smtp_starttls,
        config.email_log_code,
        logger,
    )
    rate_limiter = await create_rate_limiter(
        config.redis_url, config.trust_proxy, config.trusted_proxy_ips
    )
    context = AppContext(
        config,
        store,
        file_storage,
        email_service,
        rate_limiter,
        logger,
        Metrics("lug-api"),
        tracer=configure_tracing(
            os.getenv("OTEL_SERVICE_NAME", "lug-api"),
            os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip(),
        ),
    )
    application.state.context = context
    await ensure_bootstrap_admin(context)
    logger.info(
        "api.ready",
        {
            "host": config.api_host,
            "port": config.api_port,
            "persistence": store.provider,
        },
    )
    try:
        yield
    finally:
        await rate_limiter.close()
        await store.close()


app = FastAPI(
    title="ЛУГ 2026 API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
allowed_hosts = [
    item.strip()
    for item in os.getenv("LUG_ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
    if item.strip()
]
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts or ["127.0.0.1"])
app.include_router(auth.router)
app.include_router(registration.router)
app.include_router(user.router)
app.include_router(user_notifications.router)
app.include_router(admin.router)
app.include_router(admin_settings.router)
app.include_router(operations.router)


@app.middleware("http")
async def request_pipeline(request: Request, call_next):
    context: AppContext = request.app.state.context
    request.state.request_id = _request_id(request)
    request.state.traceparent = normalize_traceparent(
        request.headers.get("traceparent")
    )
    request.state.trace_id = trace_id(request.state.traceparent)
    started = perf_counter()
    with start_http_span(
        context.tracer,
        request.method,
        request.url.path,
        request.state.traceparent,
    ) as span:
        if request.method in MUTATIONS and not csrf_valid(request):
            response = json_response(
                {
                    "error": "Недействительный CSRF-токен. Обновите страницу и повторите действие."
                },
                403,
                request,
            )
        else:
            try:
                if request.method in MUTATIONS:
                    async with context.mutation_guard():
                        response = await call_next(request)
                else:
                    response = await call_next(request)
            except Exception as error:
                if isinstance(error, ApiError):
                    response = json_response(
                        {"error": error.message}, error.status_code, request
                    )
                else:
                    context.logger.error(
                        "http.request_failed",
                        {
                            "requestId": request.state.request_id,
                            "traceId": request.state.trace_id,
                            "error": error,
                        },
                    )
                    response = json_response(
                        {"error": "Не удалось выполнить запрос."}, 500, request
                    )
        if span:
            span.set_attribute("http.response.status_code", response.status_code)
    response.headers["traceparent"] = request.state.traceparent
    if "lug_csrf" not in parse_cookies(request):
        set_csrf_cookie(response, uuid4().hex, context.config)
    set_security_headers(response, context.config.secure_cookies)
    context.metrics.increment(f"http_requests.{response.status_code}")
    context.metrics.observe("http_request_duration", (perf_counter() - started) * 1000)
    context.logger.info(
        "http.request",
        {
            "requestId": request.state.request_id,
            "traceId": request.state.trace_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "durationMs": round((perf_counter() - started) * 1000, 2),
        },
    )
    return response
