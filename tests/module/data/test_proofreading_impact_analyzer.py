from __future__ import annotations

from types import SimpleNamespace

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Quality.ProofreadingImpactAnalyzer import (
    ProofreadingImpactAnalyzer,
)


def build_item(
    *,
    item_id: int,
    src: str,
    dst: str,
    file_path: str,
) -> Item:
    """构造最小 review 条目，方便验证 impact 命中范围。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=Base.ProjectStatus.PROCESSED,
    )


def build_analyzer(items: list[Item]) -> ProofreadingImpactAnalyzer:
    """构造最小数据管理器桩，只暴露 impact 分析真正依赖的能力。"""

    data_manager = SimpleNamespace(
        is_loaded=lambda: True,
        get_all_items=lambda: items,
        get_pre_replacement_enable=lambda: True,
        get_pre_replacement=lambda: [],
    )
    return ProofreadingImpactAnalyzer(data_manager)


def test_pre_replacement_case_sensitivity_change_counts_as_real_semantic_change() -> (
    None
):
    item = build_item(
        item_id=1,
        src="Hero arrives",
        dst="勇者来了",
        file_path="script/a.txt",
    )
    analyzer = build_analyzer([item])

    impact = analyzer.analyze_pre_replacement_update(
        review_items=[item],
        old_entries=[
            {
                "src": "hero",
                "dst": "勇者",
                "regex": False,
                "case_sensitive": True,
            }
        ],
        new_entries=[
            {
                "src": "hero",
                "dst": "勇者",
                "regex": False,
                "case_sensitive": False,
            }
        ],
        old_meta={"enabled": True},
        new_meta={"enabled": True},
    )

    assert impact is not None
    assert impact.scope == "entry"
    assert impact.item_ids == (1,)
    assert impact.rel_paths == ("script/a.txt",)


def test_pre_replacement_regex_rule_matches_source_with_runtime_semantics() -> None:
    item = build_item(
        item_id=3,
        src="FOO123",
        dst="示例",
        file_path="script/b.txt",
    )
    analyzer = build_analyzer([item])

    impact = analyzer.analyze_pre_replacement_update(
        review_items=[item],
        old_entries=[],
        new_entries=[
            {
                "src": r"foo\d+",
                "dst": "bar",
                "regex": True,
                "case_sensitive": False,
            }
        ],
        old_meta={"enabled": True},
        new_meta={"enabled": True},
    )

    assert impact is not None
    assert impact.scope == "entry"
    assert impact.item_ids == (3,)
    assert impact.rel_paths == ("script/b.txt",)


def test_post_replacement_impact_matches_against_original_dst_pattern() -> None:
    item = build_item(
        item_id=5,
        src="勇者来了",
        dst="The Hero arrives",
        file_path="script/c.txt",
    )
    analyzer = build_analyzer([item])

    impact = analyzer.analyze_post_replacement_update(
        review_items=[item],
        old_entries=[
            {
                "src": "Hero",
                "dst": "勇者",
                "regex": False,
                "case_sensitive": True,
            }
        ],
        new_entries=[
            {
                "src": "Hero",
                "dst": "勇士",
                "regex": False,
                "case_sensitive": True,
            }
        ],
        old_meta={"enabled": True},
        new_meta={"enabled": True},
    )

    assert impact is not None
    assert impact.scope == "entry"
    assert impact.item_ids == (5,)
    assert impact.rel_paths == ("script/c.txt",)
