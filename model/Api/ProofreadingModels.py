from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


@dataclass(frozen=True)
class ProofreadingLookupQuery:
    """校对页反查请求冻结后传递，避免页面持有可变查询字典。"""

    keyword: str = ""
    is_regex: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把反查条件统一成稳定对象，避免前端分支解析。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            keyword=str(normalized.get("keyword", "")),
            is_regex=bool(normalized.get("is_regex", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把反查请求转回 JSON 字典，供边界层复用。"""

        return {
            "keyword": self.keyword,
            "is_regex": self.is_regex,
        }


@dataclass(frozen=True)
class ProofreadingFilterOptionsSnapshot:
    """校对页筛选选项冻结后传递，避免 UI 和 Domain 各自维护一套结构。"""

    warning_types: tuple[str, ...] = ()
    statuses: tuple[str, ...] = ()
    file_paths: tuple[str, ...] = ()
    glossary_terms: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把筛选选项统一归一化成不可变快照。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        warning_types_raw = normalized.get("warning_types", [])
        warning_types: tuple[str, ...] = ()
        if isinstance(warning_types_raw, (list, tuple, set)):
            warning_types = tuple(str(item) for item in warning_types_raw)

        statuses_raw = normalized.get("statuses", [])
        statuses: tuple[str, ...] = ()
        if isinstance(statuses_raw, (list, tuple, set)):
            statuses = tuple(str(item) for item in statuses_raw)

        file_paths_raw = normalized.get("file_paths", [])
        file_paths: tuple[str, ...] = ()
        if isinstance(file_paths_raw, (list, tuple, set)):
            file_paths = tuple(str(item) for item in file_paths_raw)

        glossary_terms_raw = normalized.get("glossary_terms", [])
        glossary_terms: tuple[tuple[str, str], ...] = ()
        if isinstance(glossary_terms_raw, (list, tuple, set)):
            normalized_terms: list[tuple[str, str]] = []
            for term in glossary_terms_raw:
                if isinstance(term, dict):
                    normalized_terms.append(
                        (str(term.get("src", "")), str(term.get("dst", "")))
                    )
                elif isinstance(term, (list, tuple)) and len(term) >= 2:
                    normalized_terms.append((str(term[0]), str(term[1])))
            glossary_terms = tuple(normalized_terms)

        return cls(
            warning_types=warning_types,
            statuses=statuses,
            file_paths=file_paths,
            glossary_terms=glossary_terms,
        )

    def to_dict(self) -> dict[str, Any]:
        """把筛选选项转回 JSON 字典，供 UI 与 Domain 复用。"""

        return {
            "warning_types": list(self.warning_types),
            "statuses": list(self.statuses),
            "file_paths": list(self.file_paths),
            "glossary_terms": [list(term) for term in self.glossary_terms],
        }


@dataclass(frozen=True)
class ProofreadingWarningSummary:
    """单种警告的汇总结果冻结后传递，避免前端重复计数。"""

    warning_type: str = ""
    count: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把警告统计统一转成轻量对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            warning_type=str(normalized.get("warning_type", "")),
            count=int(normalized.get("count", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        """把警告汇总转回 JSON 字典。"""

        return {
            "warning_type": self.warning_type,
            "count": self.count,
        }


@dataclass(frozen=True)
class ProofreadingItemView:
    """校对页条目视图冻结后再展示，避免页面继续操作源 Item。"""

    item_id: int = 0
    src: str = ""
    dst: str = ""
    status: str = ""
    file_path: str = ""
    warnings: tuple[str, ...] = ()
    failed_terms: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把条目行数据收口成前端只读视图。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        item_id_value = normalized.get("item_id", normalized.get("id", 0))
        warnings_raw = normalized.get("warnings", normalized.get("warning_types", []))
        warnings: tuple[str, ...] = ()
        if isinstance(warnings_raw, (list, tuple, set)):
            warnings = tuple(str(item) for item in warnings_raw)

        failed_terms_raw = normalized.get("failed_terms", [])
        failed_terms: tuple[tuple[str, str], ...] = ()
        if isinstance(failed_terms_raw, (list, tuple, set)):
            normalized_terms: list[tuple[str, str]] = []
            for term in failed_terms_raw:
                if isinstance(term, dict):
                    normalized_terms.append(
                        (str(term.get("src", "")), str(term.get("dst", "")))
                    )
                elif isinstance(term, (list, tuple)) and len(term) >= 2:
                    normalized_terms.append((str(term[0]), str(term[1])))
            failed_terms = tuple(normalized_terms)

        return cls(
            item_id=int(item_id_value or 0),
            src=str(normalized.get("src", "")),
            dst=str(normalized.get("dst", "")),
            status=str(normalized.get("status", "")),
            file_path=str(normalized.get("file_path", "")),
            warnings=warnings,
            failed_terms=failed_terms,
        )

    def to_dict(self) -> dict[str, Any]:
        """把条目视图转回 JSON 字典，保持边界层对象化。"""

        return {
            "item_id": self.item_id,
            "src": self.src,
            "dst": self.dst,
            "status": self.status,
            "file_path": self.file_path,
            "warnings": list(self.warnings),
            "failed_terms": [list(term) for term in self.failed_terms],
        }


@dataclass(frozen=True)
class ProofreadingSearchResult:
    """校对页搜索结果冻结后传递，避免页面继续维护匹配中间态。"""

    keyword: str = ""
    is_regex: bool = False
    matched_item_ids: tuple[int, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把搜索结果统一转成只读对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        matched_item_ids_raw = normalized.get("matched_item_ids", [])
        matched_item_ids: tuple[int, ...] = ()
        if isinstance(matched_item_ids_raw, (list, tuple, set)):
            matched_item_ids = tuple(int(item) for item in matched_item_ids_raw)

        return cls(
            keyword=str(normalized.get("keyword", "")),
            is_regex=bool(normalized.get("is_regex", False)),
            matched_item_ids=matched_item_ids,
        )

    def to_dict(self) -> dict[str, Any]:
        """把搜索结果转回 JSON 字典，供边界层复用。"""

        return {
            "keyword": self.keyword,
            "is_regex": self.is_regex,
            "matched_item_ids": list(self.matched_item_ids),
        }


@dataclass(frozen=True)
class ProofreadingMutationResult:
    """校对页写入结果冻结后传递，避免 UI 直接猜测写入态。"""

    success: bool = False
    changed_count: int = 0
    changed_item_ids: tuple[int, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把写入结果统一收敛成稳定对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        changed_item_ids_raw = normalized.get("changed_item_ids", [])
        changed_item_ids: tuple[int, ...] = ()
        if isinstance(changed_item_ids_raw, (list, tuple, set)):
            changed_item_ids = tuple(int(item) for item in changed_item_ids_raw)

        return cls(
            success=bool(normalized.get("success", False)),
            changed_count=int(normalized.get("changed_count", 0) or 0),
            changed_item_ids=changed_item_ids,
        )

    def to_dict(self) -> dict[str, Any]:
        """把写入结果转回 JSON 字典，保持边界层接口一致。"""

        return {
            "success": self.success,
            "changed_count": self.changed_count,
            "changed_item_ids": list(self.changed_item_ids),
        }


@dataclass(frozen=True)
class ProofreadingSnapshot:
    """校对页完整快照把查询、筛选、列表和结果统一冻结。"""

    revision: int = 0
    lookup_query: ProofreadingLookupQuery = field(
        default_factory=ProofreadingLookupQuery
    )
    items: tuple[ProofreadingItemView, ...] = ()
    filter_options: ProofreadingFilterOptionsSnapshot = field(
        default_factory=ProofreadingFilterOptionsSnapshot
    )
    warning_summaries: tuple[ProofreadingWarningSummary, ...] = ()
    search_result: ProofreadingSearchResult = field(
        default_factory=ProofreadingSearchResult
    )
    mutation_result: ProofreadingMutationResult = field(
        default_factory=ProofreadingMutationResult
    )

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把校对页响应统一转成不可变快照。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        lookup_query_raw = normalized.get("lookup_query", {})
        if isinstance(lookup_query_raw, ProofreadingLookupQuery):
            lookup_query = lookup_query_raw
        else:
            lookup_query = ProofreadingLookupQuery.from_dict(lookup_query_raw)

        items_raw = normalized.get("items", [])
        items: tuple[ProofreadingItemView, ...] = ()
        if isinstance(items_raw, (list, tuple)):
            normalized_items: list[ProofreadingItemView] = []
            for item in items_raw:
                if isinstance(item, ProofreadingItemView):
                    normalized_items.append(item)
                elif isinstance(item, dict):
                    normalized_items.append(ProofreadingItemView.from_dict(item))
            items = tuple(normalized_items)

        filter_options_raw = normalized.get("filter_options", {})
        if isinstance(filter_options_raw, ProofreadingFilterOptionsSnapshot):
            filter_options = filter_options_raw
        else:
            filter_options = ProofreadingFilterOptionsSnapshot.from_dict(
                filter_options_raw
            )

        warning_summaries_raw = normalized.get("warning_summaries", [])
        warning_summaries: tuple[ProofreadingWarningSummary, ...] = ()
        if isinstance(warning_summaries_raw, (list, tuple)):
            normalized_summaries: list[ProofreadingWarningSummary] = []
            for summary in warning_summaries_raw:
                if isinstance(summary, ProofreadingWarningSummary):
                    normalized_summaries.append(summary)
                elif isinstance(summary, dict):
                    normalized_summaries.append(
                        ProofreadingWarningSummary.from_dict(summary)
                    )
            warning_summaries = tuple(normalized_summaries)

        search_result_raw = normalized.get("search_result", {})
        if isinstance(search_result_raw, ProofreadingSearchResult):
            search_result = search_result_raw
        else:
            search_result = ProofreadingSearchResult.from_dict(search_result_raw)

        mutation_result_raw = normalized.get("mutation_result", {})
        if isinstance(mutation_result_raw, ProofreadingMutationResult):
            mutation_result = mutation_result_raw
        else:
            mutation_result = ProofreadingMutationResult.from_dict(mutation_result_raw)

        return cls(
            revision=int(normalized.get("revision", 0) or 0),
            lookup_query=lookup_query,
            items=items,
            filter_options=filter_options,
            warning_summaries=warning_summaries,
            search_result=search_result,
            mutation_result=mutation_result,
        )

    def to_dict(self) -> dict[str, Any]:
        """把校对页快照转换回 JSON 字典，保持客户端边界稳定。"""

        return {
            "revision": self.revision,
            "lookup_query": self.lookup_query.to_dict(),
            "items": [item.to_dict() for item in self.items],
            "filter_options": self.filter_options.to_dict(),
            "warning_summaries": [
                summary.to_dict() for summary in self.warning_summaries
            ],
            "search_result": self.search_result.to_dict(),
            "mutation_result": self.mutation_result.to_dict(),
        }
