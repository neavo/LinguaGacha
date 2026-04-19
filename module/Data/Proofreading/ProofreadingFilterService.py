from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from typing import Callable
from typing import ClassVar

from base.Base import Base
from module.Data.Core.Item import Item
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
    KEY_INCLUDE_WITHOUT_GLOSSARY_MISS: ClassVar[str] = "include_without_glossary_miss"
    NO_WARNING_TAG: ClassVar[str] = "NO_WARNING"

    warning_types: set[WarningType | str] | None = None
    statuses: set[Base.ProjectStatus] | None = None
    file_paths: set[str] | None = None
    glossary_terms: set[tuple[str, str]] | None = None
    include_without_glossary_miss: bool | None = None

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
            glossary_terms = set()
            for term in glossary_terms_raw:
                if isinstance(term, dict):
                    glossary_terms.add(
                        (str(term.get("src", "")), str(term.get("dst", "")))
                    )
                elif isinstance(term, (list, tuple)) and len(term) >= 2:
                    glossary_terms.add((str(term[0]), str(term[1])))

        include_without_glossary_miss_raw = data.get(
            cls.KEY_INCLUDE_WITHOUT_GLOSSARY_MISS
        )
        include_without_glossary_miss: bool | None = None
        if include_without_glossary_miss_raw is not None:
            if isinstance(include_without_glossary_miss_raw, str):
                include_without_glossary_miss = (
                    include_without_glossary_miss_raw.strip().lower()
                    not in ("", "0", "false", "no", "off")
                )
            else:
                include_without_glossary_miss = bool(include_without_glossary_miss_raw)

        return cls(
            warning_types=warning_types,
            statuses=statuses,
            file_paths=file_paths,
            glossary_terms=glossary_terms,
            include_without_glossary_miss=include_without_glossary_miss,
        )

    def to_dict(self) -> dict[str, Any]:
        """把对象转回旧字典结构，方便边界层复用。"""

        return {
            self.KEY_WARNING_TYPES: self.warning_types,
            self.KEY_STATUSES: self.statuses,
            self.KEY_FILE_PATHS: self.file_paths,
            self.KEY_GLOSSARY_TERMS: self.glossary_terms,
            self.KEY_INCLUDE_WITHOUT_GLOSSARY_MISS: (
                self.include_without_glossary_miss
            ),
        }


