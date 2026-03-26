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
