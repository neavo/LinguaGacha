from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import module.Engine.ModelApiTestRunner as runner_module
from base.Base import Base
from module.Engine.ModelApiTestRunner import ModelApiTestRunner
from module.Engine.TaskRequestErrors import RequestHardTimeoutError


class FakeConfig:
    request_timeout: int = 12

    def load(self) -> "FakeConfig":
        return self


class FakeTaskRequester:
    responses: list[tuple[Exception | None, str, str, int, int]] = []
    reset_calls: int = 0
    created_models: list[dict[str, object]] = []
    request_messages: list[list[dict[str, str]]] = []

    def __init__(self, config: FakeConfig, model: dict[str, object]) -> None:
        del config
        type(self).created_models.append(model)

    @classmethod
    def reset(cls) -> None:
        cls.reset_calls += 1

    def request(
        self,
        messages: list[dict[str, str]],
    ) -> tuple[Exception | None, str, str, int, int]:
        type(self).request_messages.append(messages)
        return type(self).responses.pop(0)


class FakeLogManager:
    def __init__(self) -> None:
        self.print_messages: list[str] = []
        self.info_messages: list[str] = []
        self.warning_messages: list[tuple[str, Exception | BaseException | None]] = []

    def print(self, msg: str = "") -> None:
        self.print_messages.append(msg)

    def info(self, msg: str, e: Exception | BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def warning(self, msg: str, e: Exception | BaseException | None = None) -> None:
        self.warning_messages.append((msg, e))


def build_localizer() -> Any:
    return SimpleNamespace(
        api_test_key="密钥：",
        api_test_messages="提示词：",
        api_test_timeout="超时 {SECONDS}",
        log_api_test_fail="失败 {REASON}",
        engine_task_response_result="回复",
        engine_task_response_think="思考",
        api_test_token_info="token {INPUT} {OUTPUT} {TIME}",
        api_test_result="总数 {COUNT} 成功 {SUCCESS} 失败 {FAILURE}",
        api_test_result_failure="失败密钥",
    )


@pytest.fixture
def fake_logger(monkeypatch: pytest.MonkeyPatch) -> FakeLogManager:
    logger = FakeLogManager()
    monkeypatch.setattr(runner_module, "Config", FakeConfig)
    monkeypatch.setattr(runner_module, "TaskRequester", FakeTaskRequester)
    monkeypatch.setattr(
        runner_module.LogManager,
        "get",
        staticmethod(lambda: logger),
    )
    monkeypatch.setattr(
        runner_module.Localizer,
        "get",
        staticmethod(build_localizer),
    )
    FakeTaskRequester.responses = []
    FakeTaskRequester.reset_calls = 0
    FakeTaskRequester.created_models = []
    FakeTaskRequester.request_messages = []
    return logger


def test_model_api_test_runner_reports_mixed_results_and_console_logs(
    monkeypatch: pytest.MonkeyPatch,
    fake_logger: FakeLogManager,
) -> None:
    FakeTaskRequester.responses = [
        (ValueError("bad"), "", "", 0, 0),
        (None, "", "ok1", 11, 7),
        (None, "thinking", "ok2", 3, 5),
    ]
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
    monkeypatch.setattr(runner_module.time, "perf_counter_ns", lambda: next(ticks))

    summary = ModelApiTestRunner().run(
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k1\nabcdefghijklmnopqrstuvwx\nk3",
        }
    )

    assert FakeTaskRequester.reset_calls == 1
    assert [model["api_key"] for model in FakeTaskRequester.created_models] == [
        "k1",
        "abcdefghijklmnopqrstuvwx",
        "k3",
    ]
    assert summary.success is False
    assert summary.total_count == 3
    assert summary.success_count == 2
    assert summary.failure_count == 1
    assert summary.total_response_time_ms == 3000
    assert summary.key_results[0].error_reason == "ValueError: bad"
    assert summary.key_results[1].masked_key == "abcdefgh********qrstuvwx"
    assert any("密钥：\nk1" == msg for msg in fake_logger.info_messages)
    assert any("提示词：" in msg for msg in fake_logger.info_messages)
    assert any("回复\nok1" == msg for msg in fake_logger.info_messages)
    assert any("思考\nthinking" == msg for msg in fake_logger.info_messages)
    assert any("回复\nok2" == msg for msg in fake_logger.info_messages)
    assert "token 11 7 1.00" in fake_logger.info_messages
    assert "总数 3 成功 2 失败 1" in fake_logger.info_messages
    assert fake_logger.warning_messages[0][0] == "失败 ValueError: bad"
    assert isinstance(fake_logger.warning_messages[0][1], ValueError)
    assert fake_logger.warning_messages[-1] == ("失败密钥\nk1", None)


def test_model_api_test_runner_uses_placeholder_key_and_sakura_prompt(
    monkeypatch: pytest.MonkeyPatch,
    fake_logger: FakeLogManager,
) -> None:
    FakeTaskRequester.responses = [
        (RequestHardTimeoutError("timeout"), "", "", 0, 0),
    ]
    ticks = iter([1_000_000_000, 1_500_000_000])
    monkeypatch.setattr(runner_module.time, "perf_counter_ns", lambda: next(ticks))

    summary = ModelApiTestRunner().run(
        {
            "api_format": Base.APIFormat.SAKURALLM,
            "api_key": "",
        }
    )

    assert FakeTaskRequester.created_models[0]["api_key"] == "no_key_required"
    assert FakeTaskRequester.request_messages[0][0]["content"].startswith(
        "你是一个轻小说翻译模型"
    )
    assert summary.success is False
    assert summary.total_count == 1
    assert summary.total_response_time_ms == 500
    assert summary.key_results[0].masked_key == "no_key_required"
    assert summary.key_results[0].error_reason == "超时 12"
    assert any("密钥：\nno_key_required" == msg for msg in fake_logger.info_messages)
