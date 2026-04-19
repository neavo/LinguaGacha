from collections.abc import Callable

from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Client.ApiClient import ApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Models.Workbench import WorkbenchSnapshot
from api.Server.Routes.WorkbenchRoutes import WorkbenchRoutes
from tests.api.support.application_fakes import FakeWorkbenchManager
import pytest


def test_workbench_api_client_get_snapshot_returns_snapshot(
    fake_workbench_manager: FakeWorkbenchManager,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        workbench_app_service=WorkbenchAppService(fake_workbench_manager)
    )
    workbench_client = WorkbenchApiClient(ApiClient(base_url))

    result = workbench_client.get_snapshot()

    assert isinstance(result, WorkbenchSnapshot)
    assert result.error_count == 0
    assert result.entries[0].rel_path == "script/a.txt"


def test_workbench_api_client_reorder_files_forwards_payload(
    fake_workbench_manager: FakeWorkbenchManager,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        workbench_app_service=WorkbenchAppService(fake_workbench_manager)
    )
    workbench_client = WorkbenchApiClient(ApiClient(base_url))

    result = workbench_client.reorder_files(["script/b.txt", "script/a.txt"])

    assert result["accepted"] is True
    assert fake_workbench_manager.reorder_calls == [["script/b.txt", "script/a.txt"]]


@pytest.mark.parametrize(
    ("method_name", "kwargs", "expected_request", "expected_response"),
    [
        (
            "add_file",
            {"path": "script/c.txt"},
            (WorkbenchRoutes.ADD_FILE_PATH, {"path": "script/c.txt"}),
            {"accepted": True},
        ),
        (
            "replace_file",
            {"rel_path": "script/a.txt", "path": "demo/a.txt"},
            (
                WorkbenchRoutes.REPLACE_FILE_PATH,
                {"rel_path": "script/a.txt", "path": "demo/a.txt"},
            ),
            {"accepted": True},
        ),
        (
            "replace_file_batch",
            {"operations": [{"rel_path": "script/a.txt", "path": "demo/a.txt"}]},
            (
                WorkbenchRoutes.REPLACE_FILE_BATCH_PATH,
                {"operations": [{"rel_path": "script/a.txt", "path": "demo/a.txt"}]},
            ),
            {"accepted": True},
        ),
        (
            "reset_file",
            {"rel_path": "script/a.txt"},
            (WorkbenchRoutes.RESET_FILE_PATH, {"rel_path": "script/a.txt"}),
            {"accepted": True},
        ),
        (
            "reset_file_batch",
            {"rel_paths": ["script/a.txt"]},
            (WorkbenchRoutes.RESET_FILE_BATCH_PATH, {"rel_paths": ["script/a.txt"]}),
            {"accepted": True},
        ),
        (
            "delete_file",
            {"rel_path": "script/a.txt"},
            (WorkbenchRoutes.DELETE_FILE_PATH, {"rel_path": "script/a.txt"}),
            {"accepted": True},
        ),
        (
            "delete_file_batch",
            {"rel_paths": ["script/a.txt"]},
            (WorkbenchRoutes.DELETE_FILE_BATCH_PATH, {"rel_paths": ["script/a.txt"]}),
            {"accepted": True},
        ),
    ],
)
def test_workbench_api_client_forwards_mutation_payloads(
    recording_api_client,
    method_name: str,
    kwargs: dict[str, object],
    expected_request: tuple[str, dict[str, object]],
    expected_response: dict[str, object],
) -> None:
    workbench_client = WorkbenchApiClient(recording_api_client)
    recording_api_client.queue_post_response(expected_request[0], expected_response)

    result = getattr(workbench_client, method_name)(**kwargs)

    assert recording_api_client.post_requests[-1] == expected_request
    assert result == expected_response


def test_workbench_api_client_reads_file_patch_payload(recording_api_client) -> None:
    workbench_client = WorkbenchApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        WorkbenchRoutes.FILE_PATCH_PATH,
        {"entries": [{"rel_path": "script/a.txt"}], "order_changed": True},
    )

    result = workbench_client.get_file_patch(
        rel_paths=["script/a.txt"],
        removed_rel_paths=["script/b.txt"],
        include_order=True,
    )

    assert recording_api_client.post_requests[-1] == (
        WorkbenchRoutes.FILE_PATCH_PATH,
        {
            "rel_paths": ["script/a.txt"],
            "removed_rel_paths": ["script/b.txt"],
            "include_order": True,
        },
    )
    assert result == {
        "entries": [{"rel_path": "script/a.txt"}],
        "order_changed": True,
    }


def test_workbench_api_client_reads_supported_extensions(recording_api_client) -> None:
    workbench_client = WorkbenchApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        WorkbenchRoutes.EXTENSIONS_PATH,
        {"extensions": [".txt", 1]},
    )

    result = workbench_client.get_supported_extensions()

    assert result == [".txt", "1"]
