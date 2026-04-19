from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

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
    """构造最小条目对象，方便验证重检与术语缓存。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=status,
    )


def test_check_item_returns_warnings_and_failed_terms_for_glossary_hit() -> None:
    from module.Data.Proofreading.ProofreadingRecheckService import (
        ProofreadingRecheckService,
    )

    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    fake_checker = SimpleNamespace(
        check_item=MagicMock(return_value=[WarningType.GLOSSARY]),
        get_failed_glossary_terms=MagicMock(return_value=[("勇者", "Hero")]),
    )
    service = ProofreadingRecheckService(checker_factory=lambda config: fake_checker)

    warnings, failed_terms = service.check_item(SimpleNamespace(), item)

    assert warnings == [WarningType.GLOSSARY]
    assert failed_terms == (("勇者", "Hero"),)
    fake_checker.check_item.assert_called_once_with(item)


def test_check_items_and_failed_term_cache_share_one_checker() -> None:
    from module.Data.Proofreading.ProofreadingRecheckService import (
        ProofreadingRecheckService,
    )

    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    fake_checker = SimpleNamespace(
        check_items=MagicMock(return_value={id(item): [WarningType.GLOSSARY]}),
        get_failed_glossary_terms=MagicMock(return_value=[("勇者", "Hero")]),
    )
    service = ProofreadingRecheckService(checker_factory=lambda config: fake_checker)

    checker, warning_map = service.check_items(SimpleNamespace(), [item])
    failed_terms = service.build_failed_glossary_terms_cache(
        [item],
        warning_map,
        checker,
    )

    assert checker is fake_checker
    assert warning_map == {id(item): [WarningType.GLOSSARY]}
    assert failed_terms == {id(item): (("勇者", "Hero"),)}
    fake_checker.check_items.assert_called_once()


def test_check_items_with_caches_returns_failed_and_applied_terms() -> None:
    from module.Data.Proofreading.ProofreadingRecheckService import (
        ProofreadingRecheckService,
    )

    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    fake_checker = SimpleNamespace(
        check_items_with_details=MagicMock(
            return_value=(
                {id(item): [WarningType.GLOSSARY]},
                {id(item): (("勇者", "Hero"),)},
                {id(item): (("勇者", "Hero"),)},
            )
        )
    )
    service = ProofreadingRecheckService(checker_factory=lambda config: fake_checker)

    result = service.check_items_with_caches(SimpleNamespace(), [item])

    assert result.checker is fake_checker
    assert result.warning_map == {id(item): [WarningType.GLOSSARY]}
    assert result.failed_terms_by_item_key == {id(item): (("勇者", "Hero"),)}
    assert result.applied_terms_by_item_key == {id(item): (("勇者", "Hero"),)}
