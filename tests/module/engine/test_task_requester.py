from __future__ import annotations

import dataclasses
from contextlib import contextmanager
from typing import Any
from typing import Iterator
from typing import cast
from unittest.mock import patch

import pytest

from base.Base import Base
from model.Model import ThinkingLevel
from module.Config import Config
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRequesterErrors import RequestCancelledError
from module.Engine.TaskRequesterErrors import StreamDegradationError
from module.Engine.TaskRequesterStream import StreamSession


@dataclasses.dataclass
class FakeEngine:
    inc_calls: int = 0
    dec_calls: int = 0

    def inc_request_in_flight(self) -> None:
        self.inc_calls += 1

    def dec_request_in_flight(self) -> None:
        self.dec_calls += 1


@dataclasses.dataclass
class FakeOpenAIEvent:
    type: str
    content: Any = None


@dataclasses.dataclass
class FakeUsage:
    prompt_tokens: Any = 0
    completion_tokens: Any = 0
    input_tokens: Any = 0
    output_tokens: Any = 0
    prompt_token_count: Any = 0
    total_token_count: Any = 0


@dataclasses.dataclass
class FakeOpenAIMessage:
    content: Any = ""
    reasoning_content: Any = None


@dataclasses.dataclass
class FakeOpenAIChoice:
    message: Any


@dataclasses.dataclass
class FakeOpenAICompletion:
    choices: list[FakeOpenAIChoice]
    usage: Any = None


class FakeContext:
    def __init__(self, value: Any) -> None:
        self.value = value

    def __enter__(self) -> Any:
        return self.value

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


class FakeOpenAIStream:
    def __init__(self, events: list[Any], final_completion: Any) -> None:
        self.events = events
        self.final_completion = final_completion
        self.closed = 0

    def __iter__(self) -> Iterator[Any]:
        return iter(self.events)

    def close(self) -> None:
        self.closed += 1

    def get_final_completion(self) -> Any:
        return self.final_completion


class FakeOpenAICompletions:
    def __init__(self, stream_obj: Any) -> None:
        self.stream_obj = stream_obj
        self.calls: list[dict[str, Any]] = []

    def stream(self, **request_args: Any) -> FakeContext:
        self.calls.append(request_args)
        return FakeContext(self.stream_obj)


class FakeOpenAIChat:
    def __init__(self, stream_obj: Any) -> None:
        self.completions = FakeOpenAICompletions(stream_obj)


class FakeOpenAIClient:
    def __init__(self, stream_obj: Any) -> None:
        self.chat = FakeOpenAIChat(stream_obj)


@dataclasses.dataclass
class FakeAnthropicPart:
    text: Any = None
    thinking: Any = None


@dataclasses.dataclass
class FakeAnthropicMessage:
    content: list[Any]
    usage: Any = None


class FakeAnthropicStream:
    def __init__(self, text_stream: Any, final_message: Any) -> None:
        self.text_stream = text_stream
        self.final_message = final_message
        self.closed = 0

    def close(self) -> None:
        self.closed += 1

    def get_final_message(self) -> Any:
        return self.final_message


class FakeAnthropicMessages:
    def __init__(self, stream_obj: Any) -> None:
        self.stream_obj = stream_obj

    def stream(self, **request_args: Any) -> FakeContext:
        return FakeContext(self.stream_obj)


class FakeAnthropicClient:
    def __init__(self, stream_obj: Any) -> None:
        self.messages = FakeAnthropicMessages(stream_obj)


@dataclasses.dataclass
class FakeGooglePart:
    text: Any
    thought: bool = False


@dataclasses.dataclass
class FakeGoogleContent:
    parts: Any


@dataclasses.dataclass
class FakeGoogleCandidate:
    content: Any


@dataclasses.dataclass
class FakeGoogleChunk:
    candidates: Any = None
    usage_metadata: Any = None


class FakeGoogleModels:
    def __init__(self, chunks: list[Any]) -> None:
        self.chunks = chunks
        self.calls: list[dict[str, Any]] = []

    def generate_content_stream(self, **request_args: Any) -> Any:
        self.calls.append(request_args)
        return iter(self.chunks)


class FakeGoogleClient:
    def __init__(self, chunks: list[Any]) -> None:
        self.models = FakeGoogleModels(chunks)


def test_init_parses_api_keys_and_invalid_thinking_level_falls_back_to_off() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": " k1\n\n k2 \n ",
            "api_url": "https://example.invalid",
            "model_id": "m",
            "thinking": {"level": "NOT_A_LEVEL"},
            "request": {
                "extra_headers_custom_enable": True,
                "extra_body_custom_enable": True,
                "extra_headers": {"X": "1"},
                "extra_body": {"a": 1},
            },
        },
    )

    assert requester.api_keys == ["k1", "k2"]
    assert requester.extra_headers == {"X": "1"}
    assert requester.extra_body == {"a": 1}
    assert requester.thinking_level == ThinkingLevel.OFF


