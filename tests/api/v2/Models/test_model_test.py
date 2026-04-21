import dataclasses

import pytest

from api.v2.Models.ModelTest import ModelApiTestResult
from api.v2.Models.ModelTest import ModelKeyTestResult


def test_model_api_test_result_to_dict_keeps_all_fields() -> None:
    key_result = ModelKeyTestResult(
        masked_key="abcd****wxyz",
        success=True,
        input_tokens=12,
        output_tokens=34,
        response_time_ms=56,
        error_reason="",
    )
    result = ModelApiTestResult(
        success=True,
        result_msg="ok",
        total_count=1,
        success_count=1,
        failure_count=0,
        total_response_time_ms=56,
        key_results=(key_result,),
    )

    payload = result.to_dict()

    assert payload == {
        "success": True,
        "result_msg": "ok",
        "total_count": 1,
        "success_count": 1,
        "failure_count": 0,
        "total_response_time_ms": 56,
        "key_results": [
            {
                "masked_key": "abcd****wxyz",
                "success": True,
                "input_tokens": 12,
                "output_tokens": 34,
                "response_time_ms": 56,
                "error_reason": "",
            }
        ],
    }


def test_model_api_test_result_dataclass_is_frozen() -> None:
    result = ModelApiTestResult(
        success=False,
        result_msg="failed",
        total_count=0,
        success_count=0,
        failure_count=0,
        total_response_time_ms=0,
        key_results=(),
    )

    with pytest.raises(dataclasses.FrozenInstanceError):
        setattr(result, "result_msg", "changed")
