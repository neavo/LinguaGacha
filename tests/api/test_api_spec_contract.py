from pathlib import Path

from tests.api.server.route_contracts import PHASE_TWO_SPEC_ROUTE_PATHS


FRONTEND_RUNTIME_REFERENCE: str = "frontend."
# 规格守卫文件自身也会被 rg 扫描，所以把反模式关键字拆成片段再在运行时拼回，避免巡检自命中。
NEW_OBJECT_ANTIPATTERN_PARTS: tuple[str, ...] = (".", "__", "new", "__")
TRACE_LIST_ANTIPATTERN_PARTS: tuple[str, ...] = ("call", "_", "args", "_", "list")
KNOWN_WHITE_BOX_ANTIPATTERNS: tuple[str, ...] = (
    "".join(NEW_OBJECT_ANTIPATTERN_PARTS),
    "".join(TRACE_LIST_ANTIPATTERN_PARTS),
)


def test_api_test_directories_follow_runtime_layout() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert (tests_api_dir / "application").is_dir()
    assert (tests_api_dir / "client").is_dir()


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


def test_boundary_checks_are_split_by_runtime_owner() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert (tests_api_dir / "client" / "test_app_client_context.py").is_file()
    assert (tests_api_dir / "server" / "test_route_contracts.py").is_file()
    assert (tests_api_dir / "bridge" / "test_event_topic.py").is_file()


def test_legacy_layering_boundary_file_is_removed() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    assert not (root_dir / "tests" / "api" / "test_api_layering_boundary.py").exists()


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


def test_client_tests_follow_one_file_per_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    client_dir = root_dir / "tests" / "api" / "client"
    removed_client_test = client_dir / "test_api_client.py"
    expected_file_names = {
        "test_project_api_client.py",
        "test_quality_rule_api_client.py",
        "test_proofreading_api_client.py",
        "test_task_api_client.py",
        "test_settings_api_client.py",
        "test_workbench_api_client.py",
    }
    actual_file_names = {
        file_path.name for file_path in client_dir.glob("test_*_api_client.py")
    }

    assert removed_client_test.is_file() is False
    assert actual_file_names == expected_file_names


def test_client_test_files_do_not_reference_frontend_pages() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    client_dir = root_dir / "tests" / "api" / "client"
    blocked_page_references = (
        FRONTEND_RUNTIME_REFERENCE,
        "ProjectPage",
        "TranslationPage",
        "AnalysisPage",
        "WorkbenchPage",
        "AppSettingsPage",
        "BasicSettingsPage",
        "ExpertSettingsPage",
    )

    for file_path in client_dir.glob("test_*_api_client.py"):
        content = file_path.read_text(encoding="utf-8")

        for blocked_reference in blocked_page_references:
            assert blocked_reference not in content


def test_removed_page_coupled_files_no_longer_exist() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    tests_api_dir = root_dir / "tests" / "api"

    assert not (tests_api_dir / "test_proofreading_page_api_consumer.py").exists()
    assert not (tests_api_dir / "test_quality_frontend_prompt_guards.py").exists()


def test_api_tests_do_not_use_known_white_box_antipatterns() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    current_file = Path(__file__).resolve()

    for file_path in (root_dir / "tests" / "api").rglob("test_*.py"):
        if file_path.resolve() == current_file:
            continue

        content = file_path.read_text(encoding="utf-8")

        for antipattern in KNOWN_WHITE_BOX_ANTIPATTERNS:
            assert antipattern not in content


def test_api_tests_do_not_reference_frontend_runtime() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    current_file = Path(__file__).resolve()

    for file_path in (root_dir / "tests" / "api").rglob("test_*.py"):
        if file_path.resolve() == current_file:
            continue

        content = file_path.read_text(encoding="utf-8")
        assert FRONTEND_RUNTIME_REFERENCE not in content
