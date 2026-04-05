from collections.abc import Callable

from api.Application.WorkbenchAppService import WorkbenchAppService
from api.Client.ApiClient import ApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from model.Api.WorkbenchModels import WorkbenchSnapshot
from tests.api.support.application_fakes import FakeWorkbenchManager


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
