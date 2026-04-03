from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from typing import ClassVar

from base.Base import Base
from model.Item import Item
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType


@dataclass
class ProofreadingFilterOptions:
    """校对页筛选选项快照。

    这个对象只负责在前端与 core 之间传递筛选条件，避免各层各自维护一份结构。
    """

    KEY_WARNING_TYPES: ClassVar[str] = "warning_types"
    KEY_STATUSES: ClassVar[str] = "statuses"
    KEY_FILE_PATHS: ClassVar[str] = "file_paths"
    KEY_GLOSSARY_TERMS: ClassVar[str] = "glossary_terms"
    NO_WARNING_TAG: ClassVar[str] = "NO_WARNING"

    warning_types: set[WarningType | str] | None = None
    statuses: set[Base.ProjectStatus] | None = None
    file_paths: set[str] | None = None
    glossary_terms: set[tuple[str, str]] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProofreadingFilterOptions":
        """把旧字典结构收口成稳定对象。"""

        if not data:
            return cls()

        warning_types_raw = data.get(cls.KEY_WARNING_TYPES)
        statuses_raw = data.get(cls.KEY_STATUSES)
        file_paths_raw = data.get(cls.KEY_FILE_PATHS)
        glossary_terms_raw = data.get(cls.KEY_GLOSSARY_TERMS)

        warning_types: set[WarningType | str] | None = None
        if warning_types_raw is not None:
            warning_types = set(warning_types_raw)

        statuses: set[Base.ProjectStatus] | None = None
        if statuses_raw is not None:
            statuses = set(statuses_raw)

        file_paths: set[str] | None = None
        if file_paths_raw is not None:
            file_paths = set(file_paths_raw)

        glossary_terms: set[tuple[str, str]] | None = None
        if glossary_terms_raw is not None:
            glossary_terms = set(glossary_terms_raw)

        return cls(
            warning_types=warning_types,
            statuses=statuses,
            file_paths=file_paths,
            glossary_terms=glossary_terms,
        )

    def to_dict(self) -> dict[str, Any]:
        """把对象转回旧字典结构，方便边界层复用。"""

        return {
            self.KEY_WARNING_TYPES: self.warning_types,
            self.KEY_STATUSES: self.statuses,
            self.KEY_FILE_PATHS: self.file_paths,
            self.KEY_GLOSSARY_TERMS: self.glossary_terms,
        }


