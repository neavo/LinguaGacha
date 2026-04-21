from collections.abc import Callable

from api.v2.Application.ProjectAppService import ProjectAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.ProjectApiClient import ProjectApiClient
from api.v2.Models.Project import ProjectPreview
from api.v2.Models.Project import ProjectSnapshot
from api.v2.Server.Routes.ProjectRoutes import ProjectRoutes
from tests.api.support.application_fakes import FakeProjectManager


def test_project_api_client_load_project_returns_project_snapshot(
    fake_project_manager: FakeProjectManager,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))
    project_path = "demo/project.lg"

    result = project_client.load_project({"path": project_path})

    assert isinstance(result, ProjectSnapshot)
    assert result.path == project_path
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


def test_project_api_client_create_project_returns_project_snapshot(
    recording_api_client,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ProjectRoutes.CREATE_PATH,
        {"project": {"path": "demo/output.lg", "loaded": True}},
    )

    result = project_client.create_project(
        {
            "source_path": "demo/source",
            "output_path": "demo/output.lg",
        }
    )

    assert isinstance(result, ProjectSnapshot)
    assert result.path == "demo/output.lg"
    assert recording_api_client.post_requests[-1] == (
        ProjectRoutes.CREATE_PATH,
        {
            "source_path": "demo/source",
            "output_path": "demo/output.lg",
        },
    )


def test_project_api_client_unload_project_returns_empty_snapshot(
    fake_project_manager: FakeProjectManager,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))
    project_client.load_project({"path": "demo/project.lg"})

    result = project_client.unload_project()

    assert isinstance(result, ProjectSnapshot)
    assert result.loaded is False
    assert result.path == ""


def test_project_api_client_collects_source_files(
    fake_project_manager: FakeProjectManager,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))

    result = project_client.collect_source_files("demo/input")

    assert result == ["demo/input"]


def test_project_api_client_get_project_preview_returns_preview(
    fake_project_manager: FakeProjectManager,
    start_api_server: Callable[..., str],
) -> None:
    project_app_service = ProjectAppService(fake_project_manager)
    base_url = start_api_server(project_app_service=project_app_service)
    project_client = ProjectApiClient(ApiClient(base_url))
    project_path = "demo/project.lg"

    result = project_client.get_project_preview(project_path)

    assert isinstance(result, ProjectPreview)
    assert result.path == project_path
    assert result.source_language == "JA"
    assert result.target_language == "ZH"
    assert result.total_items == 8
    assert result.translated_items == 3
    assert result.progress == 0.375
