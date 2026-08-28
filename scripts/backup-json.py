"""Atomic backup and restore utility for the development JSON store."""

import argparse
import gzip
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile


def _data_dir(value: str | None) -> Path:
    return Path(value or os.getenv("LUG_DATA_DIR", "data")).resolve()


def _validate_state(raw: str) -> None:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("lug.json содержит некорректный JSON.") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Корень lug.json должен быть JSON-объектом.")


def _atomic_write(path: Path, content: bytes) -> None:
    temporary = None
    try:
        with NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def backup(data_dir: Path, retention_days: int) -> Path:
    source = data_dir / "lug.json"
    if not source.is_file():
        raise RuntimeError(f"Файл состояния не найден: {source}")
    raw = source.read_text(encoding="utf-8")
    _validate_state(raw)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    archive = data_dir / f"lug-{stamp}.json.gz"
    compressed = gzip.compress(raw.encode("utf-8"), compresslevel=6, mtime=0)
    _atomic_write(archive, compressed)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    for candidate in data_dir.glob("lug-*.json.gz"):
        if candidate == archive:
            continue
        modified = datetime.fromtimestamp(candidate.stat().st_mtime, timezone.utc)
        if modified < cutoff:
            candidate.unlink(missing_ok=True)
    return archive


def restore(archive: Path, data_dir: Path, retention_days: int) -> Path:
    archive = archive.resolve()
    if archive.suffixes[-2:] != [".json", ".gz"] or not archive.is_file():
        raise RuntimeError("Укажите существующий архив с расширением .json.gz.")
    with gzip.open(archive, "rt", encoding="utf-8") as handle:
        raw = handle.read()
    _validate_state(raw)
    target = data_dir / "lug.json"
    if target.is_file():
        backup(data_dir, retention_days)
    _atomic_write(target, raw.encode("utf-8"))
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default=None)
    parser.add_argument(
        "--retention-days",
        type=int,
        default=max(1, int(os.getenv("LUG_BACKUP_RETENTION_DAYS", "7"))),
    )
    commands = parser.add_subparsers(dest="command", required=True)
    backup_parser = commands.add_parser("backup")
    backup_parser.add_argument("--data-dir", dest="data_dir_after", default=argparse.SUPPRESS)
    backup_parser.add_argument("--retention-days", dest="retention_after", type=int, default=argparse.SUPPRESS)
    restore_parser = commands.add_parser("restore")
    restore_parser.add_argument("archive", type=Path)
    restore_parser.add_argument("--data-dir", dest="data_dir_after", default=argparse.SUPPRESS)
    restore_parser.add_argument("--retention-days", dest="retention_after", type=int, default=argparse.SUPPRESS)
    args = parser.parse_args()
    data_dir = _data_dir(getattr(args, "data_dir_after", None) or args.data_dir)
    retention_days = getattr(args, "retention_after", None) or args.retention_days
    data_dir.mkdir(parents=True, exist_ok=True)
    result = (
        backup(data_dir, retention_days)
        if args.command == "backup"
        else restore(args.archive, data_dir, retention_days)
    )
    print(result)


if __name__ == "__main__":
    main()
