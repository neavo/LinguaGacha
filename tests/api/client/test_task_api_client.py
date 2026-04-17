from collections.abc import Callable

from api.Application.TaskAppService import TaskAppService
from api.Client.ApiClient import ApiClient
from api.Client.TaskApiClient import TaskApiClient
from model.Api.TaskModels import TaskSnapshot
from tests.api.support.application_fakes import FakeEngine
from tests.api.support.application_fakes import FakeTaskDataManager


def test_task_api_client_get_task_snapshot_supports_requested_task_type(
    fake_task_data_manager: FakeTaskDataManager,
    fake_engine: FakeEngine,
    start_api_server: Callable[..., str],
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 6
    fake_task_data_manager.analysis_candidate_count = 3
    base_url = start_api_server(
        task_app_service=TaskAppService(
            data_manager=fake_task_data_manager,
            engine=fake_engine,
        )
    )
    task_client = TaskApiClient(ApiClient(base_url))

    result = task_client.get_task_snapshot({"task_type": "analysis"})

    assert isinstance(result, TaskSnapshot)
    assert result.task_type == "analysis"
    assert result.analysis_candidate_count == 3
