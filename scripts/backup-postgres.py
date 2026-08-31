"""Create and inspect a PostgreSQL custom-format backup without exposing credentials."""

import argparse
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def database_url() -> str:
    value = os.environ.get("LUG_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not value:
        raise SystemExit("LUG_DATABASE_URL or DATABASE_URL is required")
    return value


def database_with_name(value: str, name: str) -> str:
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        raise SystemExit("Restore test requires a PostgreSQL connection URL")
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment)
    )


def restore_test(archive: Path) -> None:
    if not archive.is_file():
        raise SystemExit(f"Backup does not exist: {archive}")
    base_url = os.environ.get("LUG_POSTGRES_RESTORE_TEST_URL") or database_url()
    admin_url = database_with_name(base_url, "postgres")
    name = f"lug_restore_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    temporary_url = database_with_name(base_url, name)
    subprocess.run(
        ["psql", admin_url, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        subprocess.run(
            [
                "pg_restore",
                "--exit-on-error",
                "--no-owner",
                "--dbname",
                temporary_url,
                str(archive),
            ],
            check=True,
        )
    finally:
        subprocess.run(
            [
                "psql",
                admin_url,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                f'DROP DATABASE IF EXISTS "{name}"',
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
    print(f"postgres_restore_test=ok archive={archive}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("backup", "verify", "restore-test"))
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    if args.command == "backup":
        args.path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                "pg_dump",
                "--format=custom",
                "--no-owner",
                "--file",
                str(args.path),
                database_url(),
            ],
            check=True,
        )
        print(f"postgres_backup={args.path}")
        return
    if not args.path.is_file():
        raise SystemExit(f"Backup does not exist: {args.path}")
    if args.command == "restore-test":
        restore_test(args.path)
        return
    subprocess.run(
        ["pg_restore", "--list", str(args.path)], check=True, stdout=subprocess.DEVNULL
    )
    print(f"postgres_backup_verified={args.path}")


if __name__ == "__main__":
    main()
