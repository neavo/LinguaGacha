from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.DataEnums import TextPreserveMode
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Quality.QualityRuleService import QualityRuleService
from module.QualityRule.QualityRuleMerger import QualityRuleMerger


def build_service() -> QualityRuleService:
    session = ProjectSession()
    rule_service = SimpleNamespace(
        get_rules_cached=MagicMock(return_value=[]),
        set_rules_cached=MagicMock(),
        get_rule_text_cached=MagicMock(return_value=""),
        set_rule_text_cached=MagicMock(),
    )
    meta: dict[str, object] = {}
    meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta.get(key, default)
        ),
        set_meta=MagicMock(side_effect=lambda key, value: meta.__setitem__(key, value)),
    )
    item_service = SimpleNamespace(get_all_item_dicts=MagicMock(return_value=[]))
    return QualityRuleService(
        session,
        rule_service,
        meta_service,
        item_service,
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

    assert service.get_text_preserve_mode() == TextPreserveMode.SMART
    assert service.set_text_preserve_mode("invalid") == TextPreserveMode.OFF


def test_boolean_meta_helpers_roundtrip() -> None:
    service = build_service()

    service.set_glossary_enable(0)
    service.set_pre_replacement_enable("yes")

    assert service.get_glossary_enable() is False
    assert service.get_pre_replacement_enable() is True


def test_collect_rule_statistics_texts_filters_untracked_status_and_normalizes_text() -> (
    None
):
    service = build_service()
    service.item_service.get_all_item_dicts.return_value = [
        {
            "src": "Alpha",
            "dst": "阿尔法",
            "status": Base.ProjectStatus.PROCESSED,
        },
        {
            "src": 123,
            "dst": None,
            "status": Base.ProjectStatus.ERROR.value,
        },
        {
            "src": "Skip",
            "dst": "跳过",
            "status": Base.ProjectStatus.EXCLUDED,
        },
        "not-a-dict",
    ]

    src_texts, dst_texts = service.collect_rule_statistics_texts()

    assert src_texts == ("Alpha", "123")
    assert dst_texts == ("阿尔法", "")
