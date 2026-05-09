from api.Client.ProjectApiClient import ProjectApiClient
from api.Contract.ApiPaths import ProjectApiPaths
from api.Models.Project import ProjectPreview
from api.Models.Project import ProjectSnapshot
from tests.api.Client.conftest import RecordingApiClient


def test_project_api_client_load_project_returns_project_snapshot(
    recording_api_client: RecordingApiClient,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    project_path = "demo/project.lg"
    recording_api_client.queue_post_response(
        ProjectApiPaths.LOAD_PATH,
        {"project": {"path": project_path, "loaded": True}},
    )

    result = project_client.load_project({"path": project_path})

    assert isinstance(result, ProjectSnapshot)
    assert result.path == project_path
    assert result.loaded is True
    assert recording_api_client.post_requests == [
        (ProjectApiPaths.LOAD_PATH, {"path": project_path})
    ]


def test_project_api_client_get_project_snapshot_returns_snapshot(
    recording_api_client: RecordingApiClient,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ProjectApiPaths.SNAPSHOT_PATH,
        {"project": {"path": "", "loaded": False}},
    )

    result = project_client.get_project_snapshot()

    assert isinstance(result, ProjectSnapshot)
    assert result.loaded is False
    assert recording_api_client.post_requests == [(ProjectApiPaths.SNAPSHOT_PATH, {})]


def test_project_api_client_unload_project_returns_empty_snapshot(
    recording_api_client: RecordingApiClient,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ProjectApiPaths.UNLOAD_PATH,
        {"project": {"path": "", "loaded": False}},
    )

    result = project_client.unload_project()

    assert isinstance(result, ProjectSnapshot)
    assert result.loaded is False
    assert result.path == ""
    assert recording_api_client.post_requests == [(ProjectApiPaths.UNLOAD_PATH, {})]


def test_project_api_client_collects_source_files(
    recording_api_client: RecordingApiClient,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        ProjectApiPaths.SOURCE_FILES_PATH,
        {"source_files": ["demo/input"]},
    )

    result = project_client.collect_source_files(["demo/input"])

    assert result == ["demo/input"]
    assert recording_api_client.post_requests == [
        (ProjectApiPaths.SOURCE_FILES_PATH, {"source_paths": ["demo/input"]})
    ]


def test_project_api_client_get_project_preview_returns_preview(
    recording_api_client: RecordingApiClient,
) -> None:
    project_client = ProjectApiClient(recording_api_client)
    project_path = "demo/project.lg"
    recording_api_client.queue_post_response(
        ProjectApiPaths.PREVIEW_PATH,
        {
            "preview": {
                "path": project_path,
                "source_language": "JA",
                "target_language": "ZH",
                "translation_stats": {
                    "total_items": 8,
                    "completed_count": 3,
                    "failed_count": 1,
                    "pending_count": 3,
                    "skipped_count": 1,
                    "completion_percent": 50.0,
                },
            }
        },
    )

    result = project_client.get_project_preview(project_path)

    assert isinstance(result, ProjectPreview)
    assert result.path == project_path
    assert result.source_language == "JA"
    assert result.target_language == "ZH"
    assert result.translation_stats.to_dict() == {
        "total_items": 8,
        "completed_count": 3,
        "failed_count": 1,
        "pending_count": 3,
        "skipped_count": 1,
        "completion_percent": 50.0,
    }
    assert recording_api_client.post_requests == [
        (ProjectApiPaths.PREVIEW_PATH, {"path": project_path})
    ]
