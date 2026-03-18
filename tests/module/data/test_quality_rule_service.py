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
    cached_rules: dict[object, list[dict[str, object]]] = {}
    cached_texts: dict[object, str] = {}
    rule_service = SimpleNamespace(
        get_rules_cached=MagicMock(
            side_effect=lambda rule_type: list(cached_rules.get(rule_type, []))
        ),
        set_rules_cached=MagicMock(
            side_effect=lambda rule_type, data, save=True: cached_rules.__setitem__(
                rule_type,
                list(data),
            )
        ),
        get_rule_text_cached=MagicMock(
            side_effect=lambda rule_type: cached_texts.get(rule_type, "")
        ),
        set_rule_text_cached=MagicMock(
            side_effect=lambda rule_type, text: cached_texts.__setitem__(
                rule_type, text
            )
        ),
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


def test_merge_glossary_incoming_saves_when_report_has_changes() -> None:
    service = build_service()
    service.get_glossary = MagicMock(return_value=[{"src": "A", "dst": ""}])
    service.set_glossary = MagicMock()
    changed_report = QualityRuleMerger.Report(
        added=0,
        updated=0,
        filled=1,
        deduped=0,
        skipped_empty_src=0,
        conflicts=(),
    )
    original_merge = QualityRuleMerger.merge
    QualityRuleMerger.merge = MagicMock(
        return_value=([{"src": "A", "dst": "B"}], changed_report)
    )
    try:
        merged, report = service.merge_glossary_incoming(
            incoming=[{"src": "A", "dst": "B"}],
            merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
            save=True,
        )
    finally:
        QualityRuleMerger.merge = original_merge

    assert merged == [{"src": "A", "dst": "B"}]
    assert report == changed_report
    service.set_glossary.assert_called_once_with([{"src": "A", "dst": "B"}], save=True)


def test_text_preserve_mode_normalizes_invalid_to_smart_or_off() -> None:
    service = build_service()

    assert service.get_text_preserve_mode() == TextPreserveMode.SMART
    assert service.set_text_preserve_mode("invalid") == TextPreserveMode.OFF


def test_rule_and_prompt_helpers_delegate_to_matching_rule_types() -> None:
    service = build_service()

    service.set_text_preserve([{"src": "HP", "dst": "生命值"}])
    service.set_pre_replacement([{"src": "A", "dst": "甲"}])
    service.set_post_replacement([{"src": "B", "dst": "乙"}])
    service.set_translation_prompt("translate")
    service.set_analysis_prompt("analyze")

    assert service.get_text_preserve() == [
        {
            "src": "HP",
            "dst": "生命值",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        }
    ]
    assert service.get_pre_replacement() == [
        {
            "src": "A",
            "dst": "甲",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        }
    ]
    assert service.get_post_replacement() == [
        {
            "src": "B",
            "dst": "乙",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        }
    ]
    assert service.get_translation_prompt() == "translate"
    assert service.get_analysis_prompt() == "analyze"


def test_normalize_quality_rules_for_write_passthroughs_unknown_rule_type() -> None:
    service = build_service()
    raw_rules = [{"src": "A", "dst": "B"}]

    normalized = service.normalize_quality_rules_for_write(
        SimpleNamespace(value="UNKNOWN_RULE"),
        raw_rules,
    )

    assert normalized == raw_rules


def test_boolean_meta_helpers_roundtrip() -> None:
    service = build_service()

    service.set_glossary_enable(0)
    service.set_pre_replacement_enable("yes")
    service.set_post_replacement_enable("")
    service.set_translation_prompt_enable(1)
    service.set_analysis_prompt_enable([])

    assert service.get_glossary_enable() is False
    assert service.get_pre_replacement_enable() is True
    assert service.get_post_replacement_enable() is False
    assert service.get_translation_prompt_enable() is True
    assert service.get_analysis_prompt_enable() is False


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
