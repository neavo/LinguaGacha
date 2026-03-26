from pathlib import Path

from tests.api.server.route_contracts import PHASE_THREE_EXTRA_ROUTE_PATHS
from tests.api.server.route_contracts import PHASE_TWO_SPEC_ROUTE_PATHS


def test_api_root_conftest_only_keeps_shared_fixtures() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "tests" / "api" / "conftest.py").read_text(encoding="utf-8")

    assert "def fake_project_manager" not in content
    assert "def fake_settings_config" not in content


def test_api_root_conftest_does_not_globally_load_domain_plugins() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "tests" / "api" / "conftest.py").read_text(encoding="utf-8")

    assert "pytest_plugins" not in content
    assert "tests.api.support.application_fakes" not in content
    assert "tests.api.application.conftest" not in content
    assert "tests.api.client.conftest" not in content


def test_api_nested_conftests_do_not_define_pytest_plugins() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_content = (
        root_dir / "tests" / "api" / "application" / "conftest.py"
    ).read_text(encoding="utf-8")
    client_content = (root_dir / "tests" / "api" / "client" / "conftest.py").read_text(
        encoding="utf-8"
    )

    assert "pytest_plugins" not in application_content
    assert "pytest_plugins" not in client_content


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")

        assert "from api.Client" not in content
        assert "import api.Client" not in content


def test_frontend_core_design_doc_uses_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (
        root_dir
        / "docs"
        / "superpowers"
        / "specs"
        / "2026-03-24-frontend-core-separation-design.md"
    ).read_text(encoding="utf-8")

    assert "AppClientContext.py" in spec_content
    assert "AppContext.py" not in spec_content


def test_api_spec_documents_phase_two_routes_topics_and_errors() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (root_dir / "api" / "SPEC.md").read_text(encoding="utf-8")

    for route_path in PHASE_TWO_SPEC_ROUTE_PATHS:
        assert route_path in spec_content

    assert "proofreading.snapshot_invalidated" in spec_content
    assert "REVISION_CONFLICT" in spec_content
    assert '{"snapshot": {...}}' in spec_content
    assert '{"search_result": {...}}' in spec_content
    assert '{"result": {...}}' in spec_content
    assert '{"prompt": {...}}' in spec_content


def test_extra_routes_are_documented_in_route_contracts() -> None:
    assert "/api/extra/ts-conversion/options" in PHASE_THREE_EXTRA_ROUTE_PATHS
    assert "/api/extra/name-fields/translate" in PHASE_THREE_EXTRA_ROUTE_PATHS
