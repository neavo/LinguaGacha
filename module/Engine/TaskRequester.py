import dataclasses
import re
import time
from contextlib import contextmanager
from typing import Any
from typing import Callable
from typing import Iterator

import anthropic
import openai
from google import genai
from google.genai import types

from base.Base import Base
from model.Model import ThinkingLevel
from module.Config import Config
from module.Engine.Engine import Engine
from module.Engine.TaskRequesterClientPool import TaskRequesterClientPool
from module.Engine.TaskRequesterErrors import RequestCancelledError
from module.Engine.TaskRequesterErrors import StreamDegradationError
from module.Engine.TaskRequesterStream import StreamConsumer
from module.Engine.TaskRequesterStream import StreamControl
from module.Engine.TaskRequesterStream import StreamSession
from module.Engine.TaskRequesterStream import StreamStrategy
from module.Engine.TaskRequesterStream import safe_close_resource
from module.Utils.JSONTool import JSONTool


class TaskRequester(Base):
    """任务请求器 - 负责向各种 LLM API 发送同步流式请求。

    设计要点：
    - 并发由线程池承担；请求器本身完全同步。
    - 流式消费/硬超时/stop 检查统一在 `TaskRequesterStream`。
    - 协议差异（OpenAI/Anthropic/Google 的 chunk 结构与最终结果提取）用 Strategy 隔离。
    """

    # Gemini
    RE_GEMINI_2_5_PRO: re.Pattern = re.compile(r"gemini-2\.5-pro", flags=re.IGNORECASE)
    RE_GEMINI_2_5_FLASH: re.Pattern = re.compile(
        r"gemini-2\.5-flash", flags=re.IGNORECASE
    )
    RE_GEMINI_3_PRO: re.Pattern = re.compile(r"gemini-3-pro", flags=re.IGNORECASE)
    RE_GEMINI_3_FLASH: re.Pattern = re.compile(r"gemini-3-flash", flags=re.IGNORECASE)
    RE_GEMINI_3_1_PRO: re.Pattern = re.compile(r"gemini-3\.1-pro", flags=re.IGNORECASE)

    # Claude
    RE_CLAUDE: tuple[re.Pattern, ...] = (
        re.compile(r"claude-3-7-sonnet", flags=re.IGNORECASE),
        re.compile(r"claude-opus-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-haiku-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-sonnet-4-\d", flags=re.IGNORECASE),
    )

    # OpenAI - GPT5
    RE_GPT5: tuple[re.Pattern, ...] = (re.compile(r"gpt-5", flags=re.IGNORECASE),)

    # OpenAI - DOUBAO
    RE_DOUBAO: tuple[re.Pattern, ...] = (
        re.compile(r"doubao-seed-1-6", flags=re.IGNORECASE),
        re.compile(r"doubao-seed-1-8", flags=re.IGNORECASE),
        re.compile(r"doubao-seed-2-0", flags=re.IGNORECASE),
    )

    # OpenAI - THINKING_TYPE
    RE_THINKING_TYPE: tuple[re.Pattern, ...] = (
        re.compile(r"glm", flags=re.IGNORECASE),
        re.compile(r"kimi", flags=re.IGNORECASE),
        re.compile(r"deepseek", flags=re.IGNORECASE),
    )

    RE_LINE_BREAK: re.Pattern = re.compile(r"\n+")

    # 阈值统一按"重复次数"统计，避免不同周期下的字符数语义不一致。
    STREAM_DEGRADATION_REPEAT_THRESHOLD: int = 50

    # 这是收尾时的保险检查，不是主流程。
    # 理论上 150 个有效字符就可能判定重复，但实际文本常夹杂空格和换行。
    # 所以这里留一定的字符窗口，多看一点，避免漏判。
    STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS: int = 512

    SDK_TIMEOUT_BUFFER_S: int = 5

    def __init__(self, config: Config, model: dict) -> None:
        super().__init__()
        self.config = config
        self.model = model

        self.api_url: str = model.get("api_url", "")
        self.api_format: str = model.get("api_format", "OpenAI")
        self.model_id: str = model.get("model_id", "")

        api_keys_str = str(model.get("api_key", ""))
        self.api_keys: list[str] = [
            k.strip() for k in api_keys_str.split("\n") if k.strip()
        ]

        self.output_token_limit = model.get("threshold", {}).get(
            "output_token_limit", 4096
        )

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

        thinking_config = model.get("thinking", {})
        thinking_level_str = thinking_config.get("level", "OFF")
        try:
            self.thinking_level = ThinkingLevel(thinking_level_str)
        except ValueError:
            self.thinking_level = ThinkingLevel.OFF

        self.generation = model.get("generation", {})

    @classmethod
    def reset(cls) -> None:
        TaskRequesterClientPool.reset()

    def should_use_max_completion_tokens(self) -> bool:
        return str(self.api_url).startswith("https://api.openai.com")

    def get_sdk_timeout_seconds(self) -> int:
        # 同步模式下无法像 asyncio 那样快速取消阻塞拉取，因此依赖 SDK 超时来兜底退出。
        hard_timeout_s = max(1, int(self.config.request_timeout))
        return hard_timeout_s + self.SDK_TIMEOUT_BUFFER_S

    def request(
        self,
        messages: list[dict],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        args: dict[str, Any] = {}
        if self.generation.get("top_p_custom_enable"):
            args["top_p"] = self.generation.get("top_p")
        if self.generation.get("temperature_custom_enable"):
            args["temperature"] = self.generation.get("temperature")
        if self.generation.get("presence_penalty_custom_enable"):
            args["presence_penalty"] = self.generation.get("presence_penalty")
        if self.generation.get("frequency_penalty_custom_enable"):
            args["frequency_penalty"] = self.generation.get("frequency_penalty")

        Engine.get().inc_request_in_flight()
        try:
            if self.api_format == Base.APIFormat.SAKURALLM:
                return self.request_sakura(messages, args, stop_checker=stop_checker)
            if self.api_format == Base.APIFormat.GOOGLE:
                return self.request_google(messages, args, stop_checker=stop_checker)
            if self.api_format == Base.APIFormat.ANTHROPIC:
                return self.request_anthropic(messages, args, stop_checker=stop_checker)
            return self.request_openai(messages, args, stop_checker=stop_checker)
        finally:
            Engine.get().dec_request_in_flight()

    def build_extra_headers(self) -> dict:
        headers = TaskRequesterClientPool.get_default_headers()
        headers.update(self.extra_headers)
        return headers

    @classmethod
    def extract_openai_think_and_result(cls, message: Any) -> tuple[str, str]:
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
    def has_output_degradation(cls, text: str) -> bool:
        if not text:
            return False
        detector = cls.DegradationDetector()
        return detector.feed(text)

    @dataclasses.dataclass
    class DegradationDetector:
        """流式退化检测器。

        - 周期 1：`AAA...`，按连续单字符重复次数计数。
        - 周期 2：`ABAB...`，按完整 `AB` 循环次数计数。
        - 周期 3：`ABCABC...`，按完整 `ABC` 循环次数计数。
        """

        last_char: str | None = None
        second_last_char: str | None = None
        third_last_char: str | None = None
        single_run: int = 0
        alternating_run: int = 0
        alternating_char_run: int = 0
        period_3_run: int = 0
        period_3_char_run: int = 0

        def feed(self, text: str) -> bool:
            for ch in text:
                if ch.isspace():
                    continue

                if self.last_char is None:
                    self.last_char = ch
                    self.single_run = 1
                    self.alternating_char_run = 1
                    self.alternating_run = 0
                    self.period_3_char_run = 1
                    self.period_3_run = 0
                    continue

                if ch == self.last_char:
                    self.single_run += 1
                else:
                    self.single_run = 1

                if self.single_run >= TaskRequester.STREAM_DEGRADATION_REPEAT_THRESHOLD:
                    return True

                if (
                    self.second_last_char is not None
                    and ch == self.second_last_char
                    and self.second_last_char != self.last_char
                ):
                    # 只有满足 AB 位置回环时才延长周期 2 序列，避免把普通重复误算为退化。
                    self.alternating_char_run += 1
                else:
                    self.alternating_char_run = 2 if ch != self.last_char else 1

                self.alternating_run = self.alternating_char_run // 2

                if (
                    self.alternating_run
                    >= TaskRequester.STREAM_DEGRADATION_REPEAT_THRESHOLD
                ):
                    return True

                if (
                    self.third_last_char is not None
                    and self.second_last_char is not None
                    and ch == self.third_last_char
                    and self.third_last_char != self.second_last_char
                    and self.second_last_char != self.last_char
                    and self.third_last_char != self.last_char
                ):
                    # 周期 3 必须满足三字符都不同，避免把 ABAA 这类模式误判为 ABC 循环。
                    self.period_3_char_run += 1
                elif (
                    self.second_last_char is not None
                    and ch != self.last_char
                    and ch != self.second_last_char
                    and self.last_char != self.second_last_char
                ):
                    # 当窗口首次形成 3 个不同字符时，从 1 轮 ABC 候选重新开始计数。
                    self.period_3_char_run = 3
                else:
                    # 一旦不满足周期 3 条件，回落到最小窗口，避免跨模式串联误判。
                    self.period_3_char_run = 1

                self.period_3_run = self.period_3_char_run // 3
                if (
                    self.period_3_run
                    >= TaskRequester.STREAM_DEGRADATION_REPEAT_THRESHOLD
                ):
                    return True

                # 状态只在本轮检测结束后推进，确保所有判断都基于同一时刻的历史窗口。
                self.third_last_char = self.second_last_char
                self.second_last_char = self.last_char
                self.last_char = ch

            return False

    @dataclasses.dataclass
    class OpenAIStreamState:
        degradation_detector: "TaskRequester.DegradationDetector" = dataclasses.field(
            default_factory=lambda: TaskRequester.DegradationDetector()
        )

    class OpenAIStreamStrategy:
        def __init__(self, requester: "TaskRequester") -> None:
            self.requester = requester

        def create_state(self) -> "TaskRequester.OpenAIStreamState":
            return TaskRequester.OpenAIStreamState()

        @contextmanager
        def build_stream_session(
            self,
            client: openai.OpenAI,
            request_args: dict[str, Any],
        ) -> Iterator[StreamSession]:
            with client.chat.completions.stream(**request_args) as stream:
                iterator: Any = iter(stream) if hasattr(stream, "__iter__") else stream

                def close() -> Any:
                    return safe_close_resource(stream)

                yield StreamSession(
                    iterator=iterator,
                    close=close,
                    finalize=stream.get_final_completion,
                )

        def handle_item(
            self, state: "TaskRequester.OpenAIStreamState", item: Any
        ) -> None:
            event_type = getattr(item, "type", "")
            if event_type != "content.delta":
                return

            text = getattr(item, "content", None)
            if not isinstance(text, str) or not text:
                return

            if state.degradation_detector.feed(text):
                raise StreamDegradationError("degradation detected")

        def finalize(
            self,
            session: StreamSession,
            state: "TaskRequester.OpenAIStreamState",
        ) -> tuple[str, str, int, int]:
            if session.finalize is None:
                raise RuntimeError("OpenAI stream missing finalize")

            completion: Any = session.finalize()
            message = completion.choices[0].message
            response_think, response_result = (
                self.requester.extract_openai_think_and_result(message)
            )

            if self.requester.has_output_degradation(
                response_result[
                    -self.requester.STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS :
                ]
            ):
                raise StreamDegradationError("degradation detected")

            usage: Any = getattr(completion, "usage", None)
            try:
                input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            except TypeError, ValueError:
                input_tokens = 0

            try:
                output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            except TypeError, ValueError:
                output_tokens = 0

            return response_think, response_result, input_tokens, output_tokens

    @dataclasses.dataclass
    class AnthropicStreamState:
        degradation_detector: "TaskRequester.DegradationDetector" = dataclasses.field(
            default_factory=lambda: TaskRequester.DegradationDetector()
        )

    class AnthropicStreamStrategy:
        def __init__(self, requester: "TaskRequester") -> None:
            self.requester = requester

        def create_state(self) -> "TaskRequester.AnthropicStreamState":
            return TaskRequester.AnthropicStreamState()

        @contextmanager
        def build_stream_session(
            self,
            client: anthropic.Anthropic,
            request_args: dict[str, Any],
        ) -> Iterator[StreamSession]:
            with client.messages.stream(**request_args) as stream:
                iterator: Any = stream.text_stream
                yield StreamSession(
                    iterator=iterator,
                    close=stream.close,
                    finalize=stream.get_final_message,
                )

        def handle_item(
            self, state: "TaskRequester.AnthropicStreamState", item: Any
        ) -> None:
            if not isinstance(item, str) or not item:
                return
            if state.degradation_detector.feed(item):
                raise StreamDegradationError("degradation detected")

        def finalize(
            self,
            session: StreamSession,
            state: "TaskRequester.AnthropicStreamState",
        ) -> tuple[str, str, int, int]:
            if session.finalize is None:
                raise RuntimeError("Anthropic stream missing finalize")

            message: Any = session.finalize()

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
                self.requester.RE_LINE_BREAK.sub("\n", think_messages[-1].strip())
                if think_messages
                else ""
            )

            if self.requester.has_output_degradation(
                response_result[
                    -self.requester.STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS :
                ]
            ):
                raise StreamDegradationError("degradation detected")

            usage: Any = getattr(message, "usage", None)
            try:
                input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
            except TypeError, ValueError:
                input_tokens = 0

            try:
                output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
            except TypeError, ValueError:
                output_tokens = 0

            return response_think, response_result, input_tokens, output_tokens

    @dataclasses.dataclass
    class GoogleStreamState:
        think_parts: list[str] = dataclasses.field(default_factory=list)
        result_parts: list[str] = dataclasses.field(default_factory=list)
        degradation_detector: "TaskRequester.DegradationDetector" = dataclasses.field(
            default_factory=lambda: TaskRequester.DegradationDetector()
        )
        last_usage: Any = None

    class GoogleStreamStrategy:
        def __init__(self, requester: "TaskRequester") -> None:
            self.requester = requester

        def create_state(self) -> "TaskRequester.GoogleStreamState":
            return TaskRequester.GoogleStreamState()

        @contextmanager
        def build_stream_session(
            self,
            client: genai.Client,
            request_args: dict[str, Any],
        ) -> Iterator[StreamSession]:
            generator = client.models.generate_content_stream(**request_args)

            def close() -> Any:
                return safe_close_resource(generator)

            yield StreamSession(iterator=generator, close=close)

        def handle_item(
            self, state: "TaskRequester.GoogleStreamState", item: Any
        ) -> None:
            candidates = getattr(item, "candidates", None)
            if candidates and len(candidates) > 0:
                content = getattr(candidates[0], "content", None)
                if content:
                    parts = getattr(content, "parts", None)
                    if parts:
                        for part in parts:
                            text = getattr(part, "text", None)
                            if not isinstance(text, str) or not text:
                                continue
                            is_thought = getattr(part, "thought", False)
                            if is_thought:
                                state.think_parts.append(text)
                            else:
                                state.result_parts.append(text)
                                if state.degradation_detector.feed(text):
                                    raise StreamDegradationError("degradation detected")

            usage_metadata = getattr(item, "usage_metadata", None)
            if usage_metadata is not None:
                state.last_usage = usage_metadata

        def finalize(
            self,
            session: StreamSession,
            state: "TaskRequester.GoogleStreamState",
        ) -> tuple[str, str, int, int]:
            response_result = "".join(state.result_parts).strip()
            response_think = self.requester.RE_LINE_BREAK.sub(
                "\n", "".join(state.think_parts).strip()
            )

            if self.requester.has_output_degradation(
                response_result[
                    -self.requester.STREAM_DEGRADATION_FALLBACK_WINDOW_CHARS :
                ]
            ):
                raise StreamDegradationError("degradation detected")

            last_usage: Any = state.last_usage
            try:
                input_tokens = int(last_usage.prompt_token_count)
            except AttributeError, TypeError, ValueError:
                input_tokens = 0

            try:
                total_token_count = int(last_usage.total_token_count)
                prompt_token_count = int(last_usage.prompt_token_count)
                output_tokens = total_token_count - prompt_token_count
            except AttributeError, TypeError, ValueError:
                output_tokens = 0

            return response_think, response_result, input_tokens, output_tokens

    def request_stream_with_strategy(
        self,
        client: Any,
        request_args: dict[str, Any],
        strategy: StreamStrategy,
        *,
        stop_checker: Callable[[], bool] | None,
    ) -> tuple[str, str, int, int]:
        deadline_monotonic = time.monotonic() + float(self.config.request_timeout)
        control = StreamControl.create(
            stop_checker=stop_checker,
            deadline_monotonic=deadline_monotonic,
        )
        state = strategy.create_state()

        with strategy.build_stream_session(client, request_args) as session:

            def on_item(item: Any) -> None:
                strategy.handle_item(state, item)

            StreamConsumer.consume(session, control, on_item=on_item)
            return strategy.finalize(session, state)

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
        result.setdefault("stream_options", {"include_usage": True})
        return result

    def request_sakura(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            client: Any = TaskRequesterClientPool.get_client(
                url=TaskRequesterClientPool.get_url(self.api_url, self.api_format),
                key=TaskRequesterClientPool.get_key(self.api_keys),
                api_format=self.api_format,
                timeout=self.get_sdk_timeout_seconds(),
            )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = self.request_stream_with_strategy(
                client,
                self.generate_sakura_args(messages, args),
                __class__.OpenAIStreamStrategy(self),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        response_result = JSONTool.dumps(
            {
                str(i): line.strip()
                for i, line in enumerate(str(response_result).strip().splitlines())
            },
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
        result.setdefault("stream_options", {"include_usage": True})

        extra_body: dict[str, Any] = {}
        if any(v.search(self.model_id) is not None for v in __class__.RE_GPT5):
            if self.thinking_level == ThinkingLevel.OFF:
                extra_body["reasoning_effort"] = "none"
            else:
                extra_body["reasoning_effort"] = self.thinking_level.lower()
        elif any(v.search(self.model_id) is not None for v in __class__.RE_DOUBAO):
            if self.thinking_level == ThinkingLevel.OFF:
                extra_body["reasoning_effort"] = "minimal"
            else:
                extra_body["reasoning_effort"] = self.thinking_level.lower()
        elif any(
            v.search(self.model_id) is not None for v in __class__.RE_THINKING_TYPE
        ):
            thinking_type = (
                "disabled" if self.thinking_level == ThinkingLevel.OFF else "enabled"
            )
            extra_body["thinking"] = {"type": thinking_type}

        extra_body.update(self.extra_body)
        result["extra_body"] = extra_body

        return result

    def request_openai(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            client: Any = TaskRequesterClientPool.get_client(
                url=TaskRequesterClientPool.get_url(self.api_url, self.api_format),
                key=TaskRequesterClientPool.get_key(self.api_keys),
                api_format=self.api_format,
                timeout=self.get_sdk_timeout_seconds(),
            )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = self.request_stream_with_strategy(
                client,
                self.generate_openai_args(messages, args),
                __class__.OpenAIStreamStrategy(self),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Google 请求 ==========

    def generate_google_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        system_texts: list[str] = []
        user_texts: list[str] = []
        for msg in messages:
            content = msg.get("content")
            if not isinstance(content, str):
                continue

            role = msg.get("role")
            if role == "system":
                if content.strip() != "":
                    system_texts.append(content)
            elif role == "user":
                user_texts.append(content)

        config_args: dict[str, Any] = dict(args)
        config_args.update(
            {
                "max_output_tokens": self.output_token_limit,
                "safety_settings": [
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
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

        # Gemini
        if __class__.RE_GEMINI_3_1_PRO.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.MEDIUM,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.HIGH,
                    include_thoughts=True,
                )
        elif __class__.RE_GEMINI_3_PRO.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.HIGH,
                    include_thoughts=True,
                )
        elif __class__.RE_GEMINI_3_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.MINIMAL,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.LOW,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.MEDIUM,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.HIGH,
                    include_thoughts=True,
                )
        elif __class__.RE_GEMINI_2_5_PRO.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=128,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=384,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=768,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=1024,
                    include_thoughts=True,
                )
        elif __class__.RE_GEMINI_2_5_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=0,
                    include_thoughts=False,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=384,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=768,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=1024,
                    include_thoughts=True,
                )

        if self.extra_body:
            config_args.update(self.extra_body)

        if system_texts:
            config_args["system_instruction"] = "\n\n".join(system_texts)

        return {
            "model": self.model_id,
            "contents": user_texts,
            "config": types.GenerateContentConfig(**config_args),
        }

    def request_google(
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
            client: Any = TaskRequesterClientPool.get_client(
                url=TaskRequesterClientPool.get_url(self.api_url, self.api_format),
                key=TaskRequesterClientPool.get_key(self.api_keys),
                api_format=self.api_format,
                timeout=self.get_sdk_timeout_seconds(),
                extra_headers_tuple=extra_headers_tuple,
            )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = self.request_stream_with_strategy(
                client,
                self.generate_google_args(messages, args),
                __class__.GoogleStreamStrategy(self),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Anthropic 请求 ==========

    def generate_anthropic_args(
        self, messages: list[dict[str, str]], args: dict[str, Any]
    ) -> dict:
        system_texts: list[str] = []
        filtered_messages: list[dict[str, str]] = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                if isinstance(content, str) and content.strip() != "":
                    system_texts.append(content)
                continue
            filtered_messages.append(msg)

        result: dict[str, Any] = dict(args)
        result.update(
            {
                "model": self.model_id,
                "messages": filtered_messages,
                "max_tokens": self.output_token_limit,
                "extra_headers": self.build_extra_headers(),
            }
        )

        if system_texts:
            result["system"] = "\n\n".join(system_texts)

        result.pop("presence_penalty", None)
        result.pop("frequency_penalty", None)

        if any(v.search(self.model_id) is not None for v in __class__.RE_CLAUDE):
            if self.thinking_level == ThinkingLevel.OFF:
                result["thinking"] = {"type": "disabled"}
            elif self.thinking_level == ThinkingLevel.LOW:
                result["thinking"] = {"type": "enabled", "budget_tokens": 384}
                result.pop("top_p", None)
                result.pop("temperature", None)
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                result["thinking"] = {"type": "enabled", "budget_tokens": 768}
                result.pop("top_p", None)
                result.pop("temperature", None)
            elif self.thinking_level == ThinkingLevel.HIGH:
                result["thinking"] = {"type": "enabled", "budget_tokens": 1024}
                result.pop("top_p", None)
                result.pop("temperature", None)

        if self.extra_body:
            result["extra_body"] = self.extra_body

        return result

    def request_anthropic(
        self,
        messages: list[dict[str, str]],
        args: dict[str, Any],
        *,
        stop_checker: Callable[[], bool] | None = None,
    ) -> tuple[Exception | None, str, str, int, int]:
        if stop_checker is not None and stop_checker():
            return RequestCancelledError("stop requested"), "", "", 0, 0

        try:
            client: Any = TaskRequesterClientPool.get_client(
                url=TaskRequesterClientPool.get_url(self.api_url, self.api_format),
                key=TaskRequesterClientPool.get_key(self.api_keys),
                api_format=self.api_format,
                timeout=self.get_sdk_timeout_seconds(),
            )

            (
                response_think,
                response_result,
                input_tokens,
                output_tokens,
            ) = self.request_stream_with_strategy(
                client,
                self.generate_anthropic_args(messages, args),
                __class__.AnthropicStreamStrategy(self),
                stop_checker=stop_checker,
            )
        except Exception as e:
            return e, "", "", 0, 0

        return None, response_think, response_result, input_tokens, output_tokens