def test_reset_delegates_to_client_pool() -> None:
    with patch("module.Engine.TaskRequester.TaskRequesterClientPool.reset") as reset:
        TaskRequester.reset()
    reset.assert_called_once_with()


def test_should_use_max_completion_tokens_and_sdk_timeout() -> None:
    cfg = Config()
    cfg.request_timeout = 10

    requester = TaskRequester(
        cfg,
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://api.openai.com/v1",
            "model_id": "m",
        },
    )
    assert requester.should_use_max_completion_tokens() is True
    assert requester.get_sdk_timeout_seconds() == 15

    requester.api_url = "https://example.invalid"
    assert requester.should_use_max_completion_tokens() is False


def test_build_extra_headers_merges_default_and_extra() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
            "request": {
                "extra_headers_custom_enable": True,
                "extra_headers": {"X": "1"},
            },
        },
    )

    with patch(
        "module.Engine.TaskRequester.TaskRequesterClientPool.get_default_headers",
        return_value={"UA": "x"},
    ):
        assert requester.build_extra_headers() == {"UA": "x", "X": "1"}


def test_extract_openai_think_and_result_reasoning_content() -> None:
    msg = FakeOpenAIMessage(content="R", reasoning_content="A\n\nB")
    think, result = TaskRequester.extract_openai_think_and_result(msg)
    assert think == "A\nB"
    assert result == "R"


def test_extract_openai_think_and_result_think_tag() -> None:
    msg = FakeOpenAIMessage(content="<think> T1\n\nT2</think> OUT")
    think, result = TaskRequester.extract_openai_think_and_result(msg)
    assert think == "T1\nT2"
    assert result == "OUT"


def test_extract_openai_think_and_result_plain_text() -> None:
    msg = FakeOpenAIMessage(content="  OK  ")
    think, result = TaskRequester.extract_openai_think_and_result(msg)
    assert think == ""
    assert result == "OK"


def test_has_output_degradation_empty_and_detected() -> None:
    assert TaskRequester.has_output_degradation("") is False
    assert TaskRequester.has_output_degradation("A" * 50) is True
    assert TaskRequester.has_output_degradation("Hello") is False


def test_degradation_detector_covers_single_alternating_and_period3() -> None:
    detector = TaskRequester.DegradationDetector()
    assert detector.feed(" \n\t") is False
    assert detector.feed("A" * 49) is False
    assert detector.feed("A") is True

    detector2 = TaskRequester.DegradationDetector()
    assert detector2.feed("AB" * 60) is True

    detector3 = TaskRequester.DegradationDetector()
    assert detector3.feed("ABC" * 60) is True


def test_generate_sakura_args_uses_correct_token_key_and_stream_options() -> None:
    cfg = Config()
    requester = TaskRequester(
        cfg,
        {
            "api_format": Base.APIFormat.SAKURALLM,
            "api_key": "k",
            "api_url": "https://api.openai.com/v1",
            "model_id": "m",
            "threshold": {"output_token_limit": 10},
        },
    )

    result = requester.generate_sakura_args([], {})
    assert result["max_completion_tokens"] == 10
    assert result["stream_options"] == {"include_usage": True}

    requester.api_url = "https://example.invalid"
    result2 = requester.generate_sakura_args(
        [], {"stream_options": {"include_usage": False}}
    )
    assert result2["max_tokens"] == 10
    assert result2["stream_options"] == {"include_usage": False}


@pytest.mark.parametrize(
    "model_id,thinking_level,expected",
    [
        ("gpt-5", ThinkingLevel.OFF, {"reasoning_effort": "none"}),
        ("gpt-5", ThinkingLevel.LOW, {"reasoning_effort": "low"}),
        ("doubao-seed-2-0", ThinkingLevel.OFF, {"reasoning_effort": "minimal"}),
        ("doubao-seed-2-0", ThinkingLevel.HIGH, {"reasoning_effort": "high"}),
        ("glm-4", ThinkingLevel.OFF, {"thinking": {"type": "disabled"}}),
        ("glm-4", ThinkingLevel.MEDIUM, {"thinking": {"type": "enabled"}}),
        ("unknown", ThinkingLevel.LOW, {}),
    ],
)
def test_generate_openai_args_thinking_variants(
    model_id: str, thinking_level: ThinkingLevel, expected: dict[str, Any]
) -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": model_id,
            "thinking": {"level": thinking_level},
            "threshold": {"output_token_limit": 7},
            "request": {
                "extra_body_custom_enable": True,
                "extra_body": {"x": 1},
            },
        },
    )

    result = requester.generate_openai_args([], {})
    extra_body = result["extra_body"]
    for k, v in expected.items():
        assert extra_body[k] == v
    assert extra_body["x"] == 1


