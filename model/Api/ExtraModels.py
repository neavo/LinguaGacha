from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TsConversionOptionsSnapshot:
    """把繁简转换页的最小配置冻结，避免 UI 继续猜测默认行为。"""

    default_direction: str = ""
    preserve_text_enabled: bool = False
    convert_name_enabled: bool = False


@dataclass(frozen=True)
class TsConversionTaskAccepted:
    """把繁简转换任务受理结果对象化，避免页面自己拼任务标识。"""

    accepted: bool = False
    task_id: str = ""


@dataclass(frozen=True)
class NameFieldEntryDraft:
    """把名字字段草稿冻结后传递，避免跨层共享可变编辑条目。"""

    src: str = ""
    dst: str = ""
    context: str = ""
    status: str = ""


@dataclass(frozen=True)
class NameFieldSnapshot:
    """把名字字段页面快照收口成只读对象，避免 UI 自己维护条目列表。"""

    items: tuple[NameFieldEntryDraft, ...] = ()


@dataclass(frozen=True)
class NameFieldTranslateResult:
    """把名字字段翻译结果冻结，避免页面继续猜测成功失败统计。"""

    items: tuple[NameFieldEntryDraft, ...] = ()
    success_count: int = 0
    failed_count: int = 0


@dataclass(frozen=True)
class LaboratorySnapshot:
    """把实验室页开关状态对象化，避免 UI 继续直接读取配置。"""

    mtool_optimizer_enabled: bool = False
    force_thinking_enabled: bool = False


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
