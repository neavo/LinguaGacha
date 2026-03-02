from __future__ import annotations

import threading
from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

import pytest

from base.Base import Base
import module.Engine.APITester.APITester as apitester_module
from module.Engine.APITester.APITester import APITester
from module.Engine.TaskRequesterErrors import RequestHardTimeoutError


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


def build_localizer() -> Any:
    return SimpleNamespace(
        task_running="running",
        task_failed="task_failed",
        api_tester_key="api_key",
        api_tester_messages="messages",
        api_tester_timeout="timeout {SECONDS}",
        log_api_test_fail="fail {REASON}",
        engine_response_result="result",
        engine_response_think="think",
        api_tester_token_info="input {INPUT} output {OUTPUT} time {TIME}",
        api_tester_result="total {COUNT} success {SUCCESS} failure {FAILURE}",
        api_tester_result_failure="failed keys",
    )


class FakeTaskRequester:
    responses: list[tuple[Any, str, str, int, int]] = []
    reset_calls: int = 0
    created_models: list[dict[str, Any]] = []

    def __init__(self, config: Any, model: dict[str, Any]) -> None:
        del config
        self.model = model
        FakeTaskRequester.created_models.append(model)

    @staticmethod
    def reset() -> None:
        FakeTaskRequester.reset_calls += 1

    def request(self, messages: list[dict[str, str]]) -> tuple[Any, str, str, int, int]:
        del messages
        return FakeTaskRequester.responses.pop(0)


def create_api_tester_stub() -> Any:
    api_tester = cast(Any, APITester.__new__(APITester))
    api_tester.emit = MagicMock()
    return api_tester


def test_init_subscribes_apitest_event(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Base.Event, Any]] = []

    def fake_subscribe(self: APITester, event: Base.Event, handler: Any) -> None:
        del self
        calls.append((event, handler))

    monkeypatch.setattr(APITester, "subscribe", fake_subscribe, raising=False)

    api_tester = APITester()

    assert calls[0][0] == Base.Event.APITEST
    assert calls[0][1].__name__ == "api_test_start"
    assert calls[0][1].__self__ is api_tester


def test_mask_api_key_keeps_short_key() -> None:
    api_tester = create_api_tester_stub()

    assert APITester.mask_api_key(api_tester, " short_key ") == "short_key"


def test_mask_api_key_masks_middle_for_long_key() -> None:
    api_tester = create_api_tester_stub()
    key = "abcdefghijklmnopqrstuvwxyz"

    masked = APITester.mask_api_key(api_tester, key)

    assert masked.startswith("abcdefgh")
    assert masked.endswith("stuvwxyz")
    assert set(masked[8:-8]) == {"*"}
    assert len(masked) == len(key)


def test_api_test_start_target_always_resets_engine_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
    api_tester.api_test_start_target_inner = MagicMock(side_effect=RuntimeError("boom"))
    engine = SimpleNamespace(set_status=MagicMock())
    monkeypatch.setattr(apitester_module.Engine, "get", staticmethod(lambda: engine))

    with pytest.raises(RuntimeError, match="boom"):
        APITester.api_test_start_target(api_tester, Base.Event.APITEST, {})

    engine.set_status.assert_called_once_with(Base.TaskStatus.IDLE)


def test_api_test_start_emits_warning_when_engine_busy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
    engine = SimpleNamespace(
        lock=SimpleNamespace(
            __enter__=lambda s: None, __exit__=lambda s, t, v, tb: False
        ),
        status=Base.TaskStatus.TESTING,
    )
    # 使用真实锁对象避免上下文管理协议差异。
    import threading

    engine.lock = threading.Lock()
    monkeypatch.setattr(apitester_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        apitester_module.Localizer,
        "get",
        staticmethod(lambda: SimpleNamespace(task_running="running")),
    )

    APITester.api_test_start(
        api_tester,
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.REQUEST, "model_id": "m1"},
    )

    api_tester.emit.assert_called_once_with(
        Base.Event.TOAST,
        {
            "type": Base.ToastType.WARNING,
            "message": "running",
        },
    )