@dataclasses.dataclass
class FakeThinkingConfig:
    kwargs: dict[str, Any]


@dataclasses.dataclass
class FakeGenerateContentConfig:
    kwargs: dict[str, Any]


@pytest.mark.parametrize(
    "model_id,thinking_level,expected_kwargs",
    [
        (
            "gemini-3.1-pro",
            ThinkingLevel.OFF,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3.1-pro",
            ThinkingLevel.LOW,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3.1-pro",
            ThinkingLevel.MEDIUM,
            {"thinking_level": "MEDIUM", "include_thoughts": True},
        ),
        (
            "gemini-3.1-pro",
            ThinkingLevel.HIGH,
            {"thinking_level": "HIGH", "include_thoughts": True},
        ),
        (
            "gemini-3-pro",
            ThinkingLevel.OFF,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3-pro",
            ThinkingLevel.LOW,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3-pro",
            ThinkingLevel.MEDIUM,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3-pro",
            ThinkingLevel.HIGH,
            {"thinking_level": "HIGH", "include_thoughts": True},
        ),
        (
            "gemini-3-flash",
            ThinkingLevel.OFF,
            {"thinking_level": "MINIMAL", "include_thoughts": True},
        ),
        (
            "gemini-3-flash",
            ThinkingLevel.LOW,
            {"thinking_level": "LOW", "include_thoughts": True},
        ),
        (
            "gemini-3-flash",
            ThinkingLevel.MEDIUM,
            {"thinking_level": "MEDIUM", "include_thoughts": True},
        ),
        (
            "gemini-3-flash",
            ThinkingLevel.HIGH,
            {"thinking_level": "HIGH", "include_thoughts": True},
        ),
        (
            "gemini-2.5-pro",
            ThinkingLevel.OFF,
            {"thinking_budget": 128, "include_thoughts": True},
        ),
        (
            "gemini-2.5-pro",
            ThinkingLevel.LOW,
            {"thinking_budget": 384, "include_thoughts": True},
        ),
        (
            "gemini-2.5-pro",
            ThinkingLevel.MEDIUM,
            {"thinking_budget": 768, "include_thoughts": True},
        ),
        (
            "gemini-2.5-pro",
            ThinkingLevel.HIGH,
            {"thinking_budget": 1024, "include_thoughts": True},
        ),
        (
            "gemini-2.5-flash",
            ThinkingLevel.OFF,
            {"thinking_budget": 0, "include_thoughts": False},
        ),
        (
            "gemini-2.5-flash",
            ThinkingLevel.LOW,
            {"thinking_budget": 384, "include_thoughts": True},
        ),
        (
            "gemini-2.5-flash",
            ThinkingLevel.MEDIUM,
            {"thinking_budget": 768, "include_thoughts": True},
        ),
        (
            "gemini-2.5-flash",
            ThinkingLevel.HIGH,
            {"thinking_budget": 1024, "include_thoughts": True},
        ),
    ],
)
def test_generate_google_args_thinking_config_mapping(
    model_id: str, thinking_level: ThinkingLevel, expected_kwargs: dict[str, Any]
) -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": model_id,
            "thinking": {"level": thinking_level},
        },
    )

    with patch(
        "module.Engine.TaskRequester.types.ThinkingLevel",
        new=type(
            "TL",
            (),
            {"LOW": "LOW", "MEDIUM": "MEDIUM", "HIGH": "HIGH", "MINIMAL": "MINIMAL"},
        ),
    ):
        with patch(
            "module.Engine.TaskRequester.types.ThinkingConfig",
            side_effect=lambda **kw: FakeThinkingConfig(kw),
        ):
            with patch(
                "module.Engine.TaskRequester.types.GenerateContentConfig",
                side_effect=lambda **kw: FakeGenerateContentConfig(kw),
            ):
                args = requester.generate_google_args(
                    [{"role": "user", "content": "U"}],
                    {},
                )

    config = args["config"]
    assert isinstance(config, FakeGenerateContentConfig)
    thinking_config = config.kwargs["thinking_config"]
    assert isinstance(thinking_config, FakeThinkingConfig)
    for k, v in expected_kwargs.items():
        assert thinking_config.kwargs[k] == v