class ProofreadingFilterService:
    """校对页纯业务筛选服务。

    这个服务吸收了原来 `ProofreadingDomain` 里的筛选、搜索与术语缓存逻辑，
    让前端 helper 只保留转发壳。
    """

    DEFAULT_STATUSES: ClassVar[frozenset[Base.ProjectStatus]] = frozenset(
        {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }
    )

    def resolve_status_after_manual_edit(
        self,
        old_status: Base.ProjectStatus,
        new_dst: str,
    ) -> Base.ProjectStatus:
        """计算人工编辑后的目标状态。"""

        if old_status == Base.ProjectStatus.PROCESSED_IN_PAST:
            return Base.ProjectStatus.PROCESSED

        if not new_dst:
            return old_status

        if old_status == Base.ProjectStatus.PROCESSED:
            return old_status

        return Base.ProjectStatus.PROCESSED

    def normalize_filter_options(
        self,
        options: ProofreadingFilterOptions | dict[str, Any] | None,
        items: list[Item],
    ) -> ProofreadingFilterOptions:
        """把外部筛选条件统一归一化。"""

        if isinstance(options, ProofreadingFilterOptions):
            resolved = options
        else:
            resolved = ProofreadingFilterOptions.from_dict(options)

        if resolved.warning_types is None:
            warning_types: set[WarningType | str] = set(WarningType)
            warning_types.add(ProofreadingFilterOptions.NO_WARNING_TAG)
        else:
            warning_types = set(resolved.warning_types)

        if resolved.statuses is None:
            statuses: set[Base.ProjectStatus] = set(self.DEFAULT_STATUSES)
        else:
            statuses = set(resolved.statuses)

        if resolved.file_paths is None:
            file_paths: set[str] = {item.get_file_path() for item in items}
        else:
            file_paths = set(resolved.file_paths)

        if resolved.glossary_terms is None:
            glossary_terms: set[tuple[str, str]] = set()
        else:
            glossary_terms = set(resolved.glossary_terms)

        return ProofreadingFilterOptions(
            warning_types=warning_types,
            statuses=statuses,
            file_paths=file_paths,
            glossary_terms=glossary_terms,
        )

    @staticmethod
    def get_warning_key(item: Item) -> int:
        """把 warning_map key 固定为 `id(item)`，保证单次快照一致。"""

        return id(item)

    def get_item_warnings(
        self,
        item: Item,
        warning_map: dict[int, list[WarningType]],
    ) -> list[WarningType]:
        """从 warning_map 中读取当前条目的警告。"""

        return warning_map.get(self.get_warning_key(item), [])

    def build_review_items(self, items_all: list[Item]) -> list[Item]:
        """构建可进入校对页的条目列表。"""

        review_items: list[Item] = []
        for item in items_all:
            if not item.get_src().strip():
                continue
            if item.get_status() in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue
            review_items.append(item)
        return review_items

    def build_default_filter_options(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> ProofreadingFilterOptions:
        """构建默认筛选条件，避免 UI 自己拼默认值。"""

        warning_types: set[WarningType | str] = set(WarningType)
        warning_types.add(ProofreadingFilterOptions.NO_WARNING_TAG)
        file_paths = {item.get_file_path() for item in items}

        glossary_terms: set[tuple[str, str]] = set()
        if failed_terms_by_item_key is not None:
            for terms in failed_terms_by_item_key.values():
                glossary_terms.update(terms)
        elif checker is not None:
            for item in items:
                if WarningType.GLOSSARY in self.get_item_warnings(item, warning_map):
                    glossary_terms.update(checker.get_failed_glossary_terms(item))

        return ProofreadingFilterOptions(
            warning_types=warning_types,
            statuses=set(self.DEFAULT_STATUSES),
            file_paths=file_paths,
            glossary_terms=glossary_terms,
        )

    def build_lookup_filter_options(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> ProofreadingFilterOptions:
        """构建规则反查时的全开筛选，避免结果被默认条件藏起来。"""

        base_options = self.build_default_filter_options(
            items,
            warning_map,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
        )
        statuses = {item.get_status() for item in items}
        if not statuses:
            statuses = set(self.DEFAULT_STATUSES)

        return ProofreadingFilterOptions(
            warning_types=set(base_options.warning_types or set()),
            statuses=statuses,
            file_paths=set(base_options.file_paths or set()),
            glossary_terms=set(base_options.glossary_terms or set()),
        )

    def filter_items(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        options: ProofreadingFilterOptions | dict[str, Any] | None,
        checker: ResultChecker | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
        search_keyword: str = "",
        search_is_regex: bool = False,
        search_dst_only: bool = False,
        enable_search_filter: bool = False,
        enable_glossary_term_filter: bool = True,
    ) -> list[Item]:
        """按筛选、搜索与术语条件过滤条目。"""

        resolved = self.normalize_filter_options(options, items)
        warning_types = resolved.warning_types or set()
        statuses = resolved.statuses or set()
        file_paths = resolved.file_paths or set()
        glossary_terms = resolved.glossary_terms or set()

        search_pattern: re.Pattern[str] | None = None
        keyword_lower = ""
        if enable_search_filter and search_keyword:
            if search_is_regex:
                search_pattern = re.compile(search_keyword, re.IGNORECASE)
            else:
                keyword_lower = search_keyword.lower()

        filtered: list[Item] = []
        for item in items:
            if item.get_status() in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue

            item_warnings = self.get_item_warnings(item, warning_map)
            if item_warnings:
                if not any(warning in warning_types for warning in item_warnings):
                    continue
            else:
                if ProofreadingFilterOptions.NO_WARNING_TAG not in warning_types:
                    continue

            if enable_glossary_term_filter:
                if (
                    checker is not None
                    and WarningType.GLOSSARY in item_warnings
                    and WarningType.GLOSSARY in warning_types
                ):
                    item_key = self.get_warning_key(item)
                    if failed_terms_by_item_key is not None:
                        item_terms = failed_terms_by_item_key.get(item_key)
                    else:
                        item_terms = None

                    if item_terms is None:
                        item_terms = tuple(checker.get_failed_glossary_terms(item))

                    if glossary_terms:
                        if not any(term in glossary_terms for term in item_terms):
                            continue
                    else:
                        continue

            if item.get_status() not in statuses:
                continue
            if item.get_file_path() not in file_paths:
                continue

            if enable_search_filter and search_keyword:
                src = item.get_src()
                dst = item.get_dst()
                if search_pattern is not None:
                    if search_dst_only:
                        if not search_pattern.search(dst):
                            continue
                    elif not (search_pattern.search(src) or search_pattern.search(dst)):
                        continue
                elif keyword_lower:
                    if search_dst_only:
                        if keyword_lower not in dst.lower():
                            continue
                    elif (
                        keyword_lower not in src.lower()
                        and keyword_lower not in dst.lower()
                    ):
                        continue

            filtered.append(item)

        return filtered

    def build_failed_glossary_terms_cache(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
    ) -> dict[int, tuple[tuple[str, str], ...]]:
        """构建条目到失败术语的缓存。"""

        if checker is None:
            return {}

        cache: dict[int, tuple[tuple[str, str], ...]] = {}
        for item in items:
            if WarningType.GLOSSARY not in self.get_item_warnings(item, warning_map):
                continue
            cache[self.get_warning_key(item)] = tuple(
                checker.get_failed_glossary_terms(item)
            )
        return cache
