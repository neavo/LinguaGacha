import pytest

from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError


@pytest.mark.parametrize(
    ("error_type", "message"),
    [
        (RequestCancelledError, "cancelled"),
        (RequestHardTimeoutError, "timeout"),
        (StreamDegradationError, "degraded"),
    ],
)
def test_custom_request_errors_preserve_domain_type_and_message(
    error_type: type[Exception],
    message: str,
) -> None:
    error = error_type(message)

    assert isinstance(error, Exception)
    assert str(error) == message

    with pytest.raises(error_type, match=message):
        raise error