def test_generate_google_args_fallthrough_when_thinking_level_is_unexpected() -> None:
    model_ids = [
        "gemini-3.1-pro",
        "gemini-3-pro",
        "gemini-3-flash",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    ]

    with patch(
        "module.Engine.TaskRequester.types.ThinkingLevel",
        new=type(
            "TL",
            (),
            {"LOW": "LOW", "MEDIUM": "MEDIUM", "HIGH": "HIGH", "MINIMAL": "MINIMAL"},
        ),
    ):
        with patch(
            "module.Engine.TaskRequester.types.ThinkingConfig",
            side_effect=lambda **kw: FakeThinkingConfig(kw),
        ):
            with patch(
                "module.Engine.TaskRequester.types.GenerateContentConfig",
                side_effect=lambda **kw: FakeGenerateContentConfig(kw),
            ):
                for model_id in model_ids:
                    requester = TaskRequester(
                        Config(),
                        {
                            "api_format": Base.APIFormat.GOOGLE,
                            "api_key": "k",
                            "api_url": "https://example.invalid",
                            "model_id": model_id,
                            "thinking": {"level": "OFF"},
                        },
                    )
                    requester.thinking_level = cast(Any, "WEIRD")
                    args = requester.generate_google_args(
                        [{"role": "user", "content": "U"}],
                        {},
                    )
                    assert "thinking_config" not in args["config"].kwargs


def test_generate_google_args_filters_messages_and_merges_extra_body_and_system() -> (
    None
):
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "gemini-test",
            "request": {
                "extra_body_custom_enable": True,
                # GenerateContentConfig 默认不允许未知字段，这里用已知字段验证 merge 分支。
                "extra_body": {"temperature": 0.1},
            },
        },
    )

    # 刻意塞入非 str content，验证过滤分支
    args = requester.generate_google_args(
        [
            {"role": "system", "content": "  "},
            {"role": "system", "content": "S"},
            {"role": "user", "content": "U"},
            {"role": "user", "content": cast(str, 123)},
            {"role": "assistant", "content": "A"},
        ],
        {},
    )

    assert args["contents"] == ["U"]
    assert getattr(args["config"], "system_instruction") == "S"
    assert getattr(args["config"], "temperature") == 0.1


def test_generate_anthropic_args_filters_system_and_sets_thinking_variants() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "claude-3-7-sonnet",
            "thinking": {"level": "LOW"},
            "request": {
                "extra_body_custom_enable": True,
                "extra_body": {"x": 1},
            },
        },
    )

    args = requester.generate_anthropic_args(
        [
            {"role": "system", "content": "S1"},
            {"role": "system", "content": "S2"},
            {"role": "user", "content": "U"},
        ],
        {
            "presence_penalty": 1,
            "frequency_penalty": 1,
            "top_p": 0.1,
            "temperature": 0.2,
        },
    )

    assert args["system"] == "S1\n\nS2"
    assert all(msg.get("role") != "system" for msg in args["messages"])
    assert "presence_penalty" not in args
    assert "frequency_penalty" not in args
    assert args["thinking"]["type"] == "enabled"
    assert "top_p" not in args
    assert "temperature" not in args
    assert args["extra_body"] == {"x": 1}


@pytest.mark.parametrize(
    "level,expect_type,expect_removed",
    [
        (ThinkingLevel.OFF, "disabled", False),
        (ThinkingLevel.MEDIUM, "enabled", True),
        (ThinkingLevel.HIGH, "enabled", True),
    ],
)
def test_generate_anthropic_args_system_non_str_and_thinking_levels(
    level: ThinkingLevel, expect_type: str, expect_removed: bool
) -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "k",
            "api_url": "u",
            "model_id": "claude-sonnet-4-0",
            "thinking": {"level": level},
        },
    )

    args = requester.generate_anthropic_args(
        [
            {"role": "system", "content": cast(str, 123)},
            {"role": "system", "content": "S"},
            {"role": "user", "content": "U"},
        ],
        {"top_p": 0.1, "temperature": 0.2},
    )

    assert args["system"] == "S"
    assert args["thinking"]["type"] == expect_type
    if expect_removed:
        assert "top_p" not in args
        assert "temperature" not in args
    else:
        assert args["top_p"] == 0.1
        assert args["temperature"] == 0.2


def test_generate_anthropic_args_fallthrough_when_thinking_level_is_unexpected() -> (
    None
):
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "k",
            "api_url": "u",
            "model_id": "claude-opus-4-0",
            "thinking": {"level": "OFF"},
        },
    )
    requester.thinking_level = cast(Any, "WEIRD")

    args = requester.generate_anthropic_args(
        [{"role": "user", "content": "U"}],
        {"top_p": 0.1, "temperature": 0.2},
    )

    assert "thinking" not in args
    assert args["top_p"] == 0.1
    assert args["temperature"] == 0.2


