from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TaskSnapshot:
    """任务完整快照统一承载页面需要的状态和统计字段。"""

    task_type: str = ""
    status: str = "IDLE"
    busy: bool = False
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
    analysis_candidate_count: int = 0
    retranslating_item_ids: tuple[int, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "TaskSnapshot":
        """把任务响应统一转换为冻结快照，并补齐安全默认值。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            task_type=str(normalized.get("task_type", "")),
            status=str(normalized.get("status", "IDLE")),
            busy=bool(normalized.get("busy", False)),
            request_in_flight_count=int(
                normalized.get("request_in_flight_count", 0) or 0
            ),
            line=int(normalized.get("line", 0) or 0),
            total_line=int(normalized.get("total_line", 0) or 0),
            processed_line=int(normalized.get("processed_line", 0) or 0),
            error_line=int(normalized.get("error_line", 0) or 0),
            total_tokens=int(normalized.get("total_tokens", 0) or 0),
            total_output_tokens=int(normalized.get("total_output_tokens", 0) or 0),
            total_input_tokens=int(normalized.get("total_input_tokens", 0) or 0),
            time=float(normalized.get("time", 0.0) or 0.0),
            start_time=float(normalized.get("start_time", 0.0) or 0.0),
            analysis_candidate_count=int(
                normalized.get("analysis_candidate_count", 0) or 0
            ),
            retranslating_item_ids=cls.normalize_retranslating_item_ids(
                normalized.get("retranslating_item_ids", [])
            ),
        )

    @staticmethod
    def normalize_retranslating_item_ids(value: object) -> tuple[int, ...]:
        if not isinstance(value, (list, tuple, set)):
            return ()

        item_ids: list[int] = []
        seen_ids: set[int] = set()
        for raw_item_id in value:
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id in seen_ids:
                continue
            seen_ids.add(item_id)
            item_ids.append(item_id)
        return tuple(item_ids)

    def to_dict(self) -> dict[str, Any]:
        """把任务快照恢复为 JSON 字典，便于边界层和测试复用。"""

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
            "analysis_candidate_count": self.analysis_candidate_count,
            "retranslating_item_ids": list(self.retranslating_item_ids),
        }
