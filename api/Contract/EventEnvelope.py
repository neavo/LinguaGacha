from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EventEnvelope:
    """SSE 事件包占位类型，后续任务会补齐完整字段。"""

    topic: str
    data: dict[str, Any]
