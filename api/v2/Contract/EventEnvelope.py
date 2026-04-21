from dataclasses import dataclass
from typing import Any

from module.Utils.JSONTool import JSONTool


def build_sse_frame(event_type: str, data: dict[str, Any]) -> bytes:
    """统一拼装 SSE 帧，并复用仓库级 JSON 安全序列化策略。"""

    return (
        f"event: {event_type}\n".encode("utf-8")
        + b"data: "
        + JSONTool.dumps_bytes(data, indent=0)
        + b"\n\n"
    )


@dataclass(frozen=True)
class EventEnvelope:
    """SSE 标准事件包。

    统一包裹 topic 和序列化数据，避免把内部事件对象直接暴露给客户端。
    """

    topic: str
    data: dict[str, Any]

    def to_sse_payload(self) -> bytes:
        """统一编码成 SSE 文本格式，保证所有订阅端拿到同一协议。"""

        return build_sse_frame(self.topic, self.data)
