from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any

import pytest

import module.Engine.APITest.APITest as api_test_module
from base.Base import Base
from module.Engine.APITest.APITest import APITest
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError


class EventRecorder:
    def __init__(self) -> None:
        self.events: list[tuple[Base.Event, dict[str, Any]]] = []

    def emit(self, event: Base.Event, payload: dict[str, Any]) -> bool:
        self.events.append((event, payload))
        return True


class FakeLogManager:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.error_messages: list[str] = []

    def print(self, msg: str = "") -> None:
        del msg

    def info(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def warning(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.warning_messages.append(msg)

    def error(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.error_messages.append(msg)


class FakeThread:
    def __init__(self, target: Any, args: tuple[Any, ...]) -> None:
        self.target = target
        self.args = args

    def start(self) -> None:
        self.target(*self.args)


class StartFailThread:
    def __init__(self, target: Any, args: tuple[Any, ...]) -> None:
        self.target = target
        self.args = args

    def start(self) -> None:
        raise RuntimeError("boom")


class FakeTaskRequester:
    responses: list[tuple[Any, str, str, int, int]] = []
    reset_calls: int = 0
    created_models: list[dict[str, Any]] = []

    def __init__(self, config: Any, model: dict[str, Any]) -> None:
        del config
        self.model = model
        type(self).created_models.append(self.model)

    @staticmethod
    def reset() -> None:
        FakeTaskRequester.reset_calls += 1

    def request(self, messages: list[dict[str, str]]) -> tuple[Any, str, str, int, int]:
        del messages
        return type(self).responses.pop(0)


def build_localizer() -> Any:
    return SimpleNamespace(
        task_running="running",
        task_failed="task_failed",
        api_test_key="api_key",
        api_test_messages="messages",
        api_test_timeout="timeout {SECONDS}",
        log_api_test_fail="fail {REASON}",
        engine_task_response_result="result",
        engine_task_response_think="think",
        api_test_token_info="input {INPUT} output {OUTPUT} time {TIME}",
        api_test_result="total {COUNT} success {SUCCESS} failure {FAILURE}",
        api_test_result_failure="failed keys",
    )


def create_api_test() -> tuple[APITest, EventRecorder]:
    api_test = APITest()
    recorder = EventRecorder()
    api_test.emit = recorder.emit  # type: ignore[method-assign]
    return api_test, recorder


def test_mask_api_key_keeps_short_key() -> None:
    api_test, _ = create_api_test()

    assert api_test.mask_api_key(" short_key ") == "short_key"


def test_mask_api_key_masks_middle_for_long_key() -> None:
    api_test, _ = create_api_test()

    masked = api_test.mask_api_key("abcdefghijklmnopqrstuvwxyz")

    assert masked.startswith("abcdefgh")
    assert masked.endswith("stuvwxyz")
    assert set(masked[8:-8]) == {"*"}
    assert len(masked) == 26


def test_api_test_start_ignores_non_request_sub_event() -> None:
    api_test, recorder = create_api_test()

    api_test.api_test_start(
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.DONE},
    )

    assert recorder.events == []


def test_api_test_start_emits_warning_when_engine_busy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    engine = SimpleNamespace(lock=threading.Lock(), status=Base.TaskStatus.TESTING)
    monkeypatch.setattr(api_test_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        api_test_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_running="running")),
    )

    api_test.api_test_start(
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.REQUEST, "model_id": "m1"},
    )

    assert recorder.events == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.WARNING,
                "message": "running",
            },
        )
    ]


def test_api_test_start_emits_run_then_error_when_thread_start_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    engine = SimpleNamespace(
        lock=threading.Lock(),
        status=Base.TaskStatus.IDLE,
        set_status=lambda status: setattr(engine, "status", status),
    )
    log_manager = FakeLogManager()
    monkeypatch.setattr(api_test_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        api_test_module.Localizer,
        "get",
        staticmethod(build_localizer),
    )
    monkeypatch.setattr(
        api_test_module.LogManager,
        "get",
        staticmethod(lambda: log_manager),
    )
    monkeypatch.setattr(api_test_module.threading, "Thread", StartFailThread)

    api_test.api_test_start(
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.REQUEST, "model_id": "m1"},
    )

    assert engine.status == Base.TaskStatus.IDLE
    assert recorder.events == [
        (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.RUN,
                "model_id": "m1",
            },
        ),
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "task_failed",
            },
        ),
        (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.ERROR,
                "result": False,
                "result_msg": "task_failed",
            },
        ),
    ]
    assert log_manager.error_messages == ["task_failed"]


def test_api_test_start_target_always_resets_engine_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, _ = create_api_test()
    engine = SimpleNamespace(
        set_status=lambda status: setattr(engine, "last_status", status),
        last_status=None,
    )
    monkeypatch.setattr(api_test_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        api_test,
        "api_test_start_target_inner",
        lambda event, data: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    with pytest.raises(RuntimeError, match="boom"):
        api_test.api_test_start_target(Base.Event.APITEST, {})

    assert engine.last_status == Base.TaskStatus.IDLE


def test_api_test_start_target_inner_emits_done_when_model_id_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    fake_config = SimpleNamespace(get_model=lambda model_id: None)
    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)

    api_test.api_test_start_target_inner(Base.Event.APITEST, {})

    assert recorder.events == [
        (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.DONE,
                "result": False,
                "result_msg": "Missing model_id",
            },
        )
    ]


