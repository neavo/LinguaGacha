from api.Contract.ExtraPayloads import NameFieldSnapshotPayload
from api.Contract.ExtraPayloads import NameFieldTranslateResultPayload
from api.Contract.ExtraPayloads import TsConversionOptionsPayload
from api.Contract.ExtraPayloads import TsConversionTaskPayload


def test_ts_conversion_payloads_wrap_options_and_task() -> None:
    options = TsConversionOptionsPayload.from_dict(
        {
            "default_direction": "TO_SIMPLIFIED",
            "preserve_text_enabled": True,
            "convert_name_enabled": False,
        }
    ).to_dict()
    task = TsConversionTaskPayload.from_dict(
        {"accepted": True, "task_id": "extra_ts_conversion"}
    ).to_dict()

    assert options["options"]["default_direction"] == "TO_SIMPLIFIED"
    assert options["options"]["preserve_text_enabled"] is True
    assert task == {
        "task": {
            "accepted": True,
            "task_id": "extra_ts_conversion",
        }
    }


def test_name_field_payloads_wrap_snapshot_and_translate_result() -> None:
    snapshot = NameFieldSnapshotPayload.from_dict(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "未翻译",
                }
            ]
        }
    ).to_dict()
    result = NameFieldTranslateResultPayload.from_dict(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ],
            "success_count": 1,
            "failed_count": 0,
        }
    ).to_dict()

    assert snapshot["snapshot"]["items"][0]["src"] == "勇者"
    assert result["result"]["items"][0]["dst"] == "Hero"
    assert result["result"]["success_count"] == 1
