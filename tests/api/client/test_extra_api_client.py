from model.Api import ExtraToolEntry
from model.Api import ExtraToolSnapshot
from model.Api import LaboratorySnapshot
from model.Api import NameFieldEntryDraft
from model.Api import NameFieldSnapshot
from model.Api import NameFieldTranslateResult
from model.Api import TsConversionOptionsSnapshot
from model.Api import TsConversionTaskAccepted


def test_extra_models_expose_minimal_ts_conversion_contract() -> None:
    # 准备
    snapshot = TsConversionOptionsSnapshot()
    accepted = TsConversionTaskAccepted()

    # 断言
    assert snapshot.default_direction == ""
    assert snapshot.preserve_text_enabled is False
    assert snapshot.convert_name_enabled is False
    assert accepted.accepted is False
    assert accepted.task_id == ""


def test_extra_models_expose_minimal_name_field_contract() -> None:
    # 准备
    draft = NameFieldEntryDraft()
    name_field_snapshot = NameFieldSnapshot()
    translate_result = NameFieldTranslateResult()

    # 断言
    assert draft.src == ""
    assert draft.dst == ""
    assert draft.context == ""
    assert draft.status == ""
    assert name_field_snapshot.items == ()
    assert translate_result.items == ()
    assert translate_result.success_count == 0
    assert translate_result.failed_count == 0


def test_extra_models_expose_minimal_laboratory_and_tool_contract() -> None:
    # 准备
    laboratory_snapshot = LaboratorySnapshot()
    tool_entry = ExtraToolEntry()
    tool_snapshot = ExtraToolSnapshot()

    # 断言
    assert laboratory_snapshot.mtool_optimizer_enabled is False
    assert laboratory_snapshot.force_thinking_enabled is False
    assert tool_entry.tool_id == ""
    assert tool_snapshot.entries == ()
