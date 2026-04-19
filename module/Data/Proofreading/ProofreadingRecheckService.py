from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Callable

from model.Item import Item
from module.ResultChecker import ResultChecker
from module.ResultChecker import ResultCheckItemSnapshot
from module.ResultChecker import WarningType


@dataclass(frozen=True)
class ProofreadingRecheckBatchResult:
    """批量校对重检结果。"""

    checker: ResultChecker
    warning_map: dict[int, list[WarningType]]
    failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]]
    applied_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]]


class ProofreadingRecheckService:
    """校对重检服务。

    这个服务只负责 `ResultChecker` 的构建、单条/批量警告重算与失败术语缓存，
    避免页面重复维护一套检查流程。
    """

    def __init__(
        self,
        checker_factory: Callable[[Any], ResultChecker] | None = None,
    ) -> None:
        if checker_factory is None:
            self.checker_factory = ResultChecker
        else:
            self.checker_factory = checker_factory

    def build_checker(self, config: Any) -> ResultChecker:
        """构建当前配置对应的检查器。"""

        return self.checker_factory(config)

    def check_item(
        self,
        config: Any,
        item: Item,
    ) -> tuple[list[WarningType], tuple[tuple[str, str], ...] | None]:
        """重检单条条目并返回警告与失败术语。"""

        snapshot = self.check_item_with_snapshot(config, item)
        failed_terms: tuple[tuple[str, str], ...] | None = None
        if snapshot.failed_glossary_terms:
            failed_terms = snapshot.failed_glossary_terms
        return list(snapshot.warnings), failed_terms

    def check_item_with_snapshot(
        self,
        config: Any,
        item: Item,
    ) -> ResultCheckItemSnapshot:
        """重检单条条目，并返回完整派生结果。"""

        checker = self.build_checker(config)
        collect_item_check_snapshot = getattr(
            checker,
            "collect_item_check_snapshot",
            None,
        )
        if callable(collect_item_check_snapshot):
            return collect_item_check_snapshot(item)

        warnings = checker.check_item(item)
        failed_terms: tuple[tuple[str, str], ...] = ()
        if WarningType.GLOSSARY in warnings:
            failed_terms = tuple(checker.get_failed_glossary_terms(item))
        return ResultCheckItemSnapshot(
            tuple(warnings),
            failed_terms,
            (),
        )

    def check_items(
        self,
        config: Any,
        items: list[Item],
    ) -> tuple[ResultChecker, dict[int, list[WarningType]]]:
        """批量重检条目并返回 warning_map。"""

        batch_result = self.check_items_with_caches(config, items)
        return batch_result.checker, batch_result.warning_map

    def check_items_with_caches(
        self,
        config: Any,
        items: list[Item],
    ) -> ProofreadingRecheckBatchResult:
        """批量重检条目，并同步产出失败/生效术语缓存。"""

        checker = self.build_checker(config)
        warning_map: dict[int, list[WarningType]]
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]]
        applied_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]]

        check_items_with_details = getattr(checker, "check_items_with_details", None)
        if callable(check_items_with_details):
            (
                warning_map,
                failed_terms_by_item_key,
                applied_terms_by_item_key,
            ) = check_items_with_details(items)
        else:
            warning_map = checker.check_items(items)
            failed_terms_by_item_key = self.build_failed_glossary_terms_cache(
                items,
                warning_map,
                checker,
            )
            applied_terms_by_item_key = {}

        return ProofreadingRecheckBatchResult(
            checker=checker,
            warning_map=warning_map,
            failed_terms_by_item_key=failed_terms_by_item_key,
            applied_terms_by_item_key=applied_terms_by_item_key,
        )

    def build_failed_glossary_terms_cache(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
    ) -> dict[int, tuple[tuple[str, str], ...]]:
        """根据 warning_map 构建失败术语缓存。"""

        if checker is None:
            return {}

        cache: dict[int, tuple[tuple[str, str], ...]] = {}
        for item in items:
            if WarningType.GLOSSARY not in warning_map.get(id(item), []):
                continue
            cache[id(item)] = tuple(checker.get_failed_glossary_terms(item))
        return cache
