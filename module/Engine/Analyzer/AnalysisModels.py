from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from model.Item import Item


# 这些数据类把分析任务跨模块传递的数据口径固定下来，避免到处散落不透明的 dict。
@dataclass(frozen=True)
class AnalysisFilePlan:
    """单文件分析计划。"""

    file_path: str
    chunks: tuple[tuple[Item, ...], ...]

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)

    @property
    def item_count(self) -> int:
        return sum(len(chunk) for chunk in self.chunks)


# 分片结果单独建模后，主流程只需要关心成功、停止和统计，不用反复拆字典。
@dataclass(frozen=True)
class AnalysisChunkResult:
    """单个分析分片的执行结果。"""

    success: bool
    stopped: bool
    input_tokens: int = 0
    output_tokens: int = 0
    glossary_entries: tuple[dict[str, Any], ...] = tuple()
