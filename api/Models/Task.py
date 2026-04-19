from dataclasses import dataclass
from dataclasses import field
from typing import Any


@dataclass(frozen=True)
class TaskStatusUpdate:
    """任务状态增量只表达需要覆盖的字段，缺失值保持为 None。"""

    task_type: str | None = None
    status: str | None = None
    busy: bool | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "TaskStatusUpdate":
        """把 SSE 状态载荷转换为显式 patch 对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        task_type: str | None = None
        status: str | None = None
        busy: bool | None = None

        if "task_type" in normalized:
            task_type = str(normalized.get("task_type", ""))
        if "status" in normalized:
            status = str(normalized.get("status", "IDLE"))
        if "busy" in normalized:
            busy = bool(normalized.get("busy", False))

        return cls(task_type=task_type, status=status, busy=busy)


@dataclass(frozen=True)
class TaskProgressUpdate:
    """任务进度增量对象把“缺失字段”和“字段为 0”严格区分开。"""

    task_type: str | None = None
    request_in_flight_count: int | None = None
    line: int | None = None
    total_line: int | None = None
    processed_line: int | None = None
    error_line: int | None = None
    total_tokens: int | None = None
    total_output_tokens: int | None = None
    total_input_tokens: int | None = None
    time: float | None = None
    start_time: float | None = None
    analysis_candidate_count: int | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "TaskProgressUpdate":
        """把 SSE 进度载荷转换为可合并的 patch 对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            task_type=(
                str(normalized.get("task_type", ""))
                if "task_type" in normalized
                else None
            ),
            request_in_flight_count=(
                int(normalized.get("request_in_flight_count", 0) or 0)
                if "request_in_flight_count" in normalized
                else None
            ),
            line=(
                int(normalized.get("line", 0) or 0) if "line" in normalized else None
            ),
            total_line=(
                int(normalized.get("total_line", 0) or 0)
                if "total_line" in normalized
                else None
            ),
            processed_line=(
                int(normalized.get("processed_line", 0) or 0)
                if "processed_line" in normalized
                else None
            ),
            error_line=(
                int(normalized.get("error_line", 0) or 0)
                if "error_line" in normalized
                else None
            ),
            total_tokens=(
                int(normalized.get("total_tokens", 0) or 0)
                if "total_tokens" in normalized
                else None
            ),
            total_output_tokens=(
                int(normalized.get("total_output_tokens", 0) or 0)
                if "total_output_tokens" in normalized
                else None
            ),
            total_input_tokens=(
                int(normalized.get("total_input_tokens", 0) or 0)
                if "total_input_tokens" in normalized
                else None
            ),
            time=(
                float(normalized.get("time", 0.0) or 0.0)
                if "time" in normalized
                else None
            ),
            start_time=(
                float(normalized.get("start_time", 0.0) or 0.0)
                if "start_time" in normalized
                else None
            ),
            analysis_candidate_count=(
                int(normalized.get("analysis_candidate_count", 0) or 0)
                if "analysis_candidate_count" in normalized
                else None
            ),
        )


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
        )

    def merge_status(self, update: TaskStatusUpdate) -> "TaskSnapshot":
        """状态 patch 只覆盖显式给出的生命周期字段。"""

        return TaskSnapshot(
            task_type=self.task_type if update.task_type is None else update.task_type,
            status=self.status if update.status is None else update.status,
            busy=self.busy if update.busy is None else update.busy,
            request_in_flight_count=self.request_in_flight_count,
            line=self.line,
            total_line=self.total_line,
            processed_line=self.processed_line,
            error_line=self.error_line,
            total_tokens=self.total_tokens,
            total_output_tokens=self.total_output_tokens,
            total_input_tokens=self.total_input_tokens,
            time=self.time,
            start_time=self.start_time,
            analysis_candidate_count=self.analysis_candidate_count,
        )

    def merge_progress(self, update: TaskProgressUpdate) -> "TaskSnapshot":
        """进度 patch 只覆盖显式给出的统计字段，保留当前状态字段。"""

        return TaskSnapshot(
            task_type=self.task_type if update.task_type is None else update.task_type,
            status=self.status,
            busy=self.busy,
            request_in_flight_count=(
                self.request_in_flight_count
                if update.request_in_flight_count is None
                else update.request_in_flight_count
            ),
            line=self.line if update.line is None else update.line,
            total_line=self.total_line
            if update.total_line is None
            else update.total_line,
            processed_line=(
                self.processed_line
                if update.processed_line is None
                else update.processed_line
            ),
            error_line=self.error_line
            if update.error_line is None
            else update.error_line,
            total_tokens=(
                self.total_tokens
                if update.total_tokens is None
                else update.total_tokens
            ),
            total_output_tokens=(
                self.total_output_tokens
                if update.total_output_tokens is None
                else update.total_output_tokens
            ),
            total_input_tokens=(
                self.total_input_tokens
                if update.total_input_tokens is None
                else update.total_input_tokens
            ),
            time=self.time if update.time is None else update.time,
            start_time=self.start_time
            if update.start_time is None
            else update.start_time,
            analysis_candidate_count=(
                self.analysis_candidate_count
                if update.analysis_candidate_count is None
                else update.analysis_candidate_count
            ),
        )

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
        }


@dataclass(frozen=True)
class AnalysisGlossaryImportResult:
    """分析候选导入结果统一收口导入计数与最新任务快照。"""

    accepted: bool = False
    imported_count: int = 0
    task: TaskSnapshot = field(default_factory=TaskSnapshot)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "AnalysisGlossaryImportResult":
        """把导入术语表响应转换成稳定对象，避免调用方继续拆字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        task_raw = normalized.get("task", {})
        return cls(
            accepted=bool(normalized.get("accepted", False)),
            imported_count=int(normalized.get("imported_count", 0) or 0),
            task=TaskSnapshot.from_dict(task_raw if isinstance(task_raw, dict) else {}),
        )

    def to_dict(self) -> dict[str, Any]:
        """把导入结果恢复为 JSON 字典，供边界层与测试断言复用。"""

        return {
            "accepted": self.accepted,
            "imported_count": self.imported_count,
            "task": self.task.to_dict(),
        }
