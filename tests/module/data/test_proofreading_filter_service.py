from __future__ import annotations

from base.Base import Base
from model.Item import Item
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
