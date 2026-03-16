import pytest

from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError


@pytest.mark.parametrize(
    "error_type",
    [
        RequestCancelledError,
        RequestHardTimeoutError,
        StreamDegradationError,
    ],
)
def test_custom_request_errors_are_exceptions(error_type: type[Exception]) -> None:
    error = error_type("boom")
    assert isinstance(error, Exception)
    assert str(error) == "boom"


def test_custom_error_can_be_caught_by_base_exception() -> None:
    with pytest.raises(Exception, match="cancelled"):
        raise RequestCancelledError("cancelled")