@dataclass(frozen=True)
class ProofreadingFilterScanResult:
    """筛选扫描结果。"""

    items: tuple[Item, ...]
    filtered_item_count: int
    warning_item_count: int


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

        if resolved.include_without_glossary_miss is None:
            include_without_glossary_miss = True
        else:
            include_without_glossary_miss = resolved.include_without_glossary_miss

        return ProofreadingFilterOptions(
            warning_types=warning_types,
            statuses=statuses,
            file_paths=file_paths,
            glossary_terms=glossary_terms,
            include_without_glossary_miss=include_without_glossary_miss,
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

    def should_include_review_item_dict(self, item_dict: dict[str, Any]) -> bool:
        """用原始 dict 预筛校对页条目，避免无意义构造 Item 对象。"""

        src = str(item_dict.get("src", "") or "")
        if src.strip() == "":
            return False

        status_raw = item_dict.get("status")
        status_value = getattr(status_raw, "value", status_raw)
        return status_value not in (
            Base.ProjectStatus.DUPLICATED,
            Base.ProjectStatus.DUPLICATED.value,
            Base.ProjectStatus.RULE_SKIPPED,
            Base.ProjectStatus.RULE_SKIPPED.value,
        )

    def build_review_items_from_dicts(
        self,
        item_dicts: list[dict[str, Any]],
    ) -> list[Item]:
        """从原始 dict 列表构建校对页条目。"""

        review_items: list[Item] = []
        for item_dict in item_dicts:
            if not self.should_include_review_item_dict(item_dict):
                continue
            review_items.append(Item.from_dict(item_dict))
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
            include_without_glossary_miss=True,
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
            include_without_glossary_miss=base_options.include_without_glossary_miss,
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

        scan_result = self.scan_filtered_items(
            items,
            warning_map,
            options,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
            search_keyword=search_keyword,
            search_is_regex=search_is_regex,
            search_dst_only=search_dst_only,
            enable_search_filter=enable_search_filter,
            enable_glossary_term_filter=enable_glossary_term_filter,
        )
        return list(scan_result.items)

    def resolve_item_failed_glossary_terms(
        self,
        item: Item,
        item_warnings: list[WarningType],
        checker: ResultChecker | None,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None,
    ) -> tuple[tuple[str, str], ...]:
        """统一解析条目的失败术语，避免各调用点回退口径不一致。"""

        if WarningType.GLOSSARY not in item_warnings:
            return ()

        item_key = self.get_warning_key(item)
        if failed_terms_by_item_key is not None:
            return failed_terms_by_item_key.get(item_key, ())

        if checker is None:
            return ()

        return tuple(checker.get_failed_glossary_terms(item))

    def item_matches_filters(
        self,
        item: Item,
        item_warnings: list[WarningType],
        resolved: ProofreadingFilterOptions,
        checker: ResultChecker | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None,
        search_pattern: re.Pattern[str] | None,
        keyword_lower: str,
        search_keyword: str,
        search_dst_only: bool,
        enable_search_filter: bool,
        enable_glossary_term_filter: bool,
    ) -> bool:
        """判断单条条目是否命中过滤条件。"""

        warning_types = resolved.warning_types or set()
        statuses = resolved.statuses or set()
        file_paths = resolved.file_paths or set()
        glossary_terms = resolved.glossary_terms or set()
        include_without_glossary_miss = (
            resolved.include_without_glossary_miss is not False
        )

        if item_warnings:
            if not any(warning in warning_types for warning in item_warnings):
                return False
        else:
            if ProofreadingFilterOptions.NO_WARNING_TAG not in warning_types:
                return False

        if enable_glossary_term_filter:
            if WarningType.GLOSSARY in item_warnings:
                item_terms = self.resolve_item_failed_glossary_terms(
                    item,
                    item_warnings,
                    checker,
                    failed_terms_by_item_key,
                )
                if glossary_terms:
                    if not any(term in glossary_terms for term in item_terms):
                        return False
                else:
                    return False
            elif not include_without_glossary_miss:
                return False

        if item.get_status() not in statuses:
            return False
        if item.get_file_path() not in file_paths:
            return False

        if enable_search_filter and search_keyword:
            src = item.get_src()
            dst = item.get_dst()
            if search_pattern is not None:
                if search_dst_only:
                    if not search_pattern.search(dst):
                        return False
                elif not (search_pattern.search(src) or search_pattern.search(dst)):
                    return False
            elif keyword_lower:
                if search_dst_only:
                    if keyword_lower not in dst.lower():
                        return False
                elif (
                    keyword_lower not in src.lower()
                    and keyword_lower not in dst.lower()
                ):
                    return False

        return True

    def scan_filtered_items(
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
        collect_when: Callable[[Item], bool] | None = None,
    ) -> ProofreadingFilterScanResult:
        """单次扫描完成筛选摘要统计，并按需收集目标条目。"""

        resolved = self.normalize_filter_options(options, items)

        search_pattern: re.Pattern[str] | None = None
        keyword_lower = ""
        if enable_search_filter and search_keyword:
            if search_is_regex:
                search_pattern = re.compile(search_keyword, re.IGNORECASE)
            else:
                keyword_lower = search_keyword.lower()

        filtered: list[Item] = []
        filtered_item_count = 0
        warning_item_count = 0
        for item in items:
            if item.get_status() in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue

            item_warnings = self.get_item_warnings(item, warning_map)
            if not self.item_matches_filters(
                item,
                item_warnings,
                resolved,
                checker,
                failed_terms_by_item_key=failed_terms_by_item_key,
                search_pattern=search_pattern,
                keyword_lower=keyword_lower,
                search_keyword=search_keyword,
                search_dst_only=search_dst_only,
                enable_search_filter=enable_search_filter,
                enable_glossary_term_filter=enable_glossary_term_filter,
            ):
                continue

            filtered_item_count += 1
            if item_warnings:
                warning_item_count += 1
            if collect_when is None or collect_when(item):
                filtered.append(item)

        return ProofreadingFilterScanResult(
            items=tuple(filtered),
            filtered_item_count=filtered_item_count,
            warning_item_count=warning_item_count,
        )

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
