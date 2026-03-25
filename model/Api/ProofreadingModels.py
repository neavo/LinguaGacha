from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


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
class ProofreadingSummary:
    """校对页摘要冻结后传递，避免页面自己拼总数。"""

    total_items: int = 0
    filtered_items: int = 0
    warning_items: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把摘要统一转成稳定对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            total_items=int(normalized.get("total_items", 0) or 0),
            filtered_items=int(normalized.get("filtered_items", 0) or 0),
            warning_items=int(normalized.get("warning_items", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        """把摘要转回 JSON 字典，供边界层复用。"""

        return {
            "total_items": self.total_items,
            "filtered_items": self.filtered_items,
            "warning_items": self.warning_items,
        }


@dataclass(frozen=True)
class ProofreadingItemView:
    """校对页条目视图冻结后再展示，避免页面继续操作源 Item。"""

    item_id: int | str = 0
    file_path: str = ""
    row_number: int = 0
    src: str = ""
    dst: str = ""
    status: str = ""
    warnings: tuple[str, ...] = ()
    failed_glossary_terms: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把条目行数据收口成前端只读视图。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        item_id = normalized.get("item_id", normalized.get("id", 0))
        row_number_value = normalized.get("row_number", normalized.get("row", 0))
        warnings_raw = normalized.get("warnings", normalized.get("warning_types", []))
        warnings: tuple[str, ...] = ()
        if isinstance(warnings_raw, (list, tuple, set)):
            warnings = tuple(str(item) for item in warnings_raw)

        failed_terms_raw = normalized.get("failed_glossary_terms", [])
        failed_glossary_terms: tuple[tuple[str, str], ...] = ()
        if isinstance(failed_terms_raw, (list, tuple, set)):
            normalized_terms: list[tuple[str, str]] = []
            for term in failed_terms_raw:
                if isinstance(term, dict):
                    normalized_terms.append(
                        (str(term.get("src", "")), str(term.get("dst", "")))
                    )
                elif isinstance(term, (list, tuple)) and len(term) >= 2:
                    normalized_terms.append((str(term[0]), str(term[1])))
            failed_glossary_terms = tuple(normalized_terms)

        return cls(
            item_id=item_id,
            file_path=str(normalized.get("file_path", "")),
            row_number=int(row_number_value or 0),
            src=str(normalized.get("src", "")),
            dst=str(normalized.get("dst", "")),
            status=str(normalized.get("status", "")),
            warnings=warnings,
            failed_glossary_terms=failed_glossary_terms,
        )

    def to_dict(self) -> dict[str, Any]:
        """把条目视图转回 JSON 字典，保持边界层对象化。"""

        return {
            "item_id": self.item_id,
            "file_path": self.file_path,
            "row_number": self.row_number,
            "src": self.src,
            "dst": self.dst,
            "status": self.status,
            "warnings": list(self.warnings),
            "failed_glossary_terms": [
                list(term) for term in self.failed_glossary_terms
            ],
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

    revision: int = 0
    changed_item_ids: tuple[int | str, ...] = ()
    items: tuple[ProofreadingItemView, ...] = ()
    summary: ProofreadingSummary = field(default_factory=ProofreadingSummary)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把写入结果统一收敛成稳定对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        changed_item_ids_raw = normalized.get("changed_item_ids", [])
        changed_item_ids: tuple[int | str, ...] = ()
        if isinstance(changed_item_ids_raw, (list, tuple, set)):
            changed_item_ids = tuple(item for item in changed_item_ids_raw)

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

        summary_raw = normalized.get("summary", {})
        if isinstance(summary_raw, ProofreadingSummary):
            summary = summary_raw
        else:
            summary = ProofreadingSummary.from_dict(summary_raw)

        return cls(
            revision=int(normalized.get("revision", 0) or 0),
            changed_item_ids=changed_item_ids,
            items=items,
            summary=summary,
        )

    def to_dict(self) -> dict[str, Any]:
        """把写入结果转回 JSON 字典，保持边界层接口一致。"""

        return {
            "revision": self.revision,
            "changed_item_ids": list(self.changed_item_ids),
            "items": [item.to_dict() for item in self.items],
            "summary": self.summary.to_dict(),
        }


@dataclass(frozen=True)
class ProofreadingSnapshot:
    """校对页完整快照把摘要、筛选和条目列表统一冻结。"""

    revision: int = 0
    project_id: str = ""
    readonly: bool = False
    summary: ProofreadingSummary = field(default_factory=ProofreadingSummary)
    filters: ProofreadingFilterOptionsSnapshot = field(
        default_factory=ProofreadingFilterOptionsSnapshot
    )
    items: tuple[ProofreadingItemView, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把校对页响应统一转成不可变快照。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        project_id = str(normalized.get("project_id", ""))
        readonly = bool(normalized.get("readonly", False))

        summary_raw = normalized.get("summary", {})
        if isinstance(summary_raw, ProofreadingSummary):
            summary = summary_raw
        else:
            summary = ProofreadingSummary.from_dict(summary_raw)

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

        filters_raw = normalized.get("filters", normalized.get("filter_options", {}))
        if isinstance(filters_raw, ProofreadingFilterOptionsSnapshot):
            filters = filters_raw
        else:
            filters = ProofreadingFilterOptionsSnapshot.from_dict(filters_raw)

        return cls(
            revision=int(normalized.get("revision", 0) or 0),
            project_id=project_id,
            readonly=readonly,
            summary=summary,
            filters=filters,
            items=items,
        )

    def to_dict(self) -> dict[str, Any]:
        """把校对页快照转换回 JSON 字典，保持客户端边界稳定。"""

        return {
            "revision": self.revision,
            "project_id": self.project_id,
            "readonly": self.readonly,
            "summary": self.summary.to_dict(),
            "filters": self.filters.to_dict(),
            "items": [item.to_dict() for item in self.items],
        }

    @property
    def filter_options(self) -> ProofreadingFilterOptionsSnapshot:
        """保留旧属性别名，避免迁移期间的读取方立刻断裂。"""

        return self.filters