def test_api_test_start_sets_testing_and_emits_error_when_thread_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
    engine = SimpleNamespace(
        lock=threading.Lock(),
        status=Base.TaskStatus.IDLE,
        set_status=MagicMock(),
    )
    log_manager = FakeLogManager()

    class FakeThread:
        def __init__(self, target: Any, args: tuple[Any, ...]) -> None:
            self.target = target
            self.args = args

        def start(self) -> None:
            raise RuntimeError("boom")

    monkeypatch.setattr(apitester_module.Engine, "get", staticmethod(lambda: engine))
    monkeypatch.setattr(
        apitester_module.Localizer,
        "get",
        staticmethod(build_localizer),
    )
    monkeypatch.setattr(
        apitester_module.LogManager,
        "get",
        staticmethod(lambda: log_manager),
    )
    monkeypatch.setattr(apitester_module.threading, "Thread", FakeThread)

    APITester.api_test_start(
        api_tester,
        Base.Event.APITEST,
        {"sub_event": Base.SubEvent.REQUEST, "model_id": "m1"},
    )

    assert engine.status == Base.TaskStatus.TESTING
    engine.set_status.assert_called_once_with(Base.TaskStatus.IDLE)
    assert any(
        call.args
        == (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.RUN,
                "model_id": "m1",
            },
        )
        for call in api_tester.emit.call_args_list
    )
    assert any(
        call.args
        == (
            Base.Event.APITEST,
            {
                "sub_event": Base.SubEvent.ERROR,
                "result": False,
                "result_msg": "task_failed",
            },
        )
        for call in api_tester.emit.call_args_list
    )
    assert log_manager.error_messages == ["task_failed"]


def test_api_test_start_target_inner_emits_done_when_model_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
    fake_config = SimpleNamespace(get_model=lambda model_id: None)
    monkeypatch.setattr(apitester_module.Config, "load", lambda self: fake_config)

    APITester.api_test_start_target_inner(
        api_tester,
        Base.Event.APITEST,
        {"model_id": "missing"},
    )

    api_tester.emit.assert_called_once_with(
        Base.Event.APITEST,
        {
            "sub_event": Base.SubEvent.DONE,
            "result": False,
            "result_msg": "Model not found",
        },
    )


def test_api_test_start_target_inner_sakura_timeout_for_empty_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
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

    monkeypatch.setattr(apitester_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(apitester_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        apitester_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(
        apitester_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(apitester_module.time, "perf_counter_ns", lambda: next(ticks))

    APITester.api_test_start_target_inner(
        api_tester,
        Base.Event.APITEST,
        {"model_id": "sakura"},
    )

    assert FakeTaskRequester.reset_calls == 1
    assert FakeTaskRequester.created_models[0]["api_key"] == "no_key_required"
    payload = api_tester.emit.call_args.args[1]
    assert payload["sub_event"] == Base.SubEvent.DONE
    assert payload["result"] is False
    assert payload["failure_count"] == 1
    assert payload["key_results"][0]["error_reason"] == "timeout 12"


def test_api_test_start_target_inner_openai_mixed_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
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

    monkeypatch.setattr(apitester_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(apitester_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        apitester_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(
        apitester_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(apitester_module.time, "perf_counter_ns", lambda: next(ticks))

    APITester.api_test_start_target_inner(
        api_tester,
        Base.Event.APITEST,
        {"model_id": "openai"},
    )

    payload = api_tester.emit.call_args.args[1]
    assert payload["sub_event"] == Base.SubEvent.DONE
    assert payload["total_count"] == 3
    assert payload["success_count"] == 2
    assert payload["failure_count"] == 1
    assert payload["result"] is False
    assert payload["key_results"][0]["error_reason"] == "ValueError: bad"
    assert any("failed keys" in text for text in log_manager.warning_messages)


def test_api_test_start_target_inner_all_success_without_failure_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api_tester = create_api_tester_stub()
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

    monkeypatch.setattr(apitester_module.Config, "load", lambda self: fake_config)
    monkeypatch.setattr(apitester_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        apitester_module.LogManager, "get", staticmethod(lambda: log_manager)
    )
    monkeypatch.setattr(
        apitester_module.Localizer, "get", staticmethod(build_localizer)
    )
    monkeypatch.setattr(apitester_module.time, "perf_counter_ns", lambda: next(ticks))

    APITester.api_test_start_target_inner(
        api_tester,
        Base.Event.APITEST,
        {"model_id": "all_success"},
    )

    payload = api_tester.emit.call_args.args[1]
    assert payload["result"] is True
    assert payload["failure_count"] == 0
    assert all("failed keys" not in msg for msg in log_manager.warning_messages)
