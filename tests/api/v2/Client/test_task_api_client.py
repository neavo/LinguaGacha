from collections.abc import Callable

from api.v2.Application.TaskAppService import TaskAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.TaskApiClient import TaskApiClient
from api.v2.Models.Task import AnalysisGlossaryImportResult
from api.v2.Models.Task import TaskSnapshot
from api.v2.Server.Routes.TaskRoutes import TaskRoutes
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


def test_task_api_client_reset_methods_return_task_snapshot(
    fake_task_data_manager: FakeTaskDataManager,
    fake_engine: FakeEngine,
    start_api_server: Callable[..., str],
) -> None:
    fake_task_data_manager.translation_extras["error_line"] = 5
    fake_task_data_manager.analysis_snapshot["error_line"] = 4
    base_url = start_api_server(
        task_app_service=TaskAppService(
            data_manager=fake_task_data_manager,
            engine=fake_engine,
            config_loader=lambda: object(),
        )
    )
    task_client = TaskApiClient(ApiClient(base_url))

    translation_all_result = task_client.reset_translation_all()
    translation_failed_result = task_client.reset_translation_failed()
    analysis_all_result = task_client.reset_analysis_all()
    analysis_failed_result = task_client.reset_analysis_failed()

    assert isinstance(translation_all_result, TaskSnapshot)
    assert translation_all_result.task_type == "translation"
    assert isinstance(translation_failed_result, TaskSnapshot)
    assert translation_failed_result.task_type == "translation"
    assert isinstance(analysis_all_result, TaskSnapshot)
    assert analysis_all_result.task_type == "analysis"
    assert isinstance(analysis_failed_result, TaskSnapshot)
    assert analysis_failed_result.task_type == "analysis"


def test_task_api_client_import_analysis_glossary_returns_objectified_result(
    fake_task_data_manager: FakeTaskDataManager,
    fake_engine: FakeEngine,
    start_api_server: Callable[..., str],
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 9
    fake_task_data_manager.analysis_candidate_count = 6
    fake_task_data_manager.import_analysis_candidates_result = 4
    base_url = start_api_server(
        task_app_service=TaskAppService(
            data_manager=fake_task_data_manager,
            engine=fake_engine,
        )
    )
    task_client = TaskApiClient(ApiClient(base_url))

    result = task_client.import_analysis_glossary()

    assert isinstance(result, AnalysisGlossaryImportResult)
    assert result.accepted is True
    assert result.imported_count == 4
    assert result.task.task_type == "analysis"
    assert result.task.analysis_candidate_count == 6


def test_task_api_client_start_and_stop_commands_use_snapshot_contract(
    recording_api_client,
) -> None:
    task_client = TaskApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        TaskRoutes.START_TRANSLATION_PATH,
        {"task": {"task_type": "translation", "status": "TRANSLATING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskRoutes.STOP_TRANSLATION_PATH,
        {"task": {"task_type": "translation", "status": "STOPPING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskRoutes.START_ANALYSIS_PATH,
        {"task": {"task_type": "analysis", "status": "ANALYZING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskRoutes.STOP_ANALYSIS_PATH,
        {"task": {"task_type": "analysis", "status": "STOPPING", "busy": True}},
    )

    start_translation = task_client.start_translation({"mode": "NEW"})
    stop_translation = task_client.stop_translation()
    start_analysis = task_client.start_analysis({"mode": "RESET"})
    stop_analysis = task_client.stop_analysis()

    assert isinstance(start_translation, TaskSnapshot)
    assert start_translation.task_type == "translation"
    assert stop_translation.status == "STOPPING"
    assert start_analysis.task_type == "analysis"
    assert stop_analysis.status == "STOPPING"


def test_task_api_client_export_translation_returns_raw_payload(
    recording_api_client,
) -> None:
    task_client = TaskApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        TaskRoutes.EXPORT_TRANSLATION_PATH,
        {"accepted": True},
    )

    result = task_client.export_translation()

    assert result == {"accepted": True}
