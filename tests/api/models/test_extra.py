from api.Models.Extra import ExtraTaskState
from api.Models.Extra import ExtraToolEntry
from api.Models.Extra import ExtraToolSnapshot
from api.Models.Extra import NameFieldEntryDraft
from api.Models.Extra import NameFieldSnapshot
from api.Models.Extra import NameFieldTranslateResult
from api.Models.Extra import TsConversionOptionsSnapshot
from api.Models.Extra import TsConversionTaskAccepted


def test_ts_conversion_models_round_trip_keep_stable_contract() -> None:
    options = TsConversionOptionsSnapshot.from_dict(
        {
            "default_direction": "TO_TRADITIONAL",
            "preserve_text_enabled": True,
            "convert_name_enabled": False,
        }
    )
    accepted = TsConversionTaskAccepted.from_dict(
        {
            "accepted": True,
            "task_id": "extra_ts_conversion",
        }
    )

    assert options.to_dict() == {
        "default_direction": "TO_TRADITIONAL",
        "preserve_text_enabled": True,
        "convert_name_enabled": False,
    }
    assert accepted.to_dict() == {
        "accepted": True,
        "task_id": "extra_ts_conversion",
    }


def test_extra_task_state_merge_dict_updates_only_explicit_fields() -> None:
    state = ExtraTaskState.from_dict(
        {
            "task_id": "task-1",
            "phase": ExtraTaskState.PHASE_RUNNING,
            "message": "translating",
            "current": 3,
            "total": 10,
            "finished": False,
        }
    )

    merged = state.merge_dict(
        {
            "message": "finishing",
            "current": 10,
        },
        finished=True,
    )

    assert merged.task_id == "task-1"
    assert merged.phase == ExtraTaskState.PHASE_RUNNING
    assert merged.message == "finishing"
    assert merged.current == 10
    assert merged.total == 10
    assert merged.finished is True


def test_name_field_models_normalize_items_and_counts() -> None:
    snapshot = NameFieldSnapshot.from_dict(
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
    )
    result = NameFieldTranslateResult.from_dict(
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
    )

    assert snapshot.items == (
        NameFieldEntryDraft(
            src="勇者",
            dst="",
            context="勇者が来た",
            status="未翻译",
        ),
    )
    assert result.to_dict() == {
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


def test_extra_models_use_safe_defaults_for_invalid_payloads() -> None:
    options = TsConversionOptionsSnapshot.from_dict(None)
    accepted = TsConversionTaskAccepted.from_dict(None)
    state = ExtraTaskState.from_dict(None)
    snapshot = NameFieldSnapshot.from_dict({"items": "invalid"})
    result = NameFieldTranslateResult.from_dict({"items": "invalid"})

    assert options.to_dict() == {
        "default_direction": "",
        "preserve_text_enabled": False,
        "convert_name_enabled": False,
    }
    assert accepted.to_dict() == {
        "accepted": False,
        "task_id": "",
    }
    assert state.merge_dict(None).finished is False
    assert snapshot.items == ()
    assert result.items == ()
    assert result.success_count == 0
    assert result.failed_count == 0


def test_extra_tool_models_expose_stable_entry_contract() -> None:
    entry = ExtraToolEntry(
        tool_id="ts-conversion",
        title="繁简转换",
        description="把工程文本转换成目标字形",
        route_path="/extra/ts-conversion",
    )
    snapshot = ExtraToolSnapshot(entries=(entry,))

    assert snapshot.entries == (entry,)
    assert snapshot.entries[0].route_path == "/extra/ts-conversion"
