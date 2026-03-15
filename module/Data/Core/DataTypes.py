from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from model.Item import Item
from module.QualityRule.QualityRuleMerger import QualityRuleMerger
from module.QualityRule.QualityRuleStatistics import QualityRuleStatistics


@dataclass(frozen=True)
class ProjectPrefilterRequest:
    """预过滤请求快照。"""

    token: int
    seq: int
    lg_path: str
    reason: str
    source_language: str
    target_language: str
    mtool_optimizer_enable: bool


@dataclass(frozen=True)
class WorkbenchFileEntrySnapshot:
    """工作台文件行快照。"""

    rel_path: str
    item_count: int
    file_type: Item.FileType


@dataclass(frozen=True)
class WorkbenchSnapshot:
    """工作台整体快照。"""

    file_count: int
    total_items: int
    translated: int
    translated_in_past: int
    untranslated: int
    entries: tuple[WorkbenchFileEntrySnapshot, ...]


@dataclass(frozen=True)
class AnalysisGlossaryImportPreviewEntry:
    """分析候选导入预演中的单条快照。"""

    entry: dict[str, Any]
    statistics_key: str
    is_new: bool
    incoming_indexes: tuple[int, ...]


@dataclass(frozen=True)
class AnalysisGlossaryImportPreview:
    """分析候选导入预演结果。"""

    merged_entries: tuple[dict[str, Any], ...]
    report: QualityRuleMerger.Report
    entries: tuple[AnalysisGlossaryImportPreviewEntry, ...]
    statistics_results: dict[str, QualityRuleStatistics.RuleStatResult]
    subset_parents: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class ProjectFileMutationResult:
    """工程文件变更结果。"""

    rel_path: str
    old_rel_path: str | None = None
    matched: int = 0
    new: int = 0
    total: int = 0
