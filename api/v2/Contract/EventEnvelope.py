from dataclasses import dataclass
import json
from typing import Any


@dataclass(frozen=True)
class EventEnvelope:
    """SSE 标准事件包。

    统一包裹 topic 和序列化数据，避免把内部事件对象直接暴露给客户端。
    """

    topic: str
    data: dict[str, Any]

    def to_sse_payload(self) -> bytes:
        """统一编码成 SSE 文本格式，保证所有订阅端拿到同一协议。"""

        data_json = json.dumps(self.data, ensure_ascii=False)
        return f"event: {self.topic}\ndata: {data_json}\n\n".encode("utf-8")
