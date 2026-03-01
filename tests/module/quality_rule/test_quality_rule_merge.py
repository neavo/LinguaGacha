from typing import Any
from typing import cast

from module.QualityRule.QualityRuleMerger import QualityRuleMerger


def test_merge_glossary_overwrite_updates_existing_without_reordering() -> None:
    existing = [
        {
            "src": "HP",
            "dst": "旧值",
            "info": "old",
            "case_sensitive": False,
        },
        {
            "src": "MP",
            "dst": "魔力",
            "info": "",
            "case_sensitive": False,
        },
    ]
    incoming = [{"src": "  HP  ", "dst": "生命值", "info": "new"}]

    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=existing,
        incoming=incoming,
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert [v["src"] for v in merged] == ["HP", "MP"]
    assert merged[0]["dst"] == "生命值"
    assert merged[0]["info"] == "new"
    assert report.updated > 0


def test_merge_glossary_case_sensitive_allows_different_norms() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[{"src": "HP", "dst": "生命值", "case_sensitive": True}],
        incoming=[{"src": "hp", "dst": "hp", "case_sensitive": True}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert [v["src"] for v in merged] == ["HP", "hp"]
    assert report.deduped == 0


def test_merge_glossary_mixed_case_sensitive_collapses_to_one() -> None:
    merged, _ = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[{"src": "HP", "dst": "生命值", "case_sensitive": True}],
        incoming=[{"src": "hp", "dst": "血量", "case_sensitive": False}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert len(merged) == 1
    assert merged[0]["src"].casefold() == "hp"
    assert merged[0]["dst"] == "血量"
    assert merged[0]["case_sensitive"] is False


def test_merge_replacement_does_not_include_regex_in_key() -> None:
    merged, _ = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.PRE_REPLACEMENT,
        existing=[
            {
                "src": "ABC",
                "dst": "1",
                "regex": False,
                "case_sensitive": False,
            }
        ],
        incoming=[
            {
                "src": "abc",
                "dst": "2",
                "regex": True,
                "case_sensitive": False,
            }
        ],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert len(merged) == 1
    assert merged[0]["dst"] == "2"
    assert merged[0]["regex"] is True


def test_merge_text_preserve_dedupes_by_casefold() -> None:
    merged, _ = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.TEXT_PRESERVE,
        existing=[{"src": "foo", "info": "old"}],
        incoming=[{"src": "FOO", "info": "new"}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert len(merged) == 1
    assert merged[0]["src"].casefold() == "foo"
    assert merged[0]["info"] == "new"


def test_merge_drops_empty_src_entries() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[{"src": "   ", "dst": "X"}],
        incoming=[{"src": None, "dst": "Y"}, {"src": "A", "dst": "甲"}],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert merged == [
        {
            "src": "A",
            "dst": "甲",
            "info": "",
            "regex": False,
            "case_sensitive": False,
        }
    ]
    assert report.skipped_empty_src == 2


def test_merge_fill_empty_does_not_overwrite_non_empty_or_case_sensitive() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[
            {
                "src": "HP",
                "dst": "生命值",
                "info": "",
                "case_sensitive": True,
            }
        ],
        incoming=[
            {
                "src": "hp",
                "dst": "血量",
                "info": "new",
                "case_sensitive": False,
            }
        ],
        merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
    )

    assert len(merged) == 1
    assert merged[0]["dst"] == "生命值"
    assert merged[0]["case_sensitive"] is True
    assert report.filled == 1  # info 从空被补齐


def test_merge_defaults_to_overwrite_when_merge_mode_missing() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[{"src": "HP", "dst": "旧值", "info": "old"}],
        incoming=[{"src": "hp", "dst": "新值", "info": "new"}],
    )

    assert len(merged) == 1
    assert merged[0]["dst"] == "新值"
    assert report.updated == 1


def test_merge_skips_non_dict_entries_in_input() -> None:
    incoming = cast(
        list[dict[str, Any]],
        ["bad", {"src": "MP", "dst": "魔力"}],
    )

    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[{"src": "HP", "dst": "生命值"}],
        incoming=incoming,
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert [v["src"] for v in merged] == ["HP", "MP"]
    assert report.added == 1


def test_merge_fill_empty_for_text_preserve_only_fills_info() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.TEXT_PRESERVE,
        existing=[{"src": "Tag", "info": ""}],
        incoming=[{"src": "TAG", "info": "保留标签"}],
        merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
    )

    assert len(merged) == 1
    assert merged[0]["info"] == "保留标签"
    assert report.filled == 1
    assert report.updated == 0


def test_merge_fill_empty_for_pre_replacement_dedupes_same_src_norm() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.PRE_REPLACEMENT,
        existing=[
            {
                "src": "HP",
                "dst": "",
                "regex": True,
                "case_sensitive": True,
            },
            {
                "src": "HP",
                "dst": "旧值",
                "regex": False,
                "case_sensitive": True,
            },
        ],
        incoming=[
            {
                "src": "HP",
                "dst": "新值",
                "regex": False,
                "case_sensitive": True,
            }
        ],
        merge_mode=QualityRuleMerger.MergeMode.FILL_EMPTY,
    )

    assert len(merged) == 1
    assert merged[0]["src"] == "HP"
    assert merged[0]["dst"] == "旧值"
    assert merged[0]["regex"] is True
    assert report.deduped == 2
    assert report.filled == 1


def test_merge_overwrite_updates_in_same_src_norm_group() -> None:
    merged, report = QualityRuleMerger.merge(
        rule_type=QualityRuleMerger.RuleType.GLOSSARY,
        existing=[
            {
                "src": "HP",
                "dst": "旧值",
                "info": "old",
                "case_sensitive": True,
            },
            {
                "src": "HP",
                "dst": "新值",
                "info": "new",
                "case_sensitive": True,
            },
        ],
        incoming=[],
        merge_mode=QualityRuleMerger.MergeMode.OVERWRITE,
    )

    assert len(merged) == 1
    assert merged[0]["dst"] == "新值"
    assert report.updated == 1
    assert report.deduped == 1
