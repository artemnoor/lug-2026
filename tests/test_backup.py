import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "backup_json", Path(__file__).resolve().parents[1] / "scripts" / "backup-json.py"
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
backup, restore = _module.backup, _module.restore


class BackupTests(unittest.TestCase):
    def test_json_backup_restore_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            source = data_dir / "lug.json"
            original = {"settings": {"version": 1}, "users": [{"id": "u1"}]}
            source.write_text(json.dumps(original), encoding="utf-8")
            archive = backup(data_dir, 7)
            source.write_text(
                json.dumps({"settings": {"version": 2}}), encoding="utf-8"
            )
            restore(archive, data_dir, 7)
            self.assertEqual(json.loads(source.read_text(encoding="utf-8")), original)
            self.assertTrue(list(data_dir.glob("lug-*.json.gz")))
