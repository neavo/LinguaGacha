from api.Client.TaskApiClient import TaskApiClient
from api.Contract.ApiPaths import TaskApiPaths
from api.Models.Task import TaskSnapshot


def test_task_api_client_get_task_snapshot_supports_requested_task_type(
    recording_api_client,
) -> None:
    task_client = TaskApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        TaskApiPaths.SNAPSHOT_PATH,
        {"task": {"task_type": "analysis", "analysis_candidate_count": 3}},
    )

    result = task_client.get_task_snapshot({"task_type": "analysis"})

    assert isinstance(result, TaskSnapshot)
    assert result.task_type == "analysis"
    assert result.analysis_candidate_count == 3
    assert recording_api_client.post_requests == [
        (TaskApiPaths.SNAPSHOT_PATH, {"task_type": "analysis"})
    ]


def test_task_api_client_start_and_stop_commands_use_snapshot_contract(
    recording_api_client,
) -> None:
    task_client = TaskApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        TaskApiPaths.START_TRANSLATION_PATH,
        {"task": {"task_type": "translation", "status": "TRANSLATING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskApiPaths.STOP_TRANSLATION_PATH,
        {"task": {"task_type": "translation", "status": "STOPPING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskApiPaths.START_ANALYSIS_PATH,
        {"task": {"task_type": "analysis", "status": "ANALYZING", "busy": True}},
    )
    recording_api_client.queue_post_response(
        TaskApiPaths.START_RETRANSLATE_PATH,
        {
            "task": {
                "task_type": "retranslate",
                "status": "REQUEST",
                "busy": True,
                "retranslating_item_ids": [1, 2],
            }
        },
    )
    recording_api_client.queue_post_response(
        TaskApiPaths.STOP_ANALYSIS_PATH,
        {"task": {"task_type": "analysis", "status": "STOPPING", "busy": True}},
    )

    start_translation = task_client.start_translation({"mode": "NEW"})
    stop_translation = task_client.stop_translation()
    start_analysis = task_client.start_analysis({"mode": "RESET"})
    start_retranslate = task_client.start_retranslate({"item_ids": [1, 2]})
    stop_analysis = task_client.stop_analysis()

    assert isinstance(start_translation, TaskSnapshot)
    assert start_translation.task_type == "translation"
    assert stop_translation.status == "STOPPING"
    assert start_analysis.task_type == "analysis"
    assert start_retranslate.retranslating_item_ids == (1, 2)
    assert stop_analysis.status == "STOPPING"
    assert recording_api_client.post_requests == [
        (TaskApiPaths.START_TRANSLATION_PATH, {"mode": "NEW"}),
        (TaskApiPaths.STOP_TRANSLATION_PATH, {}),
        (TaskApiPaths.START_ANALYSIS_PATH, {"mode": "RESET"}),
        (TaskApiPaths.START_RETRANSLATE_PATH, {"item_ids": [1, 2]}),
        (TaskApiPaths.STOP_ANALYSIS_PATH, {}),
    ]


def test_task_api_client_export_translation_returns_raw_payload(
    recording_api_client,
) -> None:
    task_client = TaskApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        TaskApiPaths.EXPORT_TRANSLATION_PATH,
        {"accepted": True},
    )

    result = task_client.export_translation()

    assert result == {"accepted": True}
