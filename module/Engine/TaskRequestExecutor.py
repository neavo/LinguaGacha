from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any
from typing import Callable

from module.Config import Config
from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError
from module.Response.ResponseCleaner import ResponseCleaner
from module.Response.ResponseDecoder import ResponseDecoder


@dataclass(frozen=True)
class TaskRequestResult:
    """统一承载一次模型请求的原始结果和清洗后的衍生信息。"""

    start_time: float
    exception: Exception | None
    response_think: str
    response_result: str
    input_tokens: int
    output_tokens: int
    normalized_think: str
    cleaned_response_result: str
    has_why_block: bool
    decoded_translations: tuple[str, ...]
    decoded_glossary_entries: tuple[dict[str, Any], ...]

    def is_cancelled(self) -> bool:
        """停止请求单独识别，调用方可以继续沿用旧语义。"""
        return isinstance(self.exception, RequestCancelledError)

    def is_recoverable_exception(self) -> bool:
        """超时和流退化仍视为可恢复失败，不直接打断任务总流程。"""
        return isinstance(
            self.exception,
            (RequestHardTimeoutError, StreamDegradationError),
        )


class TaskRequestExecutor:
    """统一执行单次请求、清洗回复并解码，领域判断继续留给调用方。"""

    @staticmethod
    def execute(
        *,
        config: Config,
        model: dict[str, Any],
        messages: list[dict[str, Any]],
        requester_factory: Callable[[Config, dict[str, Any]], Any],
        stop_checker: Callable[[], bool] | None = None,
    ) -> TaskRequestResult:
        """把公共请求链路收口，避免翻译和分析各写一套近似代码。"""
        start_time = time.time()
        requester = requester_factory(config, model)
        (
            exception,
            response_think,
            response_result,
            input_tokens,
            output_tokens,
        ) = requester.request(messages, stop_checker=stop_checker)

        if exception is not None:
            return TaskRequestResult(
                start_time=start_time,
                exception=exception,
                response_think=response_think,
                response_result=response_result,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                normalized_think=response_think,
                cleaned_response_result=response_result,
                has_why_block=False,
                decoded_translations=tuple(),
                decoded_glossary_entries=tuple(),
            )

        has_why_block = (
            ResponseCleaner.WHY_TAG_PATTERN.search(response_result) is not None
        )
        cleaned_response_result, why_text = ResponseCleaner.extract_why_from_response(
            response_result
        )
        normalized_think = ResponseCleaner.normalize_blank_lines(response_think).strip()
        normalized_think = ResponseCleaner.merge_text_blocks(normalized_think, why_text)
        decoded_translations, decoded_glossary_entries = ResponseDecoder().decode(
            cleaned_response_result
        )
        return TaskRequestResult(
            start_time=start_time,
            exception=None,
            response_think=response_think,
            response_result=response_result,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            normalized_think=normalized_think,
            cleaned_response_result=cleaned_response_result,
            has_why_block=has_why_block,
            decoded_translations=tuple(decoded_translations),
            decoded_glossary_entries=tuple(decoded_glossary_entries),
        )
