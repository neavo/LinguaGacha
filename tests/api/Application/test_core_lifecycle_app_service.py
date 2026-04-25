import pytest

from api.Application.CoreLifecycleAppService import CoreLifecycleAppService


class FakeRequestHandler:
    def __init__(self, *, token: str | None = None) -> None:
        self.headers: dict[str, str] = {}
        if token is not None:
            self.headers[CoreLifecycleAppService.SHUTDOWN_TOKEN_HEADER] = token


def test_shutdown_accepts_matching_instance_token() -> None:
    shutdown_calls: list[str] = []
    service = CoreLifecycleAppService(
        instance_token="core-token",
        request_shutdown=lambda: shutdown_calls.append("shutdown"),
    )

    result = service.shutdown({}, FakeRequestHandler(token="core-token"))

    assert result == {"accepted": True}
    assert shutdown_calls == ["shutdown"]


def test_shutdown_rejects_missing_instance_token() -> None:
    shutdown_calls: list[str] = []
    service = CoreLifecycleAppService(
        instance_token="core-token",
        request_shutdown=lambda: shutdown_calls.append("shutdown"),
    )

    with pytest.raises(ValueError, match="Core 生命周期关闭令牌无效。"):
        service.shutdown({}, FakeRequestHandler())

    assert shutdown_calls == []


def test_shutdown_rejects_empty_server_instance_token() -> None:
    shutdown_calls: list[str] = []
    service = CoreLifecycleAppService(
        instance_token="",
        request_shutdown=lambda: shutdown_calls.append("shutdown"),
    )

    with pytest.raises(ValueError, match="Core 生命周期关闭令牌无效。"):
        service.shutdown({}, FakeRequestHandler(token="core-token"))

    assert shutdown_calls == []
