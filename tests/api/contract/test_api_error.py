from dataclasses import FrozenInstanceError

import pytest

from api.Contract.ApiError import ApiError


def test_api_error_exposes_stable_frozen_fields() -> None:
    error = ApiError(code="invalid_request", message="bad request")

    assert error.code == "invalid_request"
    assert error.message == "bad request"

    with pytest.raises(FrozenInstanceError):
        error.code = "internal_error"  # type: ignore[misc]
