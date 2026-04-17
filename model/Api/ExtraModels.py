from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from typing import Self


@dataclass(frozen=True)
class TsConversionOptionsSnapshot:
    """把繁简转换页的最小配置冻结，避免 UI 继续猜测默认行为。"""

    default_direction: str = ""
    preserve_text_enabled: bool = False
    convert_name_enabled: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把服务端 options 响应归一化成冻结对象，避免页面自己补默认值。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            default_direction=str(normalized.get("default_direction", "")),
            preserve_text_enabled=bool(normalized.get("preserve_text_enabled", False)),
            convert_name_enabled=bool(normalized.get("convert_name_enabled", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结 options 恢复为 JSON 字典，供响应载荷复用。"""

        return {
            "default_direction": self.default_direction,
            "preserve_text_enabled": self.preserve_text_enabled,
            "convert_name_enabled": self.convert_name_enabled,
        }


@dataclass(frozen=True)
class TsConversionTaskAccepted:
    """把繁简转换任务受理结果对象化，避免页面自己拼任务标识。"""

    accepted: bool = False
    task_id: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把任务受理响应转换成冻结对象，避免客户端继续读字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            accepted=bool(normalized.get("accepted", False)),
            task_id=str(normalized.get("task_id", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        """把任务受理对象恢复为 JSON 字典，供路由层直接返回。"""

        return {
            "accepted": self.accepted,
            "task_id": self.task_id,
        }


@dataclass(frozen=True)
class ExtraTaskState:
    """把 Extra 长任务进度冻结缓存，避免页面继续散读可变字典。"""

    PHASE_PREPARING: str = "PREPARING"
    PHASE_RUNNING: str = "RUNNING"
    PHASE_FINISHED: str = "FINISHED"

    task_id: str = ""
    phase: str = ""
    message: str = ""
    current: int = 0
    total: int = 0
    finished: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把 SSE 载荷归一化成最小任务状态对象。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            task_id=str(normalized.get("task_id", "")),
            phase=str(normalized.get("phase", "")),
            message=str(normalized.get("message", "")),
            current=int(normalized.get("current", 0) or 0),
            total=int(normalized.get("total", 0) or 0),
            finished=bool(normalized.get("finished", False)),
        )

    def merge_dict(
        self,
        data: dict[str, Any] | None,
        *,
        finished: bool | None = None,
    ) -> Self:
        """只按显式字段覆盖状态，保证同一任务的进度真相集中在仓库里。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        task_id = self.task_id
        phase = self.phase
        message = self.message
        current = self.current
        total = self.total
        finished_value = self.finished

        if "task_id" in normalized:
            task_id = str(normalized.get("task_id", ""))
        if "phase" in normalized:
            phase = str(normalized.get("phase", ""))
        if "message" in normalized:
            message = str(normalized.get("message", ""))
        if "current" in normalized:
            current = int(normalized.get("current", 0) or 0)
        if "total" in normalized:
            total = int(normalized.get("total", 0) or 0)
        if "finished" in normalized:
            finished_value = bool(normalized.get("finished", False))
        if finished is not None:
            finished_value = finished

        return ExtraTaskState(
            task_id=task_id,
            phase=phase,
            message=message,
            current=current,
            total=total,
            finished=finished_value,
        )


@dataclass(frozen=True)
class NameFieldEntryDraft:
    """把名字字段草稿冻结后传递，避免跨层共享可变编辑条目。"""

    src: str = ""
    dst: str = ""
    context: str = ""
    status: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把姓名字段条目归一化为冻结对象，避免客户端继续散读字典。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            src=str(normalized.get("src", "")),
            dst=str(normalized.get("dst", "")),
            context=str(normalized.get("context", "")),
            status=str(normalized.get("status", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结条目恢复成 JSON 字典，供 payload 与页面适配复用。"""

        return {
            "src": self.src,
            "dst": self.dst,
            "context": self.context,
            "status": self.status,
        }


@dataclass(frozen=True)
class NameFieldSnapshot:
    """把名字字段页面快照收口成只读对象，避免 UI 自己维护条目列表。"""

    items: tuple[NameFieldEntryDraft, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把快照字典归一化成冻结对象，避免客户端自己遍历协议字段。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        raw_items = normalized.get("items", ())
        items: list[NameFieldEntryDraft] = []
        if isinstance(raw_items, (list, tuple)):
            for raw_item in raw_items:
                items.append(NameFieldEntryDraft.from_dict(raw_item))

        return cls(items=tuple(items))

    def to_dict(self) -> dict[str, Any]:
        """把冻结快照恢复成 JSON 字典，供响应层直接发送。"""

        return {"items": [item.to_dict() for item in self.items]}


@dataclass(frozen=True)
class NameFieldTranslateResult:
    """把名字字段翻译结果冻结，避免页面继续猜测成功失败统计。"""

    items: tuple[NameFieldEntryDraft, ...] = ()
    success_count: int = 0
    failed_count: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把翻译结果字典归一化成冻结对象，保证客户端读取口径一致。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        raw_items = normalized.get("items", ())
        items: list[NameFieldEntryDraft] = []
        if isinstance(raw_items, (list, tuple)):
            for raw_item in raw_items:
                items.append(NameFieldEntryDraft.from_dict(raw_item))

        return cls(
            items=tuple(items),
            success_count=int(normalized.get("success_count", 0) or 0),
            failed_count=int(normalized.get("failed_count", 0) or 0),
        )

    def to_dict(self) -> dict[str, Any]:
        """把翻译结果恢复成 JSON 字典，供 payload 与客户端共用。"""

        return {
            "items": [item.to_dict() for item in self.items],
            "success_count": self.success_count,
            "failed_count": self.failed_count,
        }


@dataclass(frozen=True)
class LaboratorySnapshot:
    """把实验室页开关状态对象化，避免 UI 继续直接读取配置。"""

    mtool_optimizer_enabled: bool = True
    force_thinking_enabled: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Self:
        """把实验室快照归一化为冻结对象，避免客户端自己兜默认值。"""

        normalized: dict[str, Any]
        if isinstance(data, dict):
            normalized = data
        else:
            normalized = {}

        return cls(
            mtool_optimizer_enabled=bool(
                normalized.get("mtool_optimizer_enabled", True)
            ),
            force_thinking_enabled=bool(
                normalized.get("force_thinking_enabled", False)
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        """把冻结快照恢复成 JSON 字典，供边界层直接发送。"""

        return {
            "mtool_optimizer_enabled": self.mtool_optimizer_enabled,
            "force_thinking_enabled": self.force_thinking_enabled,
        }


@dataclass(frozen=True)
class ExtraToolEntry:
    """把 Extra 工具箱条目冻结，避免工具列表继续散落为匿名字典。"""

    tool_id: str = ""
    title: str = ""
    description: str = ""
    route_path: str = ""


@dataclass(frozen=True)
class ExtraToolSnapshot:
    """把 Extra 工具列表集中为快照，避免页面各自拼装导航元数据。"""

    entries: tuple[ExtraToolEntry, ...] = ()
