from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler
from typing import Any

from module.Config import Config
from module.Engine.TaskRequester import TaskRequester
from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError


class LlmRequestAppService:
    """Electron main TS worker 专用的 Python LLM SDK 适配器。

    迁移后日志表格、prompt 片段、响应清洗与业务校验由 TS worker 生成；
    Python 侧只保留真实 SDK 请求事实，避免重新形成第二套 work unit 权威。
    """

    TOKEN_HEADER: str = "X-LinguaGacha-Core-Token"

    def __init__(self, *, instance_token: str) -> None:
        """保存内部 token；本服务不持有任务生命周期或业务 item。"""

        self.instance_token = instance_token.strip()

    def request(
        self,
        request: dict[str, object],
        handler: BaseHTTPRequestHandler,
    ) -> dict[str, object]:
        """执行一次真实 LLM SDK 请求，并只返回原始请求事实。"""

        self.assert_token(handler)
        config = self.resolve_config(request.get("config_snapshot"))
        model = self.resolve_model(request.get("model"), config)
        messages = self.resolve_messages(request.get("messages"))
        requester = TaskRequester(config, model)
        started_at = time.time()
        exception, response_think, response_result, input_tokens, output_tokens = (
            requester.request(messages, stop_checker=lambda: False)
        )
        return self.build_response(
            started_at=started_at,
            exception=exception,
            response_think=response_think,
            response_result=response_result,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )

    def assert_token(self, handler: BaseHTTPRequestHandler) -> None:
        """校验内部 token，避免 renderer 或外部脚本误触 LLM adapter。"""

        received_token = handler.headers.get(self.TOKEN_HEADER, "").strip()
        if self.instance_token == "" or received_token != self.instance_token:
            raise ValueError("Core 内部 LLM adapter 令牌无效。")

    def resolve_config(self, payload: object) -> Config:
        """优先使用 TS 传入的配置快照，缺失字段继续沿用本地默认 Config。"""

        config = Config().load()
        if not isinstance(payload, dict):
            return config
        for key, value in payload.items():
            if hasattr(config, str(key)):
                setattr(config, str(key), value)
        return config

    def resolve_model(self, payload: object, config: Config) -> dict[str, Any]:
        """模型必须来自 TS 快照；缺失时才回退当前 Config 激活模型。"""

        model = dict(payload) if isinstance(payload, dict) else {}
        if model:
            return model
        active_model = config.get_active_model()
        if isinstance(active_model, dict):
            return dict(active_model)
        raise ValueError("没有可用的激活模型。")

    def resolve_messages(self, payload: object) -> list[dict[str, Any]]:
        """messages 只接受 role/content 对象数组，业务载荷不得混入 adapter。"""

        if not isinstance(payload, list):
            raise ValueError("LLM 请求 messages 无效。")
        messages: list[dict[str, Any]] = []
        for raw_message in payload:
            if not isinstance(raw_message, dict):
                continue
            role = raw_message.get("role")
            content = raw_message.get("content")
            if not isinstance(role, str) or not isinstance(content, str):
                continue
            messages.append({"role": role, "content": content})
        if not messages:
            raise ValueError("LLM 请求 messages 为空。")
        return messages

    def build_response(
        self,
        *,
        started_at: float,
        exception: Exception | None,
        response_think: str,
        response_result: str,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, object]:
        """把 SDK 请求结果裁成 TS worker 可消费的原始事实。"""

        del started_at
        return {
            "response_think": response_think,
            "response_result": response_result,
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "cancelled": isinstance(exception, RequestCancelledError),
            "timeout": isinstance(exception, RequestHardTimeoutError),
            "degraded": isinstance(exception, StreamDegradationError),
            "error": ""
            if exception is None
            or isinstance(
                exception,
                (
                    RequestCancelledError,
                    RequestHardTimeoutError,
                    StreamDegradationError,
                ),
            )
            else str(exception),
        }
