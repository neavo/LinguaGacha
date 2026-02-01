"""
任务请求器模块 - 负责向各种 LLM API 发送流式请求

支持的 API 格式:
- OpenAI / OpenAI Compatible (GLM, Kimi, Doubao, DeepSeek 等)
- Google Gemini (含思考模式)
- Anthropic Claude (含扩展思考)
- SakuraLLM

主要功能:
- 流式请求与响应处理
- 停止信号快速响应
- 输出退化检测与提前中断
- 客户端缓存与生命周期管理
"""

import asyncio
import inspect
import json
import re
import threading
import time
from functools import lru_cache
from typing import Any
from typing import Callable

import anthropic
import httpx
import openai
from google import genai
from google.genai import types

from base.Base import Base
from base.VersionManager import VersionManager
from model.Model import ThinkingLevel
from module.Config import Config

AsyncClientCacheKey = tuple[int, str, str, str, int, tuple]


class RequestCancelledError(Exception):
    """用户触发停止导致的主动取消（不应记为翻译错误）。"""


class RequestHardTimeoutError(Exception):
    """请求级硬超时（按可恢复失败处理，不等同于用户停止）。"""


class StreamDegradationError(Exception):
    """流式输出检测到明显退化/重复，提前中断。"""


class TaskRequester(Base):
    """
    任务请求器 - 负责向各种 LLM API 发送请求
    直接使用新的 Model 数据结构，不兼容旧的 platform 格式
    """

    # 密钥索引
    API_KEY_INDEX: int = 0

    # Gemini
    RE_GEMINI_2_5_PRO: re.Pattern = re.compile(r"gemini-2\.5-pro", flags=re.IGNORECASE)
    RE_GEMINI_2_5_FLASH: re.Pattern = re.compile(
        r"gemini-2\.5-flash", flags=re.IGNORECASE
    )
    RE_GEMINI_3_PRO: re.Pattern = re.compile(r"gemini-3-pro", flags=re.IGNORECASE)
    RE_GEMINI_3_FLASH: re.Pattern = re.compile(r"gemini-3-flash", flags=re.IGNORECASE)

    # Claude
    RE_CLAUDE: tuple[re.Pattern, ...] = (
        re.compile(r"claude-3-7-sonnet", flags=re.IGNORECASE),
        re.compile(r"claude-opus-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-haiku-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-sonnet-4-\d", flags=re.IGNORECASE),
    )

    # OpenAI Compatible
    RE_GLM: tuple[re.Pattern, ...] = (
        re.compile(r"glm-4\.5", flags=re.IGNORECASE),
        re.compile(r"glm-4\.6", flags=re.IGNORECASE),
        re.compile(r"glm-4\.7", flags=re.IGNORECASE),
    )
    RE_KIMI: tuple[re.Pattern, ...] = (
        re.compile(r"kimi", flags=re.IGNORECASE),  # 逗号必须保留
    )
    RE_DOUBAO: tuple[re.Pattern, ...] = (
        re.compile(r"doubao-seed-1-6", flags=re.IGNORECASE),
        re.compile(r"doubao-seed-1-8", flags=re.IGNORECASE),
    )
    RE_DEEPSEEK: tuple[re.Pattern, ...] = (
        re.compile(r"deepseek", flags=re.IGNORECASE),  # 逗号必须保留
    )

    # 正则
    RE_LINE_BREAK: re.Pattern = re.compile(r"\n+")

    # 退化检测（仅针对输出 tail；忽略空白符）
    # - 单字符重复 >= 100 次
    # - 双字符模式 AB 重复 >= 50 次（A != B）
    RE_WS: re.Pattern = re.compile(r"\s+")
    RE_SINGLE_CHAR_REPEAT: re.Pattern = re.compile(r"(.)\1{99,}")
    RE_AB_REPEAT: re.Pattern = re.compile(r"(.)(.)(?:\1\2){49,}")

    # 流式控制
    STREAM_POLL_INTERVAL_S: float = 0.15
    STREAM_DEGRADATION_TAIL_CHARS: int = 2048

    # 类线程锁
    LOCK: threading.Lock = threading.Lock()

    # Async 客户端缓存（按事件循环隔离，避免跨 loop 复用导致 "Event loop is closed"）
    ASYNC_CLIENT_CACHE: dict[AsyncClientCacheKey, Any] = {}
    ASYNC_CLIENT_KEYS_BY_LOOP: dict[int, set[AsyncClientCacheKey]] = {}

    def __init__(self, config: Config, model: dict) -> None:
        """
        初始化请求器

        Args:
            config: 全局配置对象
            model: 模型配置字典（新格式）
        """
        super().__init__()
        self.config = config
        self.model = model

        # 从模型配置中提取常用字段
        self.api_url: str = model.get("api_url", "")
        self.api_format: str = model.get("api_format", "OpenAI")
        self.model_id: str = model.get("model_id", "")

        # 解析 API 密钥列表
        api_keys_str = str(model.get("api_key", ""))
        self.api_keys: list[str] = [
            k.strip() for k in api_keys_str.split("\n") if k.strip()
        ]

        # 提取阈值配置
        self.output_token_limit = model.get("threshold", {}).get(
            "output_token_limit", 4096
        )

        # 提取请求配置（根据开关状态决定是否使用）
        request_config = model.get("request", {})
        extra_headers_custom_enable = request_config.get(
            "extra_headers_custom_enable", False
        )
        extra_body_custom_enable = request_config.get("extra_body_custom_enable", False)
        self.extra_headers: dict = (
            request_config.get("extra_headers", {})
            if extra_headers_custom_enable
            else {}
        )
        self.extra_body: dict = (
            request_config.get("extra_body", {}) if extra_body_custom_enable else {}
        )

        # 解析思考挡位
        thinking_config = model.get("thinking", {})
        thinking_level_str = thinking_config.get("level", "OFF")
        try:
            self.thinking_level = ThinkingLevel(thinking_level_str)
        except ValueError:
            self.thinking_level = ThinkingLevel.OFF

        # 提取生成参数
        generation = model.get("generation", {})
        self.generation = generation

    # 重置
    @classmethod
    def reset(cls) -> None:
        with cls.LOCK:
            cls.API_KEY_INDEX = 0
            cls.get_url.cache_clear()
            cls.ASYNC_CLIENT_CACHE.clear()
            cls.ASYNC_CLIENT_KEYS_BY_LOOP.clear()

    @staticmethod
    async def maybe_await(result: Any) -> None:
        """等待可能的协程对象。"""
        if inspect.isawaitable(result):
            await result

    @staticmethod
    def safe_close_async_resource(resource: Any) -> Any:
        """尽力关闭异步流/生成器资源。"""
        close = getattr(resource, "close", None)
        if callable(close):
            result = close()
            if inspect.isawaitable(result):
                return asyncio.ensure_future(result)
            return None

        aclose = getattr(resource, "aclose", None)
        if callable(aclose):
            result = aclose()
            if inspect.isawaitable(result):
                return asyncio.ensure_future(result)
            return None

        return None

    @classmethod
    async def consume_async_iterator_polling(
        cls,
        iterator: Any,
        *,
        stop_checker: Callable[[], bool] | None,
        poll_interval_s: float,
        on_item: Callable[[Any], None],
        on_stop: Callable[[], Any] | None = None,
        deadline_monotonic: float | None = None,
    ) -> None:
        """消费异步迭代器，同时保持对停止信号的快速响应。

        原因: `async for` 会阻塞等待下一个 chunk；轮询机制保持停止响应性。
        """
        if poll_interval_s <= 0:
            poll_interval_s = 0.1

        closed = False

        def is_deadline_reached() -> bool:
            return (
                deadline_monotonic is not None
                and time.monotonic() >= deadline_monotonic
            )

        async def close_once() -> None:
            nonlocal closed
            if closed or on_stop is None:
                return
            closed = True
            try:
                await cls.maybe_await(on_stop())
            except Exception:
                # 关闭阶段尽力而为
                return

        while True:
            # 在创建下一次 __anext__ 之前先检查，避免流式输出很密集时无法及时响应停止/超时。
            if stop_checker is not None and stop_checker():
                await close_once()
                raise RequestCancelledError("stop requested")
            if is_deadline_reached():
                await close_once()
                raise RequestHardTimeoutError("deadline exceeded")

            anext_task = asyncio.create_task(iterator.__anext__())
            try:
                while True:
                    # asyncio.wait() -> (done, pending)，这里仅关心 done。
                    done = (await asyncio.wait({anext_task}, timeout=poll_interval_s))[
                        0
                    ]
                    if anext_task in done:
                        item = await anext_task
                        on_item(item)
                        break

                    if stop_checker is not None and stop_checker():
                        await close_once()
                        raise RequestCancelledError("stop requested")

                    if is_deadline_reached():
                        await close_once()
                        raise RequestHardTimeoutError("deadline exceeded")
            except StopAsyncIteration:
                return
            except (RequestCancelledError, RequestHardTimeoutError):
                if not anext_task.done():
                    anext_task.cancel()
                    try:
                        await anext_task
                    except asyncio.CancelledError:
                        pass
                raise
            except Exception:
                await close_once()
                if not anext_task.done():
                    anext_task.cancel()
                    try:
                        await anext_task
                    except asyncio.CancelledError:
                        pass
                raise

    @classmethod
    async def aclose_client(cls, client: Any) -> None:
        """关闭单个客户端，尝试多种关闭方法。"""
        aio_client = getattr(client, "aio", None)
        if aio_client is not None:
            aclose = getattr(aio_client, "aclose", None)
            if callable(aclose):
                await cls.maybe_await(aclose())
            close = getattr(aio_client, "close", None)
            if callable(close):
                await cls.maybe_await(close())

        aclose = getattr(client, "aclose", None)
        if callable(aclose):
            await cls.maybe_await(aclose())
            return

        close = getattr(client, "close", None)
        if callable(close):
            await cls.maybe_await(close())

    @classmethod
    async def aclose_clients_for_running_loop(cls) -> None:
        """关闭当前事件循环中所有缓存的客户端。"""
        from base.LogManager import LogManager
        from module.Localizer.Localizer import Localizer

        loop_id = id(asyncio.get_running_loop())
        with cls.LOCK:
            keys = cls.ASYNC_CLIENT_KEYS_BY_LOOP.pop(loop_id, set())
            clients = [
                cls.ASYNC_CLIENT_CACHE.pop(key)
                for key in keys
                if key in cls.ASYNC_CLIENT_CACHE
            ]

        for client in clients:
            try:
                await cls.aclose_client(client)
            except Exception as e:
                # 关闭阶段尽力而为，记录警告但不影响主流程
                LogManager.get().warning(Localizer.get().task_close_failed, e)

    @classmethod
    def get_key(cls, keys: list[str]) -> str:
        if len(keys) == 0:
            return "no_key_required"
        if len(keys) == 1:
            return keys[0]
        key = keys[cls.API_KEY_INDEX % len(keys)]
        cls.API_KEY_INDEX = (cls.API_KEY_INDEX + 1) % len(keys)
        return key

    @classmethod
    @lru_cache(maxsize=None)
    def get_url(cls, url: str, api_format: str) -> str:
        if api_format == Base.APIFormat.SAKURALLM:
            return url.removesuffix("/").removesuffix("/chat/completions")
        elif api_format == Base.APIFormat.GOOGLE:
            return url.removesuffix("/")
        elif api_format == Base.APIFormat.ANTHROPIC:
            return url.removesuffix("/")
        else:
            return url.removesuffix("/").removesuffix("/chat/completions")

    @classmethod
    def parse_google_api_url(cls, url: str) -> tuple[str, str | None]:
        normalized_url: str = url.strip().removesuffix("/")
        if not normalized_url:
            return "", None
        if normalized_url.endswith("/v1beta"):
            # 兼容 URL 里指定版本，避免 SDK 拼接重复版本
            return normalized_url.removesuffix("/v1beta"), "v1beta"
        if normalized_url.endswith("/v1"):
            # 兼容 URL 里指定版本，避免 SDK 拼接重复版本
            return normalized_url.removesuffix("/v1"), "v1"
        return normalized_url, None

    @classmethod
    def get_async_client(
        cls,
        url: str,
        key: str,
        api_format: str,
        timeout: int,
        extra_headers_tuple: tuple = (),
    ) -> openai.AsyncOpenAI | genai.Client | anthropic.AsyncAnthropic:
        loop_id = id(asyncio.get_running_loop())
        cache_key: AsyncClientCacheKey = (
            loop_id,
            url,
            key,
            api_format,
            timeout,
            extra_headers_tuple,
        )
        cached = cls.ASYNC_CLIENT_CACHE.get(cache_key)
        if cached is not None:
            return cached

        # extra_headers_tuple 用于 Google API，格式为 ((k1, v1), (k2, v2), ...)，可作为缓存 key
        if api_format == Base.APIFormat.SAKURALLM:
            client = openai.AsyncOpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )
        elif api_format == Base.APIFormat.GOOGLE:
            headers = cls.get_default_headers()
            headers.update(dict(extra_headers_tuple))
            base_url, api_version = cls.parse_google_api_url(url)
            if base_url or api_version:
                http_options = types.HttpOptions(
                    base_url=base_url if base_url else None,
                    api_version=api_version,
                    timeout=timeout * 1000,
                    headers=headers,
                )
            else:
                http_options = types.HttpOptions(
                    timeout=timeout * 1000,
                    headers=headers,
                )
            client = genai.Client(api_key=key, http_options=http_options)
        elif api_format == Base.APIFormat.ANTHROPIC:
            client = anthropic.AsyncAnthropic(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )
        else:
            client = openai.AsyncOpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )

        cls.ASYNC_CLIENT_CACHE[cache_key] = client
        cls.ASYNC_CLIENT_KEYS_BY_LOOP.setdefault(loop_id, set()).add(cache_key)
        return client

    @staticmethod
    def get_default_headers() -> dict:
        """获取默认请求头"""
        return {
            "User-Agent": f"LinguaGacha/{VersionManager.get().get_version()} (https://github.com/neavo/LinguaGacha)"
        }

    def should_use_max_completion_tokens(self) -> bool:
        """仅 OpenAI 官方端点优先使用 max_completion_tokens。"""
        return str(self.api_url).startswith("https://api.openai.com")

    async def request_async(
        self,
        messages: list[dict],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        args: dict[str, Any] = {}
        if self.generation.get("top_p_custom_enable"):
            args["top_p"] = self.generation.get("top_p")
        if self.generation.get("temperature_custom_enable"):
            args["temperature"] = self.generation.get("temperature")
        if self.generation.get("presence_penalty_custom_enable"):
            args["presence_penalty"] = self.generation.get("presence_penalty")
        if self.generation.get("frequency_penalty_custom_enable"):
            args["frequency_penalty"] = self.generation.get("frequency_penalty")

        if self.api_format == Base.APIFormat.SAKURALLM:
            return await self.request_sakura_async(
                messages,
                args,
                stop_checker=stop_checker,
            )
        if self.api_format == Base.APIFormat.GOOGLE:
            return await self.request_google_async(
                messages,
                args,
                stop_checker=stop_checker,
            )
        if self.api_format == Base.APIFormat.ANTHROPIC:
            return await self.request_anthropic_async(
                messages,
                args,
                stop_checker=stop_checker,
            )
        return await self.request_openai_async(
            messages,
            args,
            stop_checker=stop_checker,
        )

    def build_extra_headers(self) -> dict:
        """构建请求头，合并自定义 Headers"""
        headers = self.get_default_headers()
        headers.update(self.extra_headers)
        return headers

    @classmethod
    def extract_openai_think_and_result(cls, message: Any) -> tuple[str, str]:
        """尽量复用非流式逻辑，从 message 中提取 think/result。"""

        if hasattr(message, "reasoning_content") and isinstance(
            message.reasoning_content, str
        ):
            response_think = cls.RE_LINE_BREAK.sub(
                "\n", message.reasoning_content.strip()
            )
            response_result = str(getattr(message, "content", "") or "").strip()
            return response_think, response_result

        content = str(getattr(message, "content", "") or "")
        if "</think>" in content:
            splited = content.split("</think>")
            response_think = cls.RE_LINE_BREAK.sub(
                "\n", splited[0].removeprefix("<think>").strip()
            )
            response_result = splited[-1].strip()
            return response_think, response_result

        return "", content.strip()

    @classmethod
    def has_degradation_in_tail(cls, tail: str) -> bool:
        if not tail:
            return False

        # 允许空白符插入重复之间，但不计入重复次数。
        compact = cls.RE_WS.sub("", tail)
        if not compact:
            return False

        if cls.RE_SINGLE_CHAR_REPEAT.search(compact) is not None:
            return True

        match = cls.RE_AB_REPEAT.search(compact)
        if match is None:
            return False

        return match.group(1) != match.group(2)

    async def request_openai_chat_stream(
        self,
        client: openai.AsyncOpenAI,
        request_args: dict,
        *,
        stop_checker: Callable[[], bool] | None,
    ) -> tuple[str, str, int, int]:
        result_tail = ""
        deadline_monotonic = time.monotonic() + self.config.request_timeout

        def on_event(event: Any) -> None:
            nonlocal result_tail

            event_type = getattr(event, "type", "")
            if event_type != "content.delta":
                return

            text = getattr(event, "content", None)
            if not isinstance(text, str) or not text:
                return

            result_tail = (result_tail + text)[-self.STREAM_DEGRADATION_TAIL_CHARS :]
            if self.has_degradation_in_tail(result_tail):
                raise StreamDegradationError("degradation detected")

        async with client.chat.completions.stream(**request_args) as stream:
            iterator = stream
            if hasattr(stream, "__aiter__"):
                iterator = stream.__aiter__()

            def on_stop() -> Any:
                return __class__.safe_close_async_resource(stream)

            await __class__.consume_async_iterator_polling(
                iterator,
                stop_checker=stop_checker,
                poll_interval_s=self.STREAM_POLL_INTERVAL_S,
                on_item=on_event,
                on_stop=on_stop,
                deadline_monotonic=deadline_monotonic,
            )

            completion = await stream.get_final_completion()

        message = completion.choices[0].message
        response_think, response_result = self.extract_openai_think_and_result(message)

        # 兜底：若流式事件未覆盖到全部输出，仍在最终结果尾部做一次检测。
        if self.has_degradation_in_tail(
            response_result[-self.STREAM_DEGRADATION_TAIL_CHARS :]
        ):
            raise StreamDegradationError("degradation detected")

        usage: Any = getattr(completion, "usage", None)
        try:
            input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        except Exception:
            output_tokens = 0

        return response_think, response_result, input_tokens, output_tokens

    async def request_anthropic_message_stream(
        self,
        client: anthropic.AsyncAnthropic,
        request_args: dict,
        *,
        stop_checker: Callable[[], bool] | None,
    ) -> tuple[str, str, int, int]:
        result_tail = ""
        deadline_monotonic = time.monotonic() + self.config.request_timeout

        def on_text(text: Any) -> None:
            nonlocal result_tail
            if not isinstance(text, str) or not text:
                return

            result_tail = (result_tail + text)[-self.STREAM_DEGRADATION_TAIL_CHARS :]
            if self.has_degradation_in_tail(result_tail):
                raise StreamDegradationError("degradation detected")

        async with client.messages.stream(**request_args) as stream:
            iterator = stream.text_stream
            if hasattr(iterator, "__aiter__"):
                iterator = iterator.__aiter__()

            await __class__.consume_async_iterator_polling(
                iterator,
                stop_checker=stop_checker,
                poll_interval_s=self.STREAM_POLL_INTERVAL_S,
                on_item=on_text,
                on_stop=stream.close,
                deadline_monotonic=deadline_monotonic,
            )

            message = await stream.get_final_message()

        text_messages: list[str] = []
        think_messages: list[str] = []
        for msg in message.content:
            msg_any: Any = msg

            text = getattr(msg_any, "text", None)
            if isinstance(text, str) and text:
                text_messages.append(text)

            thinking = getattr(msg_any, "thinking", None)
            if isinstance(thinking, str) and thinking:
                think_messages.append(thinking)

        response_result = text_messages[-1].strip() if text_messages else ""
        response_think = (
            self.RE_LINE_BREAK.sub("\n", think_messages[-1].strip())
            if think_messages
            else ""
        )

        if self.has_degradation_in_tail(
            response_result[-self.STREAM_DEGRADATION_TAIL_CHARS :]
        ):
            raise StreamDegradationError("degradation detected")

        usage: Any = getattr(message, "usage", None)
        try:
            input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        except Exception:
            output_tokens = 0

        return response_think, response_result, input_tokens, output_tokens

    async def request_google_content_stream(
        self,
        client: genai.Client,
        request_args: dict,
        *,
        stop_checker: Callable[[], bool] | None,
    ) -> tuple[str, str, int, int]:
        # 分别累计思考内容和响应内容
        think_parts: list[str] = []
        result_parts: list[str] = []
        result_tail = ""
        last_usage: Any = None
        deadline_monotonic = time.monotonic() + self.config.request_timeout

        def on_chunk(chunk: Any) -> None:
            nonlocal result_tail
            nonlocal last_usage

            # 从 chunk 中提取 candidates[].content.parts
            candidates = getattr(chunk, "candidates", None)
            if candidates and len(candidates) > 0:
                content = getattr(candidates[0], "content", None)
                if content:
                    parts = getattr(content, "parts", None)
                    if parts:
                        for part in parts:
                            text = getattr(part, "text", None)
                            if not isinstance(text, str) or not text:
                                continue

                            # 根据 part.thought 属性区分思考内容和响应内容
                            is_thought = getattr(part, "thought", False)
                            if is_thought:
                                think_parts.append(text)
                            else:
                                result_parts.append(text)
                                # 仅对响应内容检测退化
                                result_tail = (result_tail + text)[
                                    -self.STREAM_DEGRADATION_TAIL_CHARS :
                                ]
                                if self.has_degradation_in_tail(result_tail):
                                    raise StreamDegradationError("degradation detected")

            usage_metadata = getattr(chunk, "usage_metadata", None)
            if usage_metadata is not None:
                last_usage = usage_metadata

        generator = await client.aio.models.generate_content_stream(**request_args)
        iterator = generator
        if hasattr(generator, "__aiter__"):
            iterator = generator.__aiter__()

        def on_stop() -> Any:
            return __class__.safe_close_async_resource(generator)

        await __class__.consume_async_iterator_polling(
            iterator,
            stop_checker=stop_checker,
            poll_interval_s=self.STREAM_POLL_INTERVAL_S,
            on_item=on_chunk,
            on_stop=on_stop,
            deadline_monotonic=deadline_monotonic,
        )

        response_result = "".join(result_parts).strip()
        response_think = __class__.RE_LINE_BREAK.sub("\n", "".join(think_parts).strip())

        if self.has_degradation_in_tail(
            response_result[-self.STREAM_DEGRADATION_TAIL_CHARS :]
        ):
            raise StreamDegradationError("degradation detected")

        try:
            input_tokens = int(last_usage.prompt_token_count)
        except Exception:
            input_tokens = 0

        try:
            total_token_count = int(last_usage.total_token_count)
            prompt_token_count = int(last_usage.prompt_token_count)
            output_tokens = total_token_count - prompt_token_count
        except Exception:
            output_tokens = 0

        return response_think, response_result, input_tokens, output_tokens

    # ========== Sakura 请求 ==========

    def generate_sakura_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        result: dict[str, Any] = dict(args)
        token_key = (
            "max_completion_tokens"
            if self.should_use_max_completion_tokens()
            else "max_tokens"
        )
        result.update(
            {
                "model": self.model_id,
                "messages": messages,
                token_key: self.output_token_limit,
                "extra_headers": self.build_extra_headers(),
                "extra_body": self.extra_body,
            }
        )
        return result

    async def request_sakura_async(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            with __class__.LOCK:
                client: Any = __class__.get_async_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = await self.request_openai_chat_stream(
                client,
                self.generate_sakura_args(messages, args),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        response_result = json.dumps(
            {
                str(i): line.strip()
                for i, line in enumerate(str(response_result).strip().splitlines())
            },
            indent=None,
            ensure_ascii=False,
        )

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== OpenAI 请求 ==========

    def generate_openai_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        result: dict[str, Any] = dict(args)
        token_key = (
            "max_completion_tokens"
            if self.should_use_max_completion_tokens()
            else "max_tokens"
        )
        result.update(
            {
                "model": self.model_id,
                "messages": messages,
                token_key: self.output_token_limit,
                "extra_headers": self.build_extra_headers(),
            }
        )

        # 构建 extra_body：先设置内置值，再合并用户配置（用户值优先）
        extra_body = {}

        # GLM
        if any(v.search(self.model_id) is not None for v in __class__.RE_GLM):
            thinking_type = (
                "disabled" if self.thinking_level == ThinkingLevel.OFF else "enabled"
            )
            extra_body["thinking"] = {"type": thinking_type}
        # Kimi
        elif any(v.search(self.model_id) is not None for v in __class__.RE_KIMI):
            thinking_type = (
                "disabled" if self.thinking_level == ThinkingLevel.OFF else "enabled"
            )
            extra_body["thinking"] = {"type": thinking_type}
        # Doubao
        elif any(v.search(self.model_id) is not None for v in __class__.RE_DOUBAO):
            if self.thinking_level == ThinkingLevel.OFF:
                extra_body["reasoning_effort"] = "minimal"
                extra_body["thinking"] = {"type": "disabled"}
            else:
                extra_body["reasoning_effort"] = self.thinking_level.lower()
                extra_body["thinking"] = {"type": "enabled"}
        # DeepSeek
        elif any(v.search(self.model_id) is not None for v in __class__.RE_DEEPSEEK):
            thinking_type = (
                "disabled" if self.thinking_level == ThinkingLevel.OFF else "enabled"
            )
            extra_body["thinking"] = {"type": thinking_type}

        # 用户配置覆盖内置值
        extra_body.update(self.extra_body)
        result["extra_body"] = extra_body

        return result

    async def request_openai_async(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            with __class__.LOCK:
                client: Any = __class__.get_async_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = await self.request_openai_chat_stream(
                client,
                self.generate_openai_args(messages, args),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Google 请求 ==========

    def generate_google_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        config_args: dict[str, Any] = dict(args)
        config_args.update(
            {
                "max_output_tokens": self.output_token_limit,
                # 兼容 dict 形式，避免与 SDK 类型定义强绑定
                "safety_settings": [
                    {
                        "category": "HARM_CATEGORY_HARASSMENT",
                        "threshold": "BLOCK_NONE",
                    },
                    {
                        "category": "HARM_CATEGORY_HATE_SPEECH",
                        "threshold": "BLOCK_NONE",
                    },
                    {
                        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        "threshold": "BLOCK_NONE",
                    },
                    {
                        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                        "threshold": "BLOCK_NONE",
                    },
                ],
            }
        )

        # Gemini 3 Pro
        if __class__.RE_GEMINI_3_PRO.search(self.model_id) is not None:
            if self.thinking_level in (
                ThinkingLevel.OFF,
                ThinkingLevel.LOW,
                ThinkingLevel.MEDIUM,
            ):
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            else:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.HIGH,
                    include_thoughts=True,
                )
        # Gemini 3 Flash
        elif __class__.RE_GEMINI_3_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = {
                    "thinking_level": "MINIMAL",
                    "include_thoughts": False,
                    "thinking_budget": 0,
                }
            else:
                config_args["thinking_config"] = {
                    "thinking_level": self.thinking_level.value,
                    "include_thoughts": True,
                }
        # Gemini 2.5 Pro
        elif __class__.RE_GEMINI_2_5_PRO.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = {
                    "thinking_budget": 128,
                    "include_thoughts": True,
                }
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = {
                    "thinking_budget": 1024,
                    "include_thoughts": True,
                }
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = {
                    "thinking_budget": 1536,
                    "include_thoughts": True,
                }
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = {
                    "thinking_budget": 2048,
                    "include_thoughts": True,
                }
        # Gemini 2.5 Flash
        elif __class__.RE_GEMINI_2_5_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = {
                    "thinking_budget": 0,
                    "include_thoughts": False,
                }
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = {
                    "thinking_budget": 1024,
                    "include_thoughts": True,
                }
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = {
                    "thinking_budget": 1536,
                    "include_thoughts": True,
                }
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = {
                    "thinking_budget": 2048,
                    "include_thoughts": True,
                }

        # Custom Body
        if self.extra_body:
            config_args.update(self.extra_body)

        return {
            "model": self.model_id,
            "contents": [v.get("content") for v in messages if v.get("role") == "user"],
            "config": types.GenerateContentConfig(**config_args),
        }

    async def request_google_async(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            extra_headers_tuple = (
                tuple(sorted(self.extra_headers.items())) if self.extra_headers else ()
            )
            with __class__.LOCK:
                client: Any = __class__.get_async_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                    extra_headers_tuple=extra_headers_tuple,
                )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = await self.request_google_content_stream(
                client,
                self.generate_google_args(messages, args),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Anthropic 请求 ==========

    def generate_anthropic_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        result: dict[str, Any] = dict(args)
        result.update(
            {
                "model": self.model_id,
                "messages": messages,
                "max_tokens": self.output_token_limit,
                "extra_headers": self.build_extra_headers(),
            }
        )

        # 移除不支持的参数
        result.pop("presence_penalty", None)
        result.pop("frequency_penalty", None)

        # Claude Sonnet 3.7 / Claude Haiku 4.x / Claude Sonnet 4.x / Claude Opus 4.x
        if any(v.search(self.model_id) is not None for v in __class__.RE_CLAUDE):
            if self.thinking_level == ThinkingLevel.OFF:
                result["thinking"] = {
                    "type": "disabled",
                }
            elif self.thinking_level == ThinkingLevel.LOW:
                result["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": 1024,
                }
                result.pop("top_p", None)  # 思考模式下不支持调整
                result.pop("temperature", None)  # 思考模式下不支持调整
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                result["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": 1536,
                }
                result.pop("top_p", None)  # 思考模式下不支持调整
                result.pop("temperature", None)  # 思考模式下不支持调整
            elif self.thinking_level == ThinkingLevel.HIGH:
                result["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": 2048,
                }
                result.pop("top_p", None)  # 思考模式下不支持调整
                result.pop("temperature", None)  # 思考模式下不支持调整

        # 用户配置覆盖内置值
        if self.extra_body:
            result["extra_body"] = self.extra_body

        return result

    async def request_anthropic_async(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            with __class__.LOCK:
                client: Any = __class__.get_async_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = await self.request_anthropic_message_stream(
                client,
                self.generate_anthropic_args(messages, args),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens
