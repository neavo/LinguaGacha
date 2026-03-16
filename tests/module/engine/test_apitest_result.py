import dataclasses

import pytest

from module.Engine.APITest.APITestResult import APITestResult
from module.Engine.APITest.APITestResult import KeyTestResult


def test_api_test_result_to_event_dict_keeps_all_fields() -> None:
    key_result = KeyTestResult(
        masked_key="abcd****wxyz",
        success=True,
        input_tokens=12,
        output_tokens=34,
        response_time_ms=56,
        error_reason="",
    )
    result = APITestResult(
        success=True,
        result_msg="ok",
        total_count=1,
        success_count=1,
        failure_count=0,
        total_response_time_ms=56,
        key_results=(key_result,),
    )

    payload = result.to_event_dict()

    assert payload["result"] is True
    assert payload["result_msg"] == "ok"
    assert payload["total_count"] == 1
    assert payload["success_count"] == 1
    assert payload["failure_count"] == 0
    assert payload["total_response_time_ms"] == 56
    assert payload["key_results"] == [
        {
            "masked_key": "abcd****wxyz",
            "success": True,
            "input_tokens": 12,
            "output_tokens": 34,
            "response_time_ms": 56,
            "error_reason": "",
        }
    ]


def test_api_test_result_dataclass_is_frozen() -> None:
    result = APITestResult(
        success=False,
        result_msg="failed",
        total_count=0,
        success_count=0,
        failure_count=0,
        total_response_time_ms=0,
        key_results=(),
    )

    with pytest.raises(dataclasses.FrozenInstanceError):
        result.result_msg = "changed"  # type: ignore[misc]
