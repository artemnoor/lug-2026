import ast
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


def _relative_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
    }


def test_http_routes_have_no_infrastructure_or_legacy_orchestration_imports():
    forbidden = ("infrastructure", "registration_helpers", "admin_postgres")
    for path in (API_ROOT / "routes").glob("*.py"):
        imports = _relative_imports(path)
        assert not any(module.startswith(forbidden) for module in imports), (
            f"{path.name} crosses the HTTP/application boundary"
        )
        source = path.read_text(encoding="utf-8")
        assert "context.store." not in source


def test_application_layer_does_not_import_http_routes():
    for path in (API_ROOT / "application").glob("*.py"):
        assert not any(
            module.startswith("..routes") or module.startswith("routes")
            for module in _relative_imports(path)
        ), f"{path.name} imports the HTTP layer"


def test_http_routes_delegate_use_case_construction_to_composition_root():
    forbidden_constructors = {
        "AuthenticationService",
        "RegistrationService",
        "UploadService",
        "ParticipantContextService",
        "ParticipantMutationService",
        "ProfileService",
        "AdminReviewService",
        "AdminQueryService",
        "AdminSettingsService",
        "PasswordResetService",
    }
    for path in (API_ROOT / "routes").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        constructed = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert not constructed & forbidden_constructors, (
            f"{path.name} constructs an application service"
        )


def test_registration_participant_and_admin_routes_have_no_domain_orchestration():
    for name in ("registration.py", "user.py", "admin.py", "admin_settings.py"):
        imports = _relative_imports(API_ROOT / "routes" / name)
        assert "..shared.domain" not in imports


def test_store_is_lifecycle_only_and_repository_ports_are_explicit():
    store_tree = ast.parse(
        (API_ROOT / "infrastructure" / "store.py").read_text(encoding="utf-8")
    )
    classes = {node.name for node in store_tree.body if isinstance(node, ast.ClassDef)}
    assert classes == {"PersistenceBackend", "JsonDatabaseState", "JsonStore"}
    backend = next(
        node
        for node in store_tree.body
        if isinstance(node, ast.ClassDef) and node.name == "PersistenceBackend"
    )
    backend_methods = {
        node.name
        for node in backend.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert backend_methods == {"close"}
    assert "JsonStore(" not in "\n".join(
        path.read_text(encoding="utf-8") for path in (API_ROOT / "routes").glob("*.py")
    )
    repository_source = (API_ROOT / "application" / "repositories.py").read_text(
        encoding="utf-8"
    )
    assert "class ApplicationRepositories" in repository_source
    for name in ("users", "teams", "achievements", "uploads", "sessions"):
        assert f"    {name}:" in repository_source


def test_config_is_composed_from_typed_sections():
    assert (API_ROOT / "config.py").stat().st_size > 0
    assert len((API_ROOT / "config.py").read_text(encoding="utf-8").splitlines()) < 300
    for section in ("database", "security", "storage", "email"):
        path = API_ROOT / "configuration" / f"{section}.py"
        assert path.exists()
        tree = ast.parse(path.read_text(encoding="utf-8"))
        assert any(
            isinstance(node, ast.ClassDef) and node.name.endswith("Settings")
            for node in tree.body
        )
