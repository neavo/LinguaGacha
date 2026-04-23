from api.Contract.ApiResponse import ApiResponse


def test_api_response_to_dict_omits_none_fields() -> None:
    response = ApiResponse(ok=True, data={"accepted": True})

    assert response.to_dict() == {
        "ok": True,
        "data": {"accepted": True},
    }


def test_api_response_to_dict_keeps_error_payload() -> None:
    response = ApiResponse(
        ok=False,
        error={"code": "invalid_request", "message": "bad request"},
    )

    assert response.to_dict() == {
        "ok": False,
        "error": {
            "code": "invalid_request",
            "message": "bad request",
        },
    }
