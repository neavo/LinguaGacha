from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from base.Base import Base


# 这里把单条待分析文本收成不可变快照，避免并发任务直接共享可变 Item 引用。
@dataclass(frozen=True)
class AnalysisItemContext:
    """单条分析输入的稳定快照。"""

    item_id: int
    file_path: str
    source_text: str
    previous_status: Base.ProjectStatus | None = None


# 这里把一次分析任务需要提交的数据收成一个上下文，保证切块边界和重试输入稳定。
@dataclass(frozen=True)
class AnalysisTaskContext:
    """单个分析任务的上下文。"""

    file_path: str
    items: tuple[AnalysisItemContext, ...]
    retry_count: int = 0

    @property
    def item_count(self) -> int:
        return len(self.items)

    @property
    def source_texts(self) -> tuple[str, ...]:
        return tuple(item.source_text for item in self.items)


# 任务结果单独建模后，调度层就只需要关心“成了没、停了没、提交什么”。
@dataclass(frozen=True)
class AnalysisTaskResult:
    """单个分析任务的执行结果。"""

    context: AnalysisTaskContext
    success: bool
    stopped: bool
    input_tokens: int = 0
    output_tokens: int = 0
    glossary_entries: tuple[dict[str, Any], ...] = tuple()


# 进度快照显式建模，避免各处随手拼 dict 时把字段口径拼歪。
@dataclass(frozen=True)
class AnalysisProgressSnapshot:
    """分析页使用的进度快照。"""

    start_time: float
    time: float
    total_line: int
    line: int
    processed_line: int
    error_line: int
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int
    added_glossary: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_time": self.start_time,
            "time": self.time,
            "total_line": self.total_line,
            "line": self.line,
            "processed_line": self.processed_line,
            "error_line": self.error_line,
            "total_tokens": self.total_tokens,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "added_glossary": self.added_glossary,
        }


# 这里保留项目级候选池单项结构，方便接口和测试都围绕同一份口径断言。
@dataclass(frozen=True)
class AnalysisCandidateAggregate:
    """项目级候选池聚合条目。"""

    src: str
    dst_votes: dict[str, int]
    info_votes: dict[str, int]
    observation_count: int
    first_seen_at: str
    last_seen_at: str
    case_sensitive: bool
