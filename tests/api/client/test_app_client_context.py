from pathlib import Path

from api.Client.ApiClient import ApiClient
from api.Client.ApiStateStore import ApiStateStore
from api.Client.AppClientContext import AppClientContext
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient


def test_app_client_context_groups_real_clients() -> None:
    # 准备
    api_client = ApiClient("http://testserver")
    context = AppClientContext(
        project_api_client=ProjectApiClient(api_client),
        task_api_client=TaskApiClient(api_client),
        workbench_api_client=WorkbenchApiClient(api_client),
        settings_api_client=SettingsApiClient(api_client),
        quality_rule_api_client=QualityRuleApiClient(api_client),
        proofreading_api_client=ProofreadingApiClient(api_client),
        api_state_store=ApiStateStore(),
    )

    # 执行
    project_client = context.project_api_client
    proofreading_client = context.proofreading_api_client

    # 断言
    assert isinstance(project_client, ProjectApiClient)
    assert isinstance(proofreading_client, ProofreadingApiClient)
    assert isinstance(context.api_state_store, ApiStateStore)


def test_ui_bootstrap_imports_app_client_context() -> None:
    # 准备
    root_dir = Path(__file__).resolve().parents[3]
    app_content = (root_dir / "app.py").read_text(encoding="utf-8")
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )

    # 执行
    proofreading_page_uses_client_context = (
        "self.proofreading_api_client = app_client_context.proofreading_api_client"
        in window_content
    )

    # 断言
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
    assert proofreading_page_uses_client_context
