from pathlib import Path

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
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
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.api_state_store, ApiStateStore)


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "from api.Client" not in content
        assert "import api.Client" not in content
