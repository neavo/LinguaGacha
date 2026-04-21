from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Self


@dataclass(frozen=True)
class ProofreadingWarningSummary:
    """单种警告的汇总结果冻结后传递，避免前端重复计数。"""

    warning_type: str = ""
    count: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}
        return cls(
            warning_type=str(normalized.get("warning_type", "")),
            count=int(normalized.get("count", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "warning_type": self.warning_type,
            "count": self.count,
        }


@dataclass(frozen=True)
class ProofreadingSummary:
    """校对页摘要冻结后传递。"""

    total_items: int = 0
    filtered_items: int = 0
    warning_items: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}
        return cls(
            total_items=int(normalized.get("total_items", 0) or 0),
            filtered_items=int(normalized.get("filtered_items", 0) or 0),
            warning_items=int(normalized.get("warning_items", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
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
    applied_glossary_terms: tuple[tuple[str, str], ...] = ()
    failed_glossary_terms: tuple[tuple[str, str], ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}

        item_id = normalized.get("item_id", normalized.get("id", 0))
        row_number_value = normalized.get("row_number", normalized.get("row", 0))
        warnings_raw = normalized.get("warnings", normalized.get("warning_types", []))
        warnings: tuple[str, ...] = ()
        if isinstance(warnings_raw, (list, tuple, set)):
            warnings = tuple(str(item) for item in warnings_raw)

        applied_terms_raw = normalized.get("applied_glossary_terms", [])
        applied_glossary_terms: tuple[tuple[str, str], ...] = ()
        if isinstance(applied_terms_raw, (list, tuple, set)):
            normalized_applied_terms: list[tuple[str, str]] = []
            for term in applied_terms_raw:
                if isinstance(term, dict):
                    normalized_applied_terms.append(
                        (str(term.get("src", "")), str(term.get("dst", "")))
                    )
                elif isinstance(term, (list, tuple)) and len(term) >= 2:
                    normalized_applied_terms.append((str(term[0]), str(term[1])))
            applied_glossary_terms = tuple(normalized_applied_terms)

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
            applied_glossary_terms=applied_glossary_terms,
            failed_glossary_terms=failed_glossary_terms,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "file_path": self.file_path,
            "row_number": self.row_number,
            "src": self.src,
            "dst": self.dst,
            "status": self.status,
            "warnings": list(self.warnings),
            "applied_glossary_terms": [
                list(term) for term in self.applied_glossary_terms
            ],
            "failed_glossary_terms": [
                list(term) for term in self.failed_glossary_terms
            ],
        }


@dataclass(frozen=True)
class ProofreadingMutationResult:
    """校对页写入结果冻结后传递。"""

    revision: int = 0
    changed_item_ids: tuple[int | str, ...] = ()
    items: tuple[ProofreadingItemView, ...] = ()
    summary: ProofreadingSummary = field(default_factory=ProofreadingSummary)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        normalized = data if isinstance(data, dict) else {}

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
        return {
            "revision": self.revision,
            "changed_item_ids": list(self.changed_item_ids),
            "items": [item.to_dict() for item in self.items],
            "summary": self.summary.to_dict(),
        }
