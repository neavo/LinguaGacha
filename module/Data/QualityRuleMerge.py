from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class QualityRuleMergeKind(StrEnum):
    ADDED = "added"
    UPDATED = "updated"


@dataclass(frozen=True)
class QualityRuleMergeHit:
    src: str
    index: int
    kind: QualityRuleMergeKind


@dataclass(frozen=True)
class QualityRuleMergeReport:
    added: int
    updated: int
    skipped_empty_src: int
    hits: tuple[QualityRuleMergeHit, ...]


class QualityRuleMerge:
    """质量规则合并（默认覆盖）。

    约束：
    - 按 normalize(src) 合并
    - 覆盖时保持原条目在列表中的位置（避免影响顺序语义）
    """

    @staticmethod
    def normalize_src(src: Any) -> str:
        if not isinstance(src, str):
            return ""
        return src.strip()

    @staticmethod
    def normalize_entry(entry: dict[str, Any]) -> dict[str, Any]:
        src = QualityRuleMerge.normalize_src(entry.get("src"))
        return {
            "src": src,
            "dst": str(entry.get("dst", "")).strip(),
            "info": str(entry.get("info", "")).strip(),
            "regex": bool(entry.get("regex", False)),
            "case_sensitive": bool(entry.get("case_sensitive", False)),
        }

    @staticmethod
    def merge_overwrite(
        existing: list[dict[str, Any]], incoming: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], QualityRuleMergeReport]:
        merged: list[dict[str, Any]] = [dict(v) for v in existing]

        index_by_src: dict[str, int] = {}
        for i, entry in enumerate(merged):
            src = QualityRuleMerge.normalize_src(entry.get("src"))
            if not src:
                continue
            if src not in index_by_src:
                index_by_src[src] = i

        added = 0
        updated = 0
        skipped_empty = 0
        hits: list[QualityRuleMergeHit] = []

        for raw in incoming:
            if not isinstance(raw, dict):
                continue

            entry = QualityRuleMerge.normalize_entry(raw)
            src = entry.get("src", "")
            if not src:
                skipped_empty += 1
                continue

            if src in index_by_src:
                idx = index_by_src[src]
                # 覆盖但不改动顺序。
                merged[idx] = {
                    **merged[idx],
                    **entry,
                }
                updated += 1
                hits.append(
                    QualityRuleMergeHit(
                        src=src,
                        index=idx,
                        kind=QualityRuleMergeKind.UPDATED,
                    )
                )
                continue

            index_by_src[src] = len(merged)
            merged.append(entry)
            added += 1
            hits.append(
                QualityRuleMergeHit(
                    src=src,
                    index=len(merged) - 1,
                    kind=QualityRuleMergeKind.ADDED,
                )
            )

        report = QualityRuleMergeReport(
            added=added,
            updated=updated,
            skipped_empty_src=skipped_empty,
            hits=tuple(hits),
        )
        return merged, report
