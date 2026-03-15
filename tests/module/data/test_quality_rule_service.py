from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from module.Data.DataManager import DataManager
from module.Data.QualityRuleService import QualityRuleService
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


def build_service() -> QualityRuleService:
    rule_service = SimpleNamespace(
        get_rules_cached=MagicMock(return_value=[]),
        set_rules_cached=MagicMock(),
        get_rule_text_cached=MagicMock(return_value=""),
        set_rule_text_cached=MagicMock(),
    )
    meta: dict[str, object] = {}
    return QualityRuleService(
        rule_service,
        lambda key, default=None: meta.get(key, default),
        lambda key, value: meta.__setitem__(key, value),
        lambda: [],
        DataManager.TextPreserveMode,
    )


def test_set_glossary_dedupes_casefold_and_drops_empty_src() -> None:
    service = build_service()

    normalized = service.set_glossary(
        [
            {"src": "HP", "dst": "a", "info": "", "case_sensitive": False},
            {"src": " hp ", "dst": "b", "info": "", "case_sensitive": False},
            {"src": "   ", "dst": "x"},
        ]
    )

    assert len(normalized) == 1
    assert normalized[0]["src"].casefold() == "hp"
    assert normalized[0]["dst"] == "b"


def test_merge_glossary_incoming_returns_none_when_no_changes() -> None:
    service = build_service()
    service.get_glossary = MagicMock(return_value=[{"src": "A", "dst": "B"}])
    service.set_glossary = MagicMock()

    empty_report = QualityRuleMerger.Report(
        added=0,
        updated=0,
        filled=0,
        deduped=0,
        skipped_empty_src=0,
        conflicts=(),
    )
    original_merge = QualityRuleMerger.merge
    QualityRuleMerger.merge = MagicMock(
        return_value=([{"src": "A", "dst": "B"}], empty_report)
    )
    try:
        merged, report = service.merge_glossary_incoming(
            incoming=[{"src": "A", "dst": "B"}],
            merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
            save=True,
        )
    finally:
        QualityRuleMerger.merge = original_merge

    assert merged is None
    assert report == empty_report
    service.set_glossary.assert_not_called()


def test_text_preserve_mode_normalizes_invalid_to_smart_or_off() -> None:
    service = build_service()

    assert service.get_text_preserve_mode() == DataManager.TextPreserveMode.SMART
    assert service.set_text_preserve_mode("invalid") == DataManager.TextPreserveMode.OFF


def test_boolean_meta_helpers_roundtrip() -> None:
    service = build_service()

    service.set_glossary_enable(0)
    service.set_pre_replacement_enable("yes")

    assert service.get_glossary_enable() is False
    assert service.get_pre_replacement_enable() is True
