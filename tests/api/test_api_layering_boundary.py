import re
from pathlib import Path

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Client.AppClientContext import AppClientContext


def test_app_client_context_groups_ui_clients() -> None:
    context = AppClientContext(
        project_api_client=ProjectApiClient.__new__(ProjectApiClient),
        task_api_client=TaskApiClient.__new__(TaskApiClient),
        workbench_api_client=WorkbenchApiClient.__new__(WorkbenchApiClient),
        settings_api_client=SettingsApiClient.__new__(SettingsApiClient),
        quality_rule_api_client=QualityRuleApiClient.__new__(QualityRuleApiClient),
        proofreading_api_client=ProofreadingApiClient.__new__(ProofreadingApiClient),
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.api_state_store, ApiStateStore)
    assert isinstance(context.quality_rule_api_client, QualityRuleApiClient)
    assert isinstance(context.proofreading_api_client, ProofreadingApiClient)


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "from api.Client" not in content
        assert "import api.Client" not in content


def test_ui_bootstrap_imports_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    app_content = (root_dir / "app.py").read_text(encoding="utf-8")
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.AppClientContext import AppClientContext" in app_content
    assert "from api.Client.AppClientContext import AppClientContext" in window_content
    assert "from api.Application.AppContext import AppContext" not in app_content
    assert "from api.Application.AppContext import AppContext" not in window_content
    assert "quality_rule_api_client=QualityRuleApiClient(api_client)" in app_content
    assert "proofreading_api_client=ProofreadingApiClient(api_client)" in app_content
    assert (
        "self.quality_rule_api_client = app_client_context.quality_rule_api_client"
        in window_content
    )
    assert (
        "self.proofreading_api_client = app_client_context.proofreading_api_client"
        in window_content
    )
    assert re.search(
        r"self\.proofreading_page = ProofreadingPage\(\s*"
        r"\"proofreading_page\",\s*"
        r"self\.proofreading_api_client,\s*"
        r"self\.api_state_store,\s*"
        r"self,\s*\)",
        window_content,
        re.MULTILINE,
    )


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
