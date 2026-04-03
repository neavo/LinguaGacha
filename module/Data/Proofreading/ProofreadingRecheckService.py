from __future__ import annotations

from typing import Any
from typing import Callable

from model.Item import Item
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType


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

        checker = self.build_checker(config)
        warnings = checker.check_item(item)
        failed_terms: tuple[tuple[str, str], ...] | None = None
        if WarningType.GLOSSARY in warnings:
            failed_terms = tuple(checker.get_failed_glossary_terms(item))
        return warnings, failed_terms

    def check_items(
        self,
        config: Any,
        items: list[Item],
    ) -> tuple[ResultChecker, dict[int, list[WarningType]]]:
        """批量重检条目并返回 warning_map。"""

        checker = self.build_checker(config)
        warning_map = checker.check_items(items)
        return checker, warning_map

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
