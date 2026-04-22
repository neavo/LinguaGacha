from __future__ import annotations

from dataclasses import dataclass
from typing import Any

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
    mtool_optimizer_enable: bool


@dataclass(frozen=True)
class ProjectPrefilterScheduleResult:
    """预过滤调度结果。

    `needed` 表示当前配置语义上是否需要重跑预过滤。
    `accepted` 表示本次是否已经成功把重算请求交给预过滤链。
    """

    needed: bool = False
    accepted: bool = False


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

    rel_paths: tuple[str, ...] = ()
    removed_rel_paths: tuple[str, ...] = ()
    matched: int = 0
    new: int = 0
    total: int = 0
    order_changed: bool = False


@dataclass(frozen=True)
class ProjectItemChange:
    """条目级影响范围快照。"""

    item_ids: tuple[int, ...] = ()
    rel_paths: tuple[str, ...] = ()
    reason: str = ""