def test_request_routes_and_engine_counters_always_balance() -> None:
    engine = FakeEngine()
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
            "generation": {
                "top_p_custom_enable": True,
                "top_p": 0.5,
                "temperature_custom_enable": True,
                "temperature": 0.7,
                "presence_penalty_custom_enable": True,
                "presence_penalty": 1,
                "frequency_penalty_custom_enable": True,
                "frequency_penalty": 2,
            },
        },
    )

    captured: dict[str, Any] = {}

    def fake_request_openai(
        messages: list[dict], args: dict[str, Any], *, stop_checker: Any = None
    ) -> Any:
        captured["args"] = dict(args)
        return None, "T", "R", 1, 2

    with patch("module.Engine.TaskRequester.Engine.get", return_value=engine):
        with patch.object(requester, "request_openai", side_effect=fake_request_openai):
            err, think, result, itok, otok = requester.request(
                [{"role": "user", "content": "U"}]
            )

    assert err is None
    assert (think, result, itok, otok) == ("T", "R", 1, 2)
    assert engine.inc_calls == 1
    assert engine.dec_calls == 1
    assert captured["args"]["top_p"] == 0.5
    assert captured["args"]["temperature"] == 0.7
    assert captured["args"]["presence_penalty"] == 1
    assert captured["args"]["frequency_penalty"] == 2


@pytest.mark.parametrize(
    "api_format,method_name",
    [
        (Base.APIFormat.SAKURALLM, "request_sakura"),
        (Base.APIFormat.GOOGLE, "request_google"),
        (Base.APIFormat.ANTHROPIC, "request_anthropic"),
        (Base.APIFormat.OPENAI, "request_openai"),
    ],
)
def test_request_routes_by_api_format(api_format: str, method_name: str) -> None:
    engine = FakeEngine()
    requester = TaskRequester(
        Config(),
        {
            "api_format": api_format,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )

    called: dict[str, int] = {"n": 0}

    def fake_request(
        messages: list[dict], args: dict[str, Any], *, stop_checker: Any = None
    ) -> Any:
        called["n"] += 1
        return None, "T", "R", 1, 2

    with patch("module.Engine.TaskRequester.Engine.get", return_value=engine):
        with patch.object(requester, method_name, side_effect=fake_request):
            err, think, result, itok, otok = requester.request(
                [{"role": "user", "content": "U"}],
            )

    assert err is None
    assert (think, result, itok, otok) == ("T", "R", 1, 2)
    assert called["n"] == 1
    assert engine.inc_calls == 1
    assert engine.dec_calls == 1


def test_request_stop_checker_short_circuits_without_engine_touch() -> None:
    engine = FakeEngine()
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    with patch("module.Engine.TaskRequester.Engine.get", return_value=engine):
        err, think, result, itok, otok = requester.request(
            [{"role": "user", "content": "U"}],
            stop_checker=lambda: True,
        )

    assert isinstance(err, RequestCancelledError)
    assert (think, result, itok, otok) == ("", "", 0, 0)
    assert engine.inc_calls == 0
    assert engine.dec_calls == 0


@pytest.mark.parametrize(
    "api_format,call",
    [
        (Base.APIFormat.SAKURALLM, "request_sakura"),
        (Base.APIFormat.OPENAI, "request_openai"),
        (Base.APIFormat.GOOGLE, "request_google"),
        (Base.APIFormat.ANTHROPIC, "request_anthropic"),
    ],
)
def test_request_xxx_stop_checker_short_circuit(api_format: str, call: str) -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": api_format,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )

    method = getattr(requester, call)
    err, think, result, itok, otok = method(
        [{"role": "user", "content": "U"}],
        {},
        stop_checker=lambda: True,
    )
    assert isinstance(err, RequestCancelledError)
    assert (think, result, itok, otok) == ("", "", 0, 0)


def test_request_sakura_success_wraps_lines_into_json() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.SAKURALLM,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    with patch(
        "module.Engine.TaskRequester.TaskRequesterClientPool.get_client",
        return_value=object(),
    ):
        with patch(
            "module.Engine.TaskRequester.TaskRequesterClientPool.get_url",
            return_value="u",
        ):
            with patch(
                "module.Engine.TaskRequester.TaskRequesterClientPool.get_key",
                return_value="k",
            ):
                with patch.object(
                    requester,
                    "request_stream_with_strategy",
                    return_value=("TH", "a\n b ", 1, 2),
                ):
                    dumped: dict[str, Any] = {}

                    def fake_dumps(obj: Any) -> str:
                        dumped["obj"] = obj
                        return "D"

                    with patch(
                        "module.Engine.TaskRequester.JSONTool.dumps",
                        side_effect=fake_dumps,
                    ):
                        err, think, result, itok, otok = requester.request_sakura(
                            [{"role": "user", "content": "U"}],
                            {},
                        )

    assert err is None
    assert think == "TH"
    assert result == "D"
    assert (itok, otok) == (1, 2)
    assert dumped["obj"] == {"0": "a", "1": "b"}


def test_request_sakura_exception_is_captured() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.SAKURALLM,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    with patch(
        "module.Engine.TaskRequester.TaskRequesterClientPool.get_client",
        side_effect=RuntimeError("boom"),
    ):
        err, think, result, itok, otok = requester.request_sakura(
            [{"role": "user", "content": "U"}],
            {},
        )

    assert isinstance(err, RuntimeError)
    assert (think, result, itok, otok) == ("", "", 0, 0)


def test_request_openai_google_anthropic_exception_is_captured() -> None:
    cfg = Config()
    for api_format, method_name in [
        (Base.APIFormat.OPENAI, "request_openai"),
        (Base.APIFormat.GOOGLE, "request_google"),
        (Base.APIFormat.ANTHROPIC, "request_anthropic"),
    ]:
        requester = TaskRequester(
            cfg,
            {
                "api_format": api_format,
                "api_key": "k",
                "api_url": "https://example.invalid",
                "model_id": "m",
            },
        )
        with patch(
            "module.Engine.TaskRequester.TaskRequesterClientPool.get_client",
            side_effect=RuntimeError("boom"),
        ):
            method = getattr(requester, method_name)
            err, think, result, itok, otok = method(
                [{"role": "user", "content": "U"}],
                {},
            )
        assert isinstance(err, RuntimeError)
        assert (think, result, itok, otok) == ("", "", 0, 0)


@pytest.mark.parametrize(
    "api_format,method_name",
    [
        (Base.APIFormat.OPENAI, "request_openai"),
        (Base.APIFormat.ANTHROPIC, "request_anthropic"),
    ],
)
def test_request_openai_and_anthropic_success_paths(
    api_format: str, method_name: str
) -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": api_format,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    with patch(
        "module.Engine.TaskRequester.TaskRequesterClientPool.get_client",
        return_value=object(),
    ):
        with patch(
            "module.Engine.TaskRequester.TaskRequesterClientPool.get_url",
            return_value="u",
        ):
            with patch(
                "module.Engine.TaskRequester.TaskRequesterClientPool.get_key",
                return_value="k",
            ):
                with patch.object(
                    requester,
                    "request_stream_with_strategy",
                    return_value=("TH", "R", 1, 2),
                ):
                    method = getattr(requester, method_name)
                    err, think, result, itok, otok = method(
                        [{"role": "user", "content": "U"}],
                        {},
                    )

    assert err is None
    assert (think, result, itok, otok) == ("TH", "R", 1, 2)


