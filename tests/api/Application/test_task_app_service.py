from base.Base import Base


def test_start_translation_returns_request_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.start_translation({"mode": "NEW"})

    assert result["accepted"] is True
    assert result["task"] == {
        "task_type": "translation",
        "status": "REQUEST",
        "busy": True,
        "request_in_flight_count": 0,
        "line": 0,
        "total_line": 0,
        "processed_line": 0,
        "error_line": 0,
        "total_tokens": 0,
        "total_output_tokens": 0,
        "total_input_tokens": 0,
        "time": 0.0,
        "start_time": 0.0,
    }
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.TranslationMode.NEW,
                "quality_snapshot": None,
            },
        )
    ]


def test_stop_translation_returns_stopping_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.stop_translation({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "translation"
    assert result["task"]["status"] == "STOPPING"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
    ]


def test_start_analysis_returns_request_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.start_analysis({"mode": "CONTINUE"})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["status"] == "REQUEST"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.AnalysisMode.CONTINUE,
                "quality_snapshot": None,
            },
        )
    ]


def test_stop_analysis_returns_stopping_ack_and_emits_event(
    task_app_service,
) -> None:
    result = task_app_service.stop_analysis({})

    assert result["accepted"] is True
    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["status"] == "STOPPING"
    assert result["task"]["busy"] is True
    assert task_app_service.emitted_events == [
        (
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        )
    ]


def test_get_task_snapshot_returns_translation_snapshot_fields(
    task_app_service,
    fake_engine,
    fake_task_data_manager,
) -> None:
    fake_engine.status = Base.TaskStatus.TRANSLATING
    fake_engine.request_in_flight_count = 2
    fake_task_data_manager.translation_extras["line"] = 3
    fake_task_data_manager.translation_extras["total_line"] = 9
    fake_task_data_manager.translation_extras["processed_line"] = 2
    fake_task_data_manager.translation_extras["total_tokens"] = 128

    result = task_app_service.get_task_snapshot({})

    assert result["task"]["task_type"] == "translation"
    assert result["task"]["status"] == Base.TaskStatus.TRANSLATING.value
    assert result["task"]["busy"] is True
    assert result["task"]["request_in_flight_count"] == 2
    assert result["task"]["line"] == 3
    assert result["task"]["processed_line"] == 2
    assert result["task"]["total_tokens"] == 128


def test_get_task_snapshot_prefers_engine_active_task_type(
    task_app_service,
    fake_engine,
    fake_task_data_manager,
) -> None:
    fake_engine.active_task_type = "analysis"
    fake_task_data_manager.translation_extras["line"] = 9
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_candidate_count = 2

    result = task_app_service.get_task_snapshot({})

    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["line"] == 4
    assert result["task"]["analysis_candidate_count"] == 2


def test_get_task_snapshot_supports_requested_task_type(
    task_app_service,
    fake_task_data_manager,
) -> None:
    fake_task_data_manager.analysis_snapshot["line"] = 4
    fake_task_data_manager.analysis_candidate_count = 2

    result = task_app_service.get_task_snapshot({"task_type": "analysis"})

    assert result["task"]["task_type"] == "analysis"
    assert result["task"]["analysis_candidate_count"] == 2


def test_export_translation_emits_export_event_and_returns_accept_ack(
    task_app_service,
) -> None:
    result = task_app_service.export_translation({})

    assert result == {"accepted": True}
    assert task_app_service.emitted_events == [
        (
            Base.Event.TRANSLATION_EXPORT,
            {"sub_event": Base.SubEvent.REQUEST},
        )
    ]


def test_translate_single_returns_translated_text(
    task_app_service,
    fake_engine,
) -> None:
    fake_engine.translate_single_dst = "【爱丽丝】"

    result = task_app_service.translate_single({"text": "【Alice】\nHello"})

    assert result == {
        "success": True,
        "status": "OK",
        "dst": "【爱丽丝】",
    }
    assert fake_engine.translate_single_calls[0].get_src() == "【Alice】\nHello"


def test_translate_single_returns_no_active_model(
    task_app_service,
    fake_settings_config,
) -> None:
    fake_settings_config.activate_model_id = ""

    result = task_app_service.translate_single({"text": "【Alice】\nHello"})

    assert result == {
        "success": False,
        "status": "NO_ACTIVE_MODEL",
        "dst": "",
    }


def test_translate_single_returns_failed_status(
    task_app_service,
    fake_engine,
) -> None:
    fake_engine.translate_single_success = False
    fake_engine.translate_single_dst = ""

    result = task_app_service.translate_single({"text": "【Alice】\nHello"})

    assert result == {
        "success": False,
        "status": "TRANSLATION_FAILED",
        "dst": "",
    }


def test_translate_single_rejects_empty_text(task_app_service) -> None:
    try:
        task_app_service.translate_single({"text": " "})
    except ValueError as e:
        assert str(e) == "待翻译文本不能为空。"
    else:
        raise AssertionError("empty text should raise ValueError")