def test_api_test_start_target_inner_emits_done_when_model_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    fake_config = SimpleNamespace(get_model=lambda model_id: None)
    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)

    api_test.api_test_start_target_inner(
        Base.Event.APITEST,
        {"model_id": "missing"},
    )

    assert recorder.events == [
        (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.DONE,
                "result": False,
                "result_msg": "Model not found",
            },
        )
    ]


def test_api_test_start_target_inner_uses_placeholder_key_for_empty_sakura_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    log_manager = FakeLogManager()
    fake_model = {
        "api_format": Base.APIFormat.SAKURALLM,
        "api_key": "",
    }
    fake_config = SimpleNamespace(
        request_timeout=12,
        get_model=lambda model_id: fake_model,
    )
    FakeTaskRequester.responses = [
        (RequestHardTimeoutError("timeout"), "", "", 0, 0),
    ]
    FakeTaskRequester.reset_calls = 0
    FakeTaskRequester.created_models = []
    ticks = iter([1_000_000_000, 1_500_000_000])

    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(api_test_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        api_test_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(api_test_module.Localizer, "get", staticmethod(build_localizer))
    monkeypatch.setattr(api_test_module.time, "perf_counter_ns", lambda: next(ticks))

    api_test.api_test_start_target_inner(
        Base.Event.APITEST,
        {"model_id": "sakura"},
    )

    assert FakeTaskRequester.reset_calls == 1
    assert FakeTaskRequester.created_models[0]["api_key"] == "no_key_required"
    assert recorder.events[-1] == (
        Base.Event.APITEST,
        {
            "sub_event": Base.SubEvent.DONE,
            "result": False,
            "result_msg": "total 1 success 0 failure 1",
            "total_count": 1,
            "success_count": 0,
            "failure_count": 1,
            "total_response_time_ms": 500,
            "key_results": [
                {
                    "masked_key": "no_key_required",
                    "success": False,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "response_time_ms": 500,
                    "error_reason": "timeout 12",
                }
            ],
        },
    )


def test_api_test_start_target_inner_reports_mixed_openai_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    log_manager = FakeLogManager()
    fake_model = {
        "api_format": Base.APIFormat.OPENAI,
        "api_key": "k1\nk2\nk3",
    }
    fake_config = SimpleNamespace(
        request_timeout=30,
        get_model=lambda model_id: fake_model,
    )
    FakeTaskRequester.responses = [
        (ValueError("bad"), "", "", 0, 0),
        (None, "", "ok1", 11, 7),
        (None, "thinking", "ok2", 3, 5),
    ]
    FakeTaskRequester.reset_calls = 0
    FakeTaskRequester.created_models = []
    ticks = iter(
        [
            1_000_000_000,
            2_000_000_000,
            3_000_000_000,
            4_000_000_000,
            5_000_000_000,
            6_000_000_000,
        ]
    )

    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(api_test_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        api_test_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(api_test_module.Localizer, "get", staticmethod(build_localizer))
    monkeypatch.setattr(api_test_module.time, "perf_counter_ns", lambda: next(ticks))

    api_test.api_test_start_target_inner(
        Base.Event.APITEST,
        {"model_id": "openai"},
    )

    _, payload = recorder.events[-1]
    assert payload["sub_event"] == Base.SubEvent.DONE
    assert payload["total_count"] == 3
    assert payload["success_count"] == 2
    assert payload["failure_count"] == 1
    assert payload["result"] is False
    assert payload["key_results"][0]["error_reason"] == "ValueError: bad"
    assert any("failed keys" in text for text in log_manager.warning_messages)


def test_api_test_start_target_inner_omits_failure_summary_when_all_keys_succeed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    log_manager = FakeLogManager()
    fake_model = {
        "api_format": Base.APIFormat.OPENAI,
        "api_key": "k1\nk2",
    }
    fake_config = SimpleNamespace(
        request_timeout=8,
        get_model=lambda model_id: fake_model,
    )
    FakeTaskRequester.responses = [
        (None, "", "ok1", 1, 2),
        (None, "", "ok2", 3, 4),
    ]
    FakeTaskRequester.reset_calls = 0
    FakeTaskRequester.created_models = []
    ticks = iter([1, 1000, 2000, 3000])

    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(api_test_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        api_test_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(api_test_module.Localizer, "get", staticmethod(build_localizer))
    monkeypatch.setattr(api_test_module.time, "perf_counter_ns", lambda: next(ticks))

    api_test.api_test_start_target_inner(
        Base.Event.APITEST,
        {"model_id": "all_success"},
    )

    _, payload = recorder.events[-1]
    assert payload["result"] is True
    assert payload["failure_count"] == 0
    assert all("failed keys" not in msg for msg in log_manager.warning_messages)


def test_api_test_start_runs_target_in_thread_and_restores_engine_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_test, recorder = create_api_test()
    engine = SimpleNamespace(
        lock=threading.Lock(),
        status=Base.TaskStatus.IDLE,
        set_status=lambda status: setattr(engine, "status", status),
    )
    fake_config = SimpleNamespace(get_model=lambda model_id: None)
    monkeypatch.setattr(api_test_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(api_test_module.threading, "Thread", FakeThread)
    monkeypatch.setattr(api_test_module.Config, "load", lambda self: fake_config)

    api_test.api_test_start(
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.REQUEST, "model_id": "missing"},
    )

    assert engine.status == Base.TaskStatus.IDLE
    assert recorder.events[0] == (
        Base.Event.APITEST,
        {
            "sub_event": Base.SubEvent.RUN,
            "model_id": "missing",
        },
    )
    assert recorder.events[-1] == (
        Base.Event.APITEST,
        {
            "sub_event": Base.SubEvent.DONE,
            "result": False,
            "result_msg": "Model not found",
        },
    )