def test_request_google_passes_sorted_extra_headers_tuple_to_client_pool() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
            "request": {
                "extra_headers_custom_enable": True,
                "extra_headers": {"b": "2", "a": "1"},
            },
        },
    )

    captured: dict[str, Any] = {}

    def fake_get_client(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return object()

    with patch(
        "module.Engine.TaskRequester.TaskRequesterClientPool.get_client",
        side_effect=fake_get_client,
    ):
        with patch(
            "module.Engine.TaskRequester.TaskRequesterClientPool.get_url",
            return_value="u",
        ):
            with patch(
                "module.Engine.TaskRequester.TaskRequesterClientPool.get_key",
                return_value="k",
            ):
                with patch.object(
                    requester,
                    "request_stream_with_strategy",
                    return_value=("TH", "R", 1, 2),
                ):
                    err, think, result, itok, otok = requester.request_google(
                        [{"role": "user", "content": "U"}],
                        {},
                    )

    assert err is None
    assert (think, result, itok, otok) == ("TH", "R", 1, 2)
    assert captured["extra_headers_tuple"] == (("a", "1"), ("b", "2"))


def test_request_stream_with_strategy_runs_consume_and_finalize() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    @dataclasses.dataclass
    class Strategy:
        items: list[Any] = dataclasses.field(default_factory=list)

        def create_state(self) -> Any:
            return self

        @contextmanager
        def build_stream_session(
            self, client: Any, request_args: dict[str, Any]
        ) -> Iterator[StreamSession]:
            yield StreamSession(iterator=["x"], close=lambda: None, finalize=None)

        def handle_item(self, state: Any, item: Any) -> None:
            state.items.append(item)

        def finalize(
            self, session: StreamSession, state: Any
        ) -> tuple[str, str, int, int]:
            return "TH", "R", 1, len(state.items)

    out = requester.request_stream_with_strategy(
        client=object(),
        request_args={},
        strategy=Strategy(),
        stop_checker=None,
    )
    assert out == ("TH", "R", 1, 1)


def test_openai_strategy_integration_and_degradation_paths() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "https://example.invalid",
            "model_id": "m",
        },
    )

    completion_ok = FakeOpenAICompletion(
        choices=[FakeOpenAIChoice(FakeOpenAIMessage(content="OK"))],
        usage=FakeUsage(prompt_tokens=1, completion_tokens=2),
    )
    stream_ok = FakeOpenAIStream(
        events=[
            FakeOpenAIEvent(type="ignore"),
            FakeOpenAIEvent(type="content.delta", content="hi"),
            FakeOpenAIEvent(type="content.delta", content=None),
            FakeOpenAIEvent(type="content.delta", content=123),
        ],
        final_completion=completion_ok,
    )
    client_ok = FakeOpenAIClient(stream_ok)

    think, result, itok, otok = requester.request_stream_with_strategy(
        client_ok,
        request_args={},
        strategy=TaskRequester.OpenAIStreamStrategy(requester),
        stop_checker=None,
    )
    assert (think, result, itok, otok) == ("", "OK", 1, 2)
    assert stream_ok.closed == 1

    completion_bad_usage = FakeOpenAICompletion(
        choices=[FakeOpenAIChoice(FakeOpenAIMessage(content="OK"))],
        usage=FakeUsage(prompt_tokens="x", completion_tokens=object()),
    )
    stream_bad_usage = FakeOpenAIStream(
        events=[], final_completion=completion_bad_usage
    )
    client_bad_usage = FakeOpenAIClient(stream_bad_usage)
    think2, result2, itok2, otok2 = requester.request_stream_with_strategy(
        client_bad_usage,
        request_args={},
        strategy=TaskRequester.OpenAIStreamStrategy(requester),
        stop_checker=None,
    )
    assert (think2, result2, itok2, otok2) == ("", "OK", 0, 0)

    completion_degrade = FakeOpenAICompletion(
        choices=[FakeOpenAIChoice(FakeOpenAIMessage(content="A" * 50))],
        usage=FakeUsage(prompt_tokens=0, completion_tokens=0),
    )
    stream_degrade = FakeOpenAIStream(
        events=[FakeOpenAIEvent(type="ignore")],
        final_completion=completion_degrade,
    )
    client_degrade = FakeOpenAIClient(stream_degrade)
    with pytest.raises(StreamDegradationError):
        requester.request_stream_with_strategy(
            client_degrade,
            request_args={},
            strategy=TaskRequester.OpenAIStreamStrategy(requester),
            stop_checker=None,
        )

    completion_handle_degrade = FakeOpenAICompletion(
        choices=[FakeOpenAIChoice(FakeOpenAIMessage(content="OK"))],
        usage=FakeUsage(prompt_tokens=0, completion_tokens=0),
    )
    stream_handle_degrade = FakeOpenAIStream(
        events=[FakeOpenAIEvent(type="content.delta", content="A" * 50)],
        final_completion=completion_handle_degrade,
    )
    client_handle_degrade = FakeOpenAIClient(stream_handle_degrade)
    with pytest.raises(StreamDegradationError):
        requester.request_stream_with_strategy(
            client_handle_degrade,
            request_args={},
            strategy=TaskRequester.OpenAIStreamStrategy(requester),
            stop_checker=None,
        )


