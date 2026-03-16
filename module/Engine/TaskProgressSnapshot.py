from __future__ import annotations

from dataclasses import dataclass
from dataclasses import replace
from typing import Any


@dataclass(frozen=True)
class TaskProgressSnapshot:
    """统一翻译与分析任务的进度快照字段，避免两边各自拼字典。"""

    start_time: float
    time: float
    total_line: int
    line: int
    processed_line: int
    error_line: int
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int

    @classmethod
    def empty(cls, *, start_time: float = 0.0) -> "TaskProgressSnapshot":
        """新任务或清空任务时统一从零快照起步。"""
        return cls(
            start_time=start_time,
            time=0.0,
            total_line=0,
            line=0,
            processed_line=0,
            error_line=0,
            total_tokens=0,
            total_input_tokens=0,
            total_output_tokens=0,
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "TaskProgressSnapshot":
        """从字典快照恢复统一进度结构，并规范数值类型。"""
        payload = data if isinstance(data, dict) else {}
        return cls(
            start_time=float(payload.get("start_time", 0.0) or 0.0),
            time=float(payload.get("time", 0.0) or 0.0),
            total_line=int(payload.get("total_line", 0) or 0),
            line=int(payload.get("line", 0) or 0),
            processed_line=int(payload.get("processed_line", 0) or 0),
            error_line=int(payload.get("error_line", 0) or 0),
            total_tokens=int(payload.get("total_tokens", 0) or 0),
            total_input_tokens=int(payload.get("total_input_tokens", 0) or 0),
            total_output_tokens=int(payload.get("total_output_tokens", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        """把统一进度结构写回字典，供事件和持久化层复用。"""
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
        }

    def with_elapsed(self, *, now: float) -> "TaskProgressSnapshot":
        """运行态时间只用 start_time 反推，避免多处各算各的。"""
        if self.start_time <= 0:
            return replace(self, time=0.0)
        return replace(self, time=max(0.0, now - self.start_time))

    def with_counts(
        self,
        *,
        total_line: int | None = None,
        line: int | None = None,
        processed_line: int | None = None,
        error_line: int | None = None,
    ) -> "TaskProgressSnapshot":
        """行数的重算统一从这里更新，避免字段漏同步。"""
        next_processed = (
            self.processed_line if processed_line is None else int(processed_line)
        )
        next_error = self.error_line if error_line is None else int(error_line)
        next_line = next_processed + next_error if line is None else int(line)
        return replace(
            self,
            total_line=self.total_line if total_line is None else int(total_line),
            line=next_line,
            processed_line=next_processed,
            error_line=next_error,
        )

    def add_tokens(
        self, *, input_tokens: int, output_tokens: int
    ) -> "TaskProgressSnapshot":
        """输入输出 token 的累计口径统一收口，避免两边相加方式漂移。"""
        next_input = self.total_input_tokens + int(input_tokens)
        next_output = self.total_output_tokens + int(output_tokens)
        return replace(
            self,
            total_input_tokens=next_input,
            total_output_tokens=next_output,
            total_tokens=next_input + next_output,
        )
