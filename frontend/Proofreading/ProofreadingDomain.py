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

    该结构用于在 UI 与 Domain 之间传递筛选选项，并兼容旧版的 dict 结构。
    """

    KEY_WARNING_TYPES: ClassVar[str] = "warning_types"
    KEY_STATUSES: ClassVar[str] = "statuses"
    KEY_FILE_PATHS: ClassVar[str] = "file_paths"
    KEY_GLOSSARY_TERMS: ClassVar[str] = "glossary_terms"

    # 旧实现使用字符串标签表达“无警告”这一类；保持语义不变以避免存量数据/交互出现偏差。
    NO_WARNING_TAG: ClassVar[str] = "NO_WARNING"

    warning_types: set[WarningType | str] | None = None
    statuses: set[Base.ProjectStatus] | None = None
    file_paths: set[str] | None = None
    glossary_terms: set[tuple[str, str]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            self.KEY_WARNING_TYPES: self.warning_types,
            self.KEY_STATUSES: self.statuses,
            self.KEY_FILE_PATHS: self.file_paths,
            self.KEY_GLOSSARY_TERMS: self.glossary_terms,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProofreadingFilterOptions":
        if not data:
            return cls()

        warning_types = data.get(cls.KEY_WARNING_TYPES)
        statuses = data.get(cls.KEY_STATUSES)
        file_paths = data.get(cls.KEY_FILE_PATHS)
        glossary_terms = data.get(cls.KEY_GLOSSARY_TERMS)

        return cls(
            warning_types=set(warning_types) if warning_types is not None else None,
            statuses=set(statuses) if statuses is not None else None,
            file_paths=set(file_paths) if file_paths is not None else None,
            glossary_terms=set(glossary_terms) if glossary_terms is not None else None,
        )


class ProofreadingDomain:
    """Proofreading 的纯业务 Domain 层（不依赖 Qt）。

    设计目标：让筛选/默认选项构建/warning_map key 访问方式拥有唯一来源，
    避免 Page/Dialog/Table/EditPanel 各自复制一份规则导致的漂移。
    """

    DEFAULT_STATUSES: ClassVar[frozenset[Base.ProjectStatus]] = frozenset(
        {
            Base.ProjectStatus.NONE,
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.ERROR,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        }
    )

    @classmethod
    def normalize_filter_options(
        cls,
        options: ProofreadingFilterOptions | dict[str, Any] | None,
        items: list[Item],
    ) -> ProofreadingFilterOptions:
        resolved = (
            options
            if isinstance(options, ProofreadingFilterOptions)
            else ProofreadingFilterOptions.from_dict(options)
        )

        warning_types: set[WarningType | str]
        if resolved.warning_types is None:
            warning_types = set()
            warning_types.update(WarningType)
            warning_types.add(ProofreadingFilterOptions.NO_WARNING_TAG)
        else:
            warning_types = set(resolved.warning_types)

        statuses: set[Base.ProjectStatus]
        if resolved.statuses is None:
            statuses = set(cls.DEFAULT_STATUSES)
        else:
            statuses = set(resolved.statuses)

        file_paths: set[str]
        if resolved.file_paths is None:
            file_paths = {item.get_file_path() for item in items}
        else:
            file_paths = set(resolved.file_paths)

        glossary_terms: set[tuple[str, str]]
        if resolved.glossary_terms is None:
            glossary_terms = set()
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
        # warning_map 的 key 语义沿用 ResultChecker.check_items：以 id(item) 绑定“本次快照”。
        return id(item)

    @classmethod
    def get_item_warnings(
        cls,
        item: Item,
        warning_map: dict[int, list[WarningType]],
    ) -> list[WarningType]:
        return warning_map.get(cls.get_warning_key(item), [])

    @staticmethod
    def build_review_items(items_all: list[Item]) -> list[Item]:
        """构建可校对条目列表，避免结构行进入 UI。"""
        review_items: list[Item] = []
        for item in items_all:
            # 结构行需要保留用于导出，但不应进入校对列表。
            if not item.get_src().strip():
                continue
            if item.get_status() in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue
            review_items.append(item)
        return review_items

    @classmethod
    def build_default_filter_options(
        cls,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> ProofreadingFilterOptions:
        warning_types: set[WarningType | str] = set()
        warning_types.update(WarningType)
        warning_types.add(ProofreadingFilterOptions.NO_WARNING_TAG)

        file_paths = {item.get_file_path() for item in items}

        glossary_terms: set[tuple[str, str]] = set()
        if failed_terms_by_item_key is not None:
            for terms in failed_terms_by_item_key.values():
                glossary_terms.update(terms)
        elif checker is not None:
            for item in items:
                # 只有存在术语警告的条目才会产出失败术语明细，避免无意义扫描。
                if WarningType.GLOSSARY in cls.get_item_warnings(item, warning_map):
                    glossary_terms.update(checker.get_failed_glossary_terms(item))

        return ProofreadingFilterOptions(
            warning_types=warning_types,
            statuses=set(cls.DEFAULT_STATUSES),
            file_paths=file_paths,
            glossary_terms=glossary_terms,
        )

    @classmethod
    def filter_items(
        cls,
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
        resolved = cls.normalize_filter_options(options, items)
        warning_types = resolved.warning_types or set()
        statuses = resolved.statuses or set()
        file_paths = resolved.file_paths or set()
        glossary_terms = resolved.glossary_terms or set()

        search_pattern: re.Pattern[str] | None = None
        keyword_lower = ""
        if enable_search_filter and search_keyword:
            # UI 层负责给出更友好的 Toast；这里保持纯逻辑并在 regex 模式下直接编译。
            if search_is_regex:
                search_pattern = re.compile(search_keyword, re.IGNORECASE)
            else:
                keyword_lower = search_keyword.lower()

        filtered: list[Item] = []
        for item in items:
            # 规则跳过条目不需要校对，仅保留给用户可选查看的语言跳过。
            if item.get_status() in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue

            item_warnings = cls.get_item_warnings(item, warning_map)

            if item_warnings:
                if not any(w in warning_types for w in item_warnings):
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
                    item_key = cls.get_warning_key(item)
                    cached_terms = (
                        failed_terms_by_item_key.get(item_key)
                        if failed_terms_by_item_key is not None
                        else None
                    )
                    item_terms = (
                        cached_terms
                        if cached_terms is not None
                        else checker.get_failed_glossary_terms(item)
                    )
                    if glossary_terms:
                        if not any(term in glossary_terms for term in item_terms):
                            continue
                    else:
                        # 选择了术语警告但未选择任何术语时，保持现状：不展示任何术语条目。
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

    @classmethod
    def build_failed_glossary_terms_cache(
        cls,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        checker: ResultChecker | None,
    ) -> dict[int, tuple[tuple[str, str], ...]]:
        """构建 item_key -> failed_terms 缓存。

        该缓存用于 glossary term filter 与筛选对话框统计复用，避免重复调用
        ResultChecker.get_failed_glossary_terms() 扫描文本。
        """

        if checker is None:
            return {}

        cache: dict[int, tuple[tuple[str, str], ...]] = {}
        for item in items:
            if WarningType.GLOSSARY not in cls.get_item_warnings(item, warning_map):
                continue
            key = cls.get_warning_key(item)
            cache[key] = tuple(checker.get_failed_glossary_terms(item))
        return cache
