from dataclasses import FrozenInstanceError
from dataclasses import asdict

import pytest

from api.Contract.ApiError import ApiError


def test_api_error_exposes_stable_frozen_fields() -> None:
    error = ApiError(code="invalid_request", message="bad request")

    assert asdict(error) == {
        "code": "invalid_request",
        "message": "bad request",
    }

    with pytest.raises(FrozenInstanceError):
        error.code = "internal_error"  # type: ignore[misc]
