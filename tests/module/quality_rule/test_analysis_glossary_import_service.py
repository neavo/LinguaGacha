from types import SimpleNamespace
from typing import Any

from module.Data.Core.DataTypes import AnalysisGlossaryImportPreview
from module.Data.Core.DataTypes import AnalysisGlossaryImportPreviewEntry
from module.QualityRule.AnalysisGlossaryImportService import (
    AnalysisGlossaryImportService,
)
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics


def build_service(
    *,
    glossary: list[dict[str, Any]] | None = None,
    src_texts: tuple[str, ...] = (),
    dst_texts: tuple[str, ...] = (),
) -> AnalysisGlossaryImportService:
    quality_rule_service = SimpleNamespace(
        get_glossary=lambda: [dict(entry) for entry in glossary or []],
        collect_rule_statistics_texts=lambda: (src_texts, dst_texts),
    )
    return AnalysisGlossaryImportService(quality_rule_service)


def build_preview(
    *,
    entries: tuple[AnalysisGlossaryImportPreviewEntry, ...],
    statistics_results: dict[str, QualityRuleStatistics.RuleStatResult],
    subset_parents: dict[str, tuple[str, ...]],
) -> AnalysisGlossaryImportPreview:
    return AnalysisGlossaryImportPreview(
        merged_entries=tuple(dict(entry.entry) for entry in entries),
        report=QualityRuleMerger.Report(
            added=0,
            updated=0,
            filled=0,
            deduped=0,
            skipped_empty_src=0,
            conflicts=(),
        ),
        entries=entries,
        statistics_results=statistics_results,
        subset_parents=subset_parents,
    )


def test_build_preview_marks_existing_and_new_entries_with_shared_statistics() -> None:
    service = build_service(
        glossary=[
            {
                "src": "圣女艾琳",
                "dst": "Saint Erin",
                "info": "",
                "case_sensitive": False,
            }
        ],
        src_texts=("圣女艾琳登场", "艾琳祈祷"),
    )

    preview = service.build_preview(
        [
            {
                "src": " 艾琳 ",
                "dst": "Erin",
                "info": "",
                "case_sensitive": False,
            },
            {
                "src": "圣女艾琳",
                "dst": "",
                "info": "主角称号",
                "case_sensitive": False,
            },
        ]
    )

    assert preview.merged_entries == (
        {
            "src": "圣女艾琳",
            "dst": "Saint Erin",
            "info": "主角称号",
            "regex": False,
            "case_sensitive": False,
        },
        {
            "src": "艾琳",
            "dst": "Erin",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        },
    )
    assert preview.entries == (
        AnalysisGlossaryImportPreviewEntry(
            entry={
                "src": "圣女艾琳",
                "dst": "Saint Erin",
                "info": "主角称号",
                "regex": False,
                "case_sensitive": False,
            },
            statistics_key="圣女艾琳|0",
            is_new=False,
            incoming_indexes=(1,),
        ),
        AnalysisGlossaryImportPreviewEntry(
            entry={
                "src": "艾琳",
                "dst": "Erin",
                "info": "",
                "regex": False,
                "case_sensitive": False,
            },
            statistics_key="艾琳|0",
            is_new=True,
            incoming_indexes=(0,),
        ),
    )
    assert preview.statistics_results["圣女艾琳|0"].matched_item_count == 1
    assert preview.statistics_results["艾琳|0"].matched_item_count == 2
    assert preview.subset_parents == {"艾琳|0": ("圣女艾琳",)}


def test_build_preview_skips_entries_without_valid_statistics_key(
    monkeypatch,
) -> None:
    service = build_service()

    monkeypatch.setattr(
        QualityRuleMerger,
        "preview_merge",
        staticmethod(
            lambda **_kwargs: QualityRuleMerger.Preview(
                merged=(
                    {"src": "", "dst": "skip"},
                    {
                        "src": "Alice",
                        "dst": "爱丽丝",
                        "info": "",
                        "regex": False,
                        "case_sensitive": False,
                    },
                ),
                report=QualityRuleMerger.Report(
                    added=1,
                    updated=0,
                    filled=0,
                    deduped=0,
                    skipped_empty_src=0,
                    conflicts=(),
                ),
                entries=(
                    QualityRuleMerger.PreviewEntry(
                        entry={"src": "", "dst": "skip"},
                        is_new=True,
                        incoming_indexes=(0,),
                    ),
                    QualityRuleMerger.PreviewEntry(
                        entry={
                            "src": "Alice",
                            "dst": "爱丽丝",
                            "info": "",
                            "regex": False,
                            "case_sensitive": False,
                        },
                        is_new=True,
                        incoming_indexes=(1,),
                    ),
                ),
            )
        ),
    )

    preview = service.build_preview([{"src": "", "dst": "skip"}])

    assert preview.entries == (
        AnalysisGlossaryImportPreviewEntry(
            entry={
                "src": "Alice",
                "dst": "爱丽丝",
                "info": "",
                "regex": False,
                "case_sensitive": False,
            },
            statistics_key="Alice|0",
            is_new=True,
            incoming_indexes=(1,),
        ),
    )
    assert preview.merged_entries[0]["src"] == ""
    assert preview.subset_parents == {}


