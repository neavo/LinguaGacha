from collections.abc import Callable

from api.Application.ProjectAppService import ProjectAppService
from api.Client.ApiClient import ApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Models.Project import ProjectPreview
from api.Models.Project import ProjectSnapshot
from tests.api.support.application_fakes import FakeProjectManager


def test_project_api_client_load_project_returns_project_snapshot(
    fake_project_manager: FakeProjectManager,
    lg_path: str,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))

    result = project_client.load_project({"path": lg_path})

    assert isinstance(result, ProjectSnapshot)
    assert result.path == lg_path
    assert result.loaded is True


def test_project_api_client_get_project_snapshot_returns_snapshot(
    fake_project_manager: FakeProjectManager,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))

    result = project_client.get_project_snapshot()

    assert isinstance(result, ProjectSnapshot)
    assert result.loaded is False


def test_project_api_client_get_project_preview_returns_preview(
    fake_project_manager: FakeProjectManager,
    lg_path: str,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))

    result = project_client.get_project_preview(lg_path)

    assert isinstance(result, ProjectPreview)
    assert result.path == lg_path
    assert result.source_language == "JA"
    assert result.target_language == "ZH"
    assert result.total_items == 8
    assert result.translated_items == 3
    assert result.progress == 0.375
