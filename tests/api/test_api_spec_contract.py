from pathlib import Path


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
        "frontend.",
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