def test_filter_candidates_drops_new_entries_that_only_match_once() -> None:
    service = build_service()
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "Alice", "dst": "爱丽丝"},
                statistics_key="Alice|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "Alice|0": QualityRuleStatistics.RuleStatResult(matched_item_count=1)
        },
        subset_parents={},
    )

    assert (
        service.filter_candidates(
            [{"src": "Alice", "dst": "爱丽丝"}],
            preview,
        )
        == []
    )


def test_filter_candidates_ignores_entries_without_src_and_keeps_unfiltered_rows() -> (
    None
):
    service = build_service()
    glossary_entries = [
        {"src": "保留项", "dst": "Keep"},
        {"src": "Alice", "dst": "爱丽丝"},
    ]
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "", "dst": "ignore"},
                statistics_key="blank|0",
                is_new=False,
                incoming_indexes=(),
            ),
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "Alice", "dst": "爱丽丝"},
                statistics_key="Alice|0",
                is_new=True,
                incoming_indexes=(1,),
            ),
        ),
        statistics_results={},
        subset_parents={},
    )

    assert service.filter_candidates(glossary_entries, preview) == [
        {"src": "保留项", "dst": "Keep"}
    ]


def test_filter_candidates_keeps_control_code_self_mapping_even_when_match_is_low() -> (
    None
):
    service = build_service()
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "\\n[7]", "dst": "\\n[7]"},
                statistics_key="\\n[7]|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "\\n[7]|0": QualityRuleStatistics.RuleStatResult(matched_item_count=1)
        },
        subset_parents={},
    )

    assert service.filter_candidates(
        [{"src": "\\n[7]", "dst": "\\n[7]"}],
        preview,
    ) == [{"src": "\\n[7]", "dst": "\\n[7]"}]


def test_filter_candidates_skips_blank_child_src_even_when_match_count_is_high() -> (
    None
):
    service = build_service()
    glossary_entries = [{"src": "", "dst": "ignore"}]
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "", "dst": "ignore"},
                statistics_key="blank|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "blank|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2)
        },
        subset_parents={},
    )

    result = service.filter_candidates(glossary_entries, preview)

    assert result == glossary_entries
    assert result[0] is not glossary_entries[0]


def test_filter_candidates_drops_child_when_longer_parent_hits_same_items() -> None:
    service = build_service()
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "圣女艾琳", "dst": "Saint Erin"},
                statistics_key="圣女艾琳|0",
                is_new=False,
                incoming_indexes=(),
            ),
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "艾琳", "dst": "Erin"},
                statistics_key="艾琳|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "圣女艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2),
            "艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2),
        },
        subset_parents={"艾琳|0": ("圣女艾琳",)},
    )

    assert (
        service.filter_candidates(
            [{"src": "艾琳", "dst": "Erin"}],
            preview,
        )
        == []
    )


def test_filter_candidates_keeps_child_when_parent_key_is_missing() -> None:
    service = build_service()
    glossary_entries = [{"src": "艾琳", "dst": "Erin"}]
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "艾琳", "dst": "Erin"},
                statistics_key="艾琳|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2)
        },
        subset_parents={"艾琳|0": ("未知父项",)},
    )

    result = service.filter_candidates(glossary_entries, preview)

    assert result == glossary_entries
    assert result[0] is not glossary_entries[0]


def test_filter_candidates_keeps_child_when_parent_hit_count_is_different() -> None:
    service = build_service()
    glossary_entries = [{"src": "艾琳", "dst": "Erin"}]
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "圣女艾琳", "dst": "Saint Erin"},
                statistics_key="圣女艾琳|0",
                is_new=False,
                incoming_indexes=(),
            ),
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "艾琳", "dst": "Erin"},
                statistics_key="艾琳|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "圣女艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=3),
            "艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2),
        },
        subset_parents={"艾琳|0": ("圣女艾琳",)},
    )

    result = service.filter_candidates(glossary_entries, preview)

    assert result == glossary_entries
    assert result[0] is not glossary_entries[0]


def test_filter_candidates_keeps_child_when_parent_text_is_shorter() -> None:
    service = build_service()
    glossary_entries = [{"src": "艾琳", "dst": "Erin"}]
    preview = build_preview(
        entries=(
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "琳", "dst": "Lin"},
                statistics_key="琳|0",
                is_new=False,
                incoming_indexes=(),
            ),
            AnalysisGlossaryImportPreviewEntry(
                entry={"src": "艾琳", "dst": "Erin"},
                statistics_key="艾琳|0",
                is_new=True,
                incoming_indexes=(0,),
            ),
        ),
        statistics_results={
            "琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2),
            "艾琳|0": QualityRuleStatistics.RuleStatResult(matched_item_count=2),
        },
        subset_parents={"艾琳|0": ("琳",)},
    )

    result = service.filter_candidates(glossary_entries, preview)

    assert result == glossary_entries
    assert result[0] is not glossary_entries[0]
