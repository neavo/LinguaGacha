from api.Application.ProjectAppService import ProjectAppService
from api.Client.ApiClient import ApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Server.ServerBootstrap import ServerBootstrap


def test_project_api_client_load_project_returns_project_snapshot(
    fake_project_manager,
    lg_path: str,
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=project_app_service
    )
    try:
        api_client = ApiClient(base_url)
        project_client = ProjectApiClient(api_client)

        result = project_client.load_project({"path": lg_path})

        assert result["project"]["path"] == lg_path
        assert result["project"]["loaded"] is True
    finally:
        shutdown()


def test_project_api_client_get_project_snapshot_returns_snapshot(
    fake_project_manager,
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url, shutdown = ServerBootstrap.start_for_test(
        project_app_service=project_app_service
    )
    try:
        api_client = ApiClient(base_url)
        project_client = ProjectApiClient(api_client)

        result = project_client.get_project_snapshot()

        assert result["project"]["loaded"] is False
    finally:
        shutdown()