def test_openai_finalize_requires_finalize_callable() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )
    strategy = TaskRequester.OpenAIStreamStrategy(requester)
    session = StreamSession(iterator=[], close=lambda: None, finalize=None)
    with pytest.raises(RuntimeError, match="missing finalize"):
        strategy.finalize(session, strategy.create_state())


def test_anthropic_strategy_integration_and_variants() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )

    message_ok = FakeAnthropicMessage(
        content=[
            FakeAnthropicPart(text="T1"),
            FakeAnthropicPart(thinking="A\n\nB"),
            FakeAnthropicPart(text="T2"),
        ],
        usage=FakeUsage(input_tokens=1, output_tokens=2),
    )
    stream_ok = FakeAnthropicStream(text_stream=["hi"], final_message=message_ok)
    client_ok = FakeAnthropicClient(stream_ok)
    think, result, itok, otok = requester.request_stream_with_strategy(
        client_ok,
        request_args={},
        strategy=TaskRequester.AnthropicStreamStrategy(requester),
        stop_checker=None,
    )
    assert think == "A\nB"
    assert result == "T2"
    assert (itok, otok) == (1, 2)
    assert stream_ok.closed == 1

    message_empty = FakeAnthropicMessage(
        content=[], usage=FakeUsage(input_tokens="x", output_tokens=object())
    )
    stream_empty = FakeAnthropicStream(text_stream=[123], final_message=message_empty)
    client_empty = FakeAnthropicClient(stream_empty)
    think2, result2, itok2, otok2 = requester.request_stream_with_strategy(
        client_empty,
        request_args={},
        strategy=TaskRequester.AnthropicStreamStrategy(requester),
        stop_checker=None,
    )
    assert (think2, result2, itok2, otok2) == ("", "", 0, 0)

    message_degrade = FakeAnthropicMessage(
        content=[FakeAnthropicPart(text="A" * 50)],
        usage=FakeUsage(input_tokens=0, output_tokens=0),
    )
    stream_degrade = FakeAnthropicStream(
        text_stream=["ok"], final_message=message_degrade
    )
    client_degrade = FakeAnthropicClient(stream_degrade)
    with pytest.raises(StreamDegradationError):
        requester.request_stream_with_strategy(
            client_degrade,
            request_args={},
            strategy=TaskRequester.AnthropicStreamStrategy(requester),
            stop_checker=None,
        )

    message_handle_degrade = FakeAnthropicMessage(
        content=[FakeAnthropicPart(text="OK")],
        usage=FakeUsage(input_tokens=0, output_tokens=0),
    )
    stream_handle_degrade = FakeAnthropicStream(
        text_stream=["A" * 50],
        final_message=message_handle_degrade,
    )
    client_handle_degrade = FakeAnthropicClient(stream_handle_degrade)
    with pytest.raises(StreamDegradationError):
        requester.request_stream_with_strategy(
            client_handle_degrade,
            request_args={},
            strategy=TaskRequester.AnthropicStreamStrategy(requester),
            stop_checker=None,
        )


