from __future__ import annotations

from base.Base import Base
from module.Data.Core.Item import Item
from module.ResultChecker import WarningType


def build_item(
    *,
    item_id: int,
    src: str,
    dst: str,
    file_path: str,
    status: Base.ProjectStatus = Base.ProjectStatus.PROCESSED,
) -> Item:
    """构造最小条目对象，方便验证筛选与状态推导。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=status,
    )


def test_build_review_items_skips_empty_source_and_excluded_rows() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    review_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    items = [
        build_item(
            item_id=2,
            src="",
            dst="空行",
            file_path="script/b.txt",
        ),
        build_item(
            item_id=3,
            src="重复",
            dst="Duplicate",
            file_path="script/c.txt",
            status=Base.ProjectStatus.DUPLICATED,
        ),
        review_item,
    ]

    result = service.build_review_items(items)

    assert result == [review_item]


def test_filter_items_applies_warning_status_file_and_glossary_constraints() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    matched_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    skipped_item = build_item(
        item_id=2,
        src="旁白",
        dst="Narration",
        file_path="script/b.txt",
    )
    warning_map = {id(matched_item): [WarningType.GLOSSARY]}
    checker = type(
        "Checker",
        (),
        {
            "get_failed_glossary_terms": lambda self, item: (
                [("勇者", "Hero")] if item is matched_item else []
            ),
        },
    )()
    options = ProofreadingFilterOptions(
        warning_types={WarningType.GLOSSARY},
        statuses={Base.ProjectStatus.PROCESSED},
        file_paths={"script/a.txt"},
        glossary_terms={("勇者", "Hero")},
    )

    result = service.filter_items(
        items=[matched_item, skipped_item],
        warning_map=warning_map,
        options=options,
        checker=checker,
    )

    assert result == [matched_item]


def test_filter_items_uses_failed_term_cache_as_authoritative_source() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    glossary_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Narration",
        file_path="script/a.txt",
    )
    warning_map = {id(glossary_item): [WarningType.GLOSSARY]}

    class FailingChecker:
        def get_failed_glossary_terms(self, item: Item) -> list[tuple[str, str]]:
            raise AssertionError(f"不应该对 {item.get_id()} 回退逐条计算失败术语")

    options = ProofreadingFilterOptions(
        warning_types={WarningType.GLOSSARY},
        statuses={Base.ProjectStatus.PROCESSED},
        file_paths={"script/a.txt"},
        glossary_terms={("勇者", "Hero")},
    )

    result = service.filter_items(
        items=[glossary_item],
        warning_map=warning_map,
        options=options,
        checker=FailingChecker(),
        failed_terms_by_item_key={},
    )

    assert result == []


def test_filter_items_treats_all_selected_glossary_entries_as_no_filter() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    glossary_item_a = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    glossary_item_b = build_item(
        item_id=2,
        src="魔王が来た",
        dst="Demon King arrived",
        file_path="script/b.txt",
    )
    plain_item = build_item(
        item_id=3,
        src="旁白",
        dst="Narration",
        file_path="script/c.txt",
    )
    warning_map = {
        id(glossary_item_a): [WarningType.GLOSSARY],
        id(glossary_item_b): [WarningType.GLOSSARY],
    }
    options = ProofreadingFilterOptions(
        warning_types={
            WarningType.GLOSSARY,
            ProofreadingFilterOptions.NO_WARNING_TAG,
        },
        statuses={Base.ProjectStatus.PROCESSED},
        file_paths={"script/a.txt", "script/b.txt", "script/c.txt"},
        glossary_terms={("勇者", "Hero"), ("魔王", "Demon King")},
        include_without_glossary_miss=True,
    )

    result = service.filter_items(
        items=[glossary_item_a, glossary_item_b, plain_item],
        warning_map=warning_map,
        options=options,
        checker=None,
        failed_terms_by_item_key={
            id(glossary_item_a): (("勇者", "Hero"),),
            id(glossary_item_b): (("魔王", "Demon King"),),
        },
    )

    assert result == [glossary_item_a, glossary_item_b, plain_item]


def test_filter_items_keeps_only_selected_failed_glossary_terms() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    glossary_item_a = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    glossary_item_b = build_item(
        item_id=2,
        src="魔王が来た",
        dst="Demon King arrived",
        file_path="script/b.txt",
    )
    plain_item = build_item(
        item_id=3,
        src="旁白",
        dst="Narration",
        file_path="script/c.txt",
    )
    warning_map = {
        id(glossary_item_a): [WarningType.GLOSSARY],
        id(glossary_item_b): [WarningType.GLOSSARY],
    }
    options = ProofreadingFilterOptions(
        warning_types={
            WarningType.GLOSSARY,
            ProofreadingFilterOptions.NO_WARNING_TAG,
        },
        statuses={Base.ProjectStatus.PROCESSED},
        file_paths={"script/a.txt", "script/b.txt", "script/c.txt"},
        glossary_terms={("勇者", "Hero")},
        include_without_glossary_miss=False,
    )

    result = service.filter_items(
        items=[glossary_item_a, glossary_item_b, plain_item],
        warning_map=warning_map,
        options=options,
        checker=None,
        failed_terms_by_item_key={
            id(glossary_item_a): (("勇者", "Hero"),),
            id(glossary_item_b): (("魔王", "Demon King"),),
        },
    )

    assert result == [glossary_item_a]


def test_filter_items_keeps_only_rows_without_glossary_miss_when_requested() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()
    glossary_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    applied_item = build_item(
        item_id=2,
        src="守护者が来た",
        dst="Guardian arrived",
        file_path="script/b.txt",
    )
    plain_item = build_item(
        item_id=3,
        src="旁白",
        dst="Narration",
        file_path="script/c.txt",
    )
    warning_map = {
        id(glossary_item): [WarningType.GLOSSARY],
    }
    options = ProofreadingFilterOptions(
        warning_types={
            WarningType.GLOSSARY,
            ProofreadingFilterOptions.NO_WARNING_TAG,
        },
        statuses={Base.ProjectStatus.PROCESSED},
        file_paths={"script/a.txt", "script/b.txt", "script/c.txt"},
        glossary_terms=set(),
        include_without_glossary_miss=True,
    )

    result = service.filter_items(
        items=[glossary_item, applied_item, plain_item],
        warning_map=warning_map,
        options=options,
        checker=None,
        failed_terms_by_item_key={
            id(glossary_item): (("勇者", "Hero"),),
        },
    )

    assert result == [applied_item, plain_item]


def test_resolve_status_after_manual_edit_promotes_finished_rows() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterService,
    )

    service = ProofreadingFilterService()

    assert (
        service.resolve_status_after_manual_edit(
            Base.ProjectStatus.PROCESSED_IN_PAST,
            "新的译文",
        )
        == Base.ProjectStatus.PROCESSED
    )
    assert (
        service.resolve_status_after_manual_edit(
            Base.ProjectStatus.PROCESSED,
            "新的译文",
        )
        == Base.ProjectStatus.PROCESSED
    )
