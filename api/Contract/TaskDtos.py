from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TaskDto:
    """统一描述任务快照，避免 UI 自己拼装忙碌态与进度字段。"""

    task_type: str
    status: str
    busy: bool
    request_in_flight_count: int = 0
    line: int = 0
    total_line: int = 0
    processed_line: int = 0
    error_line: int = 0
    total_tokens: int = 0
    total_output_tokens: int = 0
    total_input_tokens: int = 0
    time: float = 0.0
    start_time: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """转换为 JSON 结构，供 HTTP 与状态仓库共用。"""

        return {
            "task_type": self.task_type,
            "status": self.status,
            "busy": self.busy,
            "request_in_flight_count": self.request_in_flight_count,
            "line": self.line,
            "total_line": self.total_line,
            "processed_line": self.processed_line,
            "error_line": self.error_line,
            "total_tokens": self.total_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_input_tokens": self.total_input_tokens,
            "time": self.time,
            "start_time": self.start_time,
        }