def test_anthropic_finalize_requires_finalize_callable() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.ANTHROPIC,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )
    strategy = TaskRequester.AnthropicStreamStrategy(requester)
    session = StreamSession(iterator=[], close=lambda: None, finalize=None)
    with pytest.raises(RuntimeError, match="missing finalize"):
        strategy.finalize(session, strategy.create_state())


def test_google_strategy_integration_and_variants() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )

    usage = FakeUsage(prompt_token_count=3, total_token_count=10)
    chunks = [
        FakeGoogleChunk(candidates=None),
        FakeGoogleChunk(candidates=[]),
        FakeGoogleChunk(candidates=[FakeGoogleCandidate(content=None)]),
        FakeGoogleChunk(
            candidates=[FakeGoogleCandidate(content=FakeGoogleContent(parts=None))]
        ),
        FakeGoogleChunk(
            candidates=[
                FakeGoogleCandidate(
                    content=FakeGoogleContent(
                        parts=[
                            FakeGooglePart(text=123, thought=False),
                            FakeGooglePart(text="T", thought=True),
                            FakeGooglePart(text="R", thought=False),
                        ]
                    )
                )
            ],
            usage_metadata=usage,
        ),
    ]
    client = FakeGoogleClient(chunks)
    think, result, itok, otok = requester.request_stream_with_strategy(
        client,
        request_args={},
        strategy=TaskRequester.GoogleStreamStrategy(requester),
        stop_checker=None,
    )
    assert think == "T"
    assert result == "R"
    assert (itok, otok) == (3, 7)

    usage_bad = object()
    client_bad_usage = FakeGoogleClient(
        [
            FakeGoogleChunk(
                candidates=[
                    FakeGoogleCandidate(
                        content=FakeGoogleContent(parts=[FakeGooglePart(text="OK")])
                    )
                ],
                usage_metadata=usage_bad,
            )
        ]
    )
    think2, result2, itok2, otok2 = requester.request_stream_with_strategy(
        client_bad_usage,
        request_args={},
        strategy=TaskRequester.GoogleStreamStrategy(requester),
        stop_checker=None,
    )
    assert (think2, result2, itok2, otok2) == ("", "OK", 0, 0)

    client_degrade = FakeGoogleClient(
        [
            FakeGoogleChunk(
                candidates=[
                    FakeGoogleCandidate(
                        content=FakeGoogleContent(parts=[FakeGooglePart(text="A" * 50)])
                    )
                ],
                usage_metadata=FakeUsage(prompt_token_count=0, total_token_count=0),
            )
        ]
    )
    with pytest.raises(StreamDegradationError):
        requester.request_stream_with_strategy(
            client_degrade,
            request_args={},
            strategy=TaskRequester.GoogleStreamStrategy(requester),
            stop_checker=None,
        )


def test_google_finalize_fallback_degradation_check_can_raise() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.GOOGLE,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )
    strategy = TaskRequester.GoogleStreamStrategy(requester)
    state = strategy.create_state()
    state.result_parts.append("OK")

    with patch.object(requester, "has_output_degradation", return_value=True):
        with pytest.raises(StreamDegradationError):
            strategy.finalize(StreamSession(iterator=[], close=lambda: None), state)


def test_openai_build_stream_session_handles_non_iterable_stream_object() -> None:
    requester = TaskRequester(
        Config(),
        {
            "api_format": Base.APIFormat.OPENAI,
            "api_key": "k",
            "api_url": "u",
            "model_id": "m",
        },
    )

    class StreamNoIter:
        def __init__(self) -> None:
            self.closed = 0

        def close(self) -> None:
            self.closed += 1

        def get_final_completion(self) -> Any:
            return FakeOpenAICompletion(
                choices=[FakeOpenAIChoice(FakeOpenAIMessage(content="OK"))],
                usage=FakeUsage(prompt_tokens=0, completion_tokens=0),
            )

    stream_obj = StreamNoIter()
    client = FakeOpenAIClient(stream_obj)
    strategy = TaskRequester.OpenAIStreamStrategy(requester)

    with strategy.build_stream_session(cast(Any, client), {}) as session:
        assert session.iterator is stream_obj
        session.close()
    assert stream_obj.closed == 1
