from typing import Any

from module.Config import Config
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestExecutor import TaskRequestExecutor


class FakeRequester:
    def __init__(self, config: Config, model: dict[str, Any]) -> None:
        del config, model

    def request(
        self,
        messages: list[dict[str, Any]],
        *,
        stop_checker: Any = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        del messages, stop_checker
        return (
            None,
            "think",
            '{"0":"译文"}\n{"src":"A","dst":"B","type":"name"}<why>因为</why>',
            3,
            4,
        )


class TimeoutRequester:
    def __init__(self, config: Config, model: dict[str, Any]) -> None:
        del config, model

    def request(
        self,
        messages: list[dict[str, Any]],
        *,
        stop_checker: Any = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        del messages, stop_checker
        return (RequestHardTimeoutError("timeout"), "part", "raw", 1, 2)


def test_task_request_executor_decodes_response_and_merges_why_block() -> None:
    response = TaskRequestExecutor.execute(
        config=Config(),
        model={},
        messages=[{"role": "user", "content": "U"}],
        requester_factory=FakeRequester,
        stop_checker=lambda: False,
    )

    assert response.exception is None
    assert response.normalized_think == "think\n因为"
    assert (
        response.cleaned_response_result
        == '{"0":"译文"}\n{"src":"A","dst":"B","type":"name"}'
    )
    assert response.has_why_block is True
    assert response.decoded_translations == ("译文",)
    assert response.decoded_glossary_entries == (
        {"src": "A", "dst": "B", "info": "name"},
    )


def test_task_request_executor_keeps_recoverable_exception_payload() -> None:
    response = TaskRequestExecutor.execute(
        config=Config(),
        model={},
        messages=[{"role": "user", "content": "U"}],
        requester_factory=TimeoutRequester,
        stop_checker=lambda: False,
    )

    assert isinstance(response.exception, RequestHardTimeoutError)
    assert response.is_recoverable_exception() is True
    assert response.response_think == "part"
    assert response.response_result == "raw"
    assert response.decoded_translations == tuple()
