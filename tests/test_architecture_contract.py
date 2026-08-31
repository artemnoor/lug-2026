from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_ROOT = ROOT / "apps" / "api" / "app"


def test_routes_do_not_depend_on_global_store_load_save_or_provider_checks():
    route_sources = "\n".join(
        path.read_text(encoding="utf-8") for path in (API_ROOT / "routes").glob("*.py")
    )
    assert "hasattr(store" not in route_sources
    assert "store.load(" not in route_sources
    assert "store.save(" not in route_sources
    assert "file_storage.save_stream(" not in route_sources
    assert "file_storage.create_upload_intent(" not in route_sources
    assert "file_storage.complete_upload(" not in route_sources


def test_postgres_runtime_has_no_json_state_or_ddl_bootstrap():
    postgres_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (API_ROOT / "infrastructure").glob("postgres*.py")
    )
    assert "DatabaseState" not in postgres_sources
    assert "CREATE TABLE" not in postgres_sources
    assert "ALTER TABLE" not in postgres_sources


def test_storage_contract_exposes_projection_boundaries():
    store_source = (API_ROOT / "infrastructure" / "store.py").read_text(
        encoding="utf-8"
    )
    assert "get_dashboard_projection" in store_source
    assert "get_admin_overview" in store_source
    assert "class JsonDatabaseState" in store_source
