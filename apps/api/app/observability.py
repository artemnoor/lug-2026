"""Structured logs and Prometheus-compatible process metrics."""

import json
import logging
import re
import time
from collections import Counter
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

TRACEPARENT_PATTERN = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")
_TRACER = None
_REDACT_KEYS = {
    "password",
    "passwordhash",
    "authorization",
    "cookie",
    "token",
    "code",
    "secret",
    "smtp_password",
    "smtpcredentials",
    "dsn",
}


def _json_default(value: Any) -> str:
    return str(value)


def _redact(value: Any, key: str = "", allow_code: bool = False) -> Any:
    normalized = key.replace("_", "").replace("-", "").lower()
    if (
        (normalized in _REDACT_KEYS and not (allow_code and normalized == "code"))
        or normalized.endswith("token")
        or normalized.endswith("secret")
    ):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            str(item_key): _redact(item_value, str(item_key), allow_code)
            for item_key, item_value in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item, allow_code=allow_code) for item in value]
    return value


def normalize_traceparent(value: str | None) -> str:
    from secrets import token_hex

    match = TRACEPARENT_PATTERN.fullmatch(str(value or "").lower())
    if match and set(match.group(1)) != {"0"} and set(match.group(2)) != {"0"}:
        return str(value).lower()
    return f"00-{token_hex(16)}-{token_hex(8)}-01"


def trace_id(traceparent: str) -> str:
    return TRACEPARENT_PATTERN.fullmatch(traceparent).group(1)


def configure_tracing(service: str, endpoint: str = ""):
    global _TRACER
    if _TRACER is not None:
        return _TRACER
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider

        provider = TracerProvider(resource=Resource.create({"service.name": service}))
        if endpoint:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint)))
        trace.set_tracer_provider(provider)
        _TRACER = trace.get_tracer(service)
    except ImportError:
        _TRACER = None
    return _TRACER


@contextmanager
def start_http_span(tracer: Any, method: str, path: str, traceparent: str):
    if tracer is None:
        with nullcontext(None) as span:
            yield span
        return
    from opentelemetry.propagate import extract

    context = extract({"traceparent": traceparent})
    with tracer.start_as_current_span(f"{method} {path}", context=context) as span:
        span.set_attribute("http.request.method", method)
        span.set_attribute("url.path", path)
        yield span


@dataclass
class Histogram:
    buckets: tuple[float, ...]
    counts: list[int] = field(init=False)
    count: int = 0
    total: float = 0.0

    def __post_init__(self) -> None:
        self.counts = [0] * len(self.buckets)

    def observe(self, value: float) -> None:
        self.count += 1
        self.total += value
        for index, bucket in enumerate(self.buckets):
            if value <= bucket:
                self.counts[index] += 1


@dataclass
class Metrics:
    service: str
    counters: Counter = field(default_factory=Counter)
    histograms: dict[str, Histogram] = field(default_factory=dict)
    route_histograms: dict[tuple[str, str], Histogram] = field(default_factory=dict)
    histogram_buckets: tuple[float, ...] = (
        5,
        10,
        25,
        50,
        100,
        250,
        500,
        1000,
        2500,
        5000,
        10000,
    )

    def increment(self, name: str) -> None:
        self.counters[name] += 1

    def observe(self, name: str, value: float) -> None:
        self.histograms.setdefault(name, Histogram(self.histogram_buckets)).observe(
            value
        )

    def observe_route(self, name: str, route: str, value: float) -> None:
        """Observe a route template; callers must pass a framework template, not a raw URL."""
        normalized = route.strip() or "unknown"
        key = (name, normalized)
        self.route_histograms.setdefault(
            key, Histogram(self.histogram_buckets)
        ).observe(value)

    def prometheus(self) -> str:
        lines = []
        for name, value in sorted(self.counters.items()):
            metric = name.replace(".", "_")
            lines.append(f'lug_{metric}{{service="{self.service}"}} {value}')
        for name, histogram in sorted(self.histograms.items()):
            metric = name.replace(".", "_")
            for bucket, count in zip(histogram.buckets, histogram.counts):
                lines.append(
                    f'lug_{metric}_bucket{{le="{bucket:g}",service="{self.service}"}} {count}'
                )
            lines.append(
                f'lug_{metric}_bucket{{le="+Inf",service="{self.service}"}} {histogram.count}'
            )
            lines.append(
                f'lug_{metric}_count{{service="{self.service}"}} {histogram.count}'
            )
            lines.append(
                f'lug_{metric}_sum{{service="{self.service}"}} {histogram.total:.3f}'
            )
        for (name, route), histogram in sorted(self.route_histograms.items()):
            metric = name.replace(".", "_")
            label = route.replace("\\", "\\\\").replace('"', '\\"')
            for bucket, count in zip(histogram.buckets, histogram.counts):
                lines.append(
                    f'lug_{metric}_bucket{{route="{label}",le="{bucket:g}",service="{self.service}"}} {count}'
                )
            lines.append(
                f'lug_{metric}_bucket{{route="{label}",le="+Inf",service="{self.service}"}} {histogram.count}'
            )
            lines.append(
                f'lug_{metric}_count{{route="{label}",service="{self.service}"}} {histogram.count}'
            )
            lines.append(
                f'lug_{metric}_sum{{route="{label}",service="{self.service}"}} {histogram.total:.3f}'
            )
        return "\n".join(lines) + "\n"


class Logger:
    def __init__(self, service: str, allow_sensitive_codes: bool = False) -> None:
        self.service = service
        self.allow_sensitive_codes = allow_sensitive_codes
        self._logger = logging.getLogger(service)

    def _write(self, level: str, event: str, fields: dict[str, Any]) -> None:
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": level,
            "service": self.service,
            "event": event,
            **_redact(fields, allow_code=self.allow_sensitive_codes),
        }
        self._logger.log(
            getattr(logging, level.upper(), logging.INFO),
            json.dumps(record, ensure_ascii=False, default=_json_default),
        )

    def info(self, event: str, fields: dict[str, Any] | None = None) -> None:
        self._write("info", event, fields or {})

    def warning(self, event: str, fields: dict[str, Any] | None = None) -> None:
        self._write("warning", event, fields or {})

    def error(self, event: str, fields: dict[str, Any] | None = None) -> None:
        self._write("error", event, fields or {})


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")


def monotonic_ms() -> float:
    return time.perf_counter() * 1000
