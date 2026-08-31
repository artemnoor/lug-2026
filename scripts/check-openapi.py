"""Check that the checked-in contract covers every FastAPI HTTP operation."""

import json
import re
import sys
from pathlib import Path

from fastapi.routing import APIRoute

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "packages" / "contracts" / "openapi.json"
sys.path.insert(0, str(ROOT))

from apps.api.app.main import app  # noqa: E402


def route_operations() -> set[tuple[str, str]]:
    routers = [
        route.original_router
        for route in app.routes
        if hasattr(route, "original_router")
    ]
    return {
        (method.lower(), re.sub(r"\{[^}]+\}", "{}", route.path))
        for router in routers
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods
        if method not in {"HEAD", "OPTIONS"}
    }


def main() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    documented = {
        (method.lower(), re.sub(r"\{[^}]+\}", "{}", path))
        for path, operations in contract.get("paths", {}).items()
        for method in operations
        if method.lower() in {"get", "post", "put", "patch", "delete"}
    }
    actual = route_operations()
    missing = sorted(actual - documented)
    stale = sorted(documented - actual)
    if missing or stale:
        raise SystemExit(f"openapi drift: missing={missing}, stale={stale}")
    operations = [
        operation
        for operations in contract.get("paths", {}).values()
        for method, operation in operations.items()
        if method.lower() in {"get", "post", "put", "patch", "delete"}
    ]
    operation_ids = [operation.get("operationId") for operation in operations]
    if any(not operation_id for operation_id in operation_ids):
        raise SystemExit("openapi contract: every operation must define operationId")
    if len(operation_ids) != len(set(operation_ids)):
        raise SystemExit("openapi contract: operationId values must be unique")
    print(f"openapi: {len(actual)} operations covered")


if __name__ == "__main__":
    main()
