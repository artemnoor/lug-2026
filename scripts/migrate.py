"""Run release-time PostgreSQL migrations; never imported by the API runtime."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if not os.environ.get("LUG_DATABASE_URL") and not os.environ.get("DATABASE_URL"):
    raise SystemExit("LUG_DATABASE_URL или DATABASE_URL обязателен")

raise SystemExit(
    subprocess.call(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            str(ROOT / "alembic.ini"),
            "upgrade",
            "head",
        ],
        cwd=ROOT,
    )
)
