import json
import re
import threading
from functools import lru_cache

import anthropic
import httpx
import openai
from google import genai
from google.genai import types

from base.Base import Base
from base.VersionManager import VersionManager
from model.Model import ThinkingLevel
from module.Config import Config


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
    RE_CLAUDE: tuple[re.Pattern] = (
        re.compile(r"claude-3-7-sonnet", flags=re.IGNORECASE),
        re.compile(r"claude-opus-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-haiku-4-\d", flags=re.IGNORECASE),
        re.compile(r"claude-sonnet-4-\d", flags=re.IGNORECASE),
    )

    # OpenAI Compatible
    RE_GLM: tuple[re.Pattern] = (
        re.compile(r"glm-4\.5", flags=re.IGNORECASE),
        re.compile(r"glm-4\.6", flags=re.IGNORECASE),
        re.compile(r"glm-4\.7", flags=re.IGNORECASE),
    )
    RE_DOUBAO: tuple[re.Pattern] = (
        re.compile(r"doubao-seed-1-6", flags=re.IGNORECASE),
        re.compile(r"doubao-seed-1-8", flags=re.IGNORECASE),
    )
    RE_DEEPSEEK: tuple[re.Pattern] = (re.compile(r"deepseek", flags=re.IGNORECASE),)
    RE_OPENAI: tuple[re.Pattern] = (
        re.compile(r"gpt-\d", flags=re.IGNORECASE),
        re.compile(r"o\d(-mini)*(-preview)*(-\d+-\d+-\d+)*$", flags=re.IGNORECASE),
    )

    # 正则
    RE_LINE_BREAK: re.Pattern = re.compile(r"\n+")

    # 类线程锁
    LOCK: threading.Lock = threading.Lock()

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
        self.output_token_limit: int = model.get("threshold", {}).get(
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
        cls.API_KEY_INDEX: int = 0
        cls.get_url.cache_clear()
        cls.get_client.cache_clear()

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
    @lru_cache(maxsize=None)
    def get_client(
        cls,
        url: str,
        key: str,
        api_format: str,
        timeout: int,
        extra_headers_tuple: tuple = (),
    ) -> openai.OpenAI | genai.Client | anthropic.Anthropic:
        # extra_headers_tuple 用于 Google API，格式为 ((k1, v1), (k2, v2), ...)，可作为缓存 key
        if api_format == Base.APIFormat.SAKURALLM:
            return openai.OpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )
        elif api_format == Base.APIFormat.GOOGLE:
            # 合并默认 headers 和自定义 headers
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
            return genai.Client(
                api_key=key,
                http_options=http_options,
            )
        elif api_format == Base.APIFormat.ANTHROPIC:
            return anthropic.Anthropic(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )
        else:
            return openai.OpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(
                    read=timeout, pool=8.00, write=8.00, connect=8.00
                ),
                max_retries=0,
            )

    @staticmethod
    def get_default_headers() -> dict:
        """获取默认请求头"""
        return {
            "User-Agent": f"LinguaGacha/{VersionManager.get().get_version()} (https://github.com/neavo/LinguaGacha)"
        }

    def request(
        self, messages: list[dict]
    ) -> tuple[Exception | None, str, str, int, int]:
        """发起请求"""
        # 构建生成参数
        args: dict[str, float] = {}
        if self.generation.get("top_p_custom_enable"):
            args["top_p"] = self.generation.get("top_p")
        if self.generation.get("temperature_custom_enable"):
            args["temperature"] = self.generation.get("temperature")
        if self.generation.get("presence_penalty_custom_enable"):
            args["presence_penalty"] = self.generation.get("presence_penalty")
        if self.generation.get("frequency_penalty_custom_enable"):
            args["frequency_penalty"] = self.generation.get("frequency_penalty")

        # 根据 API 格式发起请求
        if self.api_format == Base.APIFormat.SAKURALLM:
            return self.request_sakura(messages, args)
        elif self.api_format == Base.APIFormat.GOOGLE:
            return self.request_google(messages, args)
        elif self.api_format == Base.APIFormat.ANTHROPIC:
            return self.request_anthropic(messages, args)
        else:
            return self.request_openai(messages, args)

    def build_extra_headers(self) -> dict:
        """构建请求头，合并自定义 Headers"""
        headers = self.get_default_headers()
        headers.update(self.extra_headers)
        return headers

    # ========== Sakura 请求 ==========

    def generate_sakura_args(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
            "extra_body": self.extra_body,
        }
        return result

    def request_sakura(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> tuple[Exception | None, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: openai.OpenAI = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: openai.types.completion.Completion = (
                client.chat.completions.create(
                    **self.generate_sakura_args(messages, args)
                )
            )

            response_result = response.choices[0].message.content
        except Exception as e:
            return e, "", "", 0, 0

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage.prompt_tokens)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(response.usage.completion_tokens)
        except Exception:
            output_tokens = 0

        # Sakura 返回的内容多行文本，将其转换为 JSON 字符串
        response_result = json.dumps(
            {
                str(i): line.strip()
                for i, line in enumerate(response_result.strip().splitlines())
            },
            indent=None,
            ensure_ascii=False,
        )

        return None, "", response_result, input_tokens, output_tokens

    # ========== OpenAI 请求 ==========

    def generate_openai_args(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
        }

        # 为 OpenAI 平台设置 max_completion_tokens
        if self.api_url.startswith("https://api.openai.com") or any(
            v.search(self.model_id) is not None for v in __class__.RE_OPENAI
        ):
            result.pop("max_tokens", None)
            result["max_completion_tokens"] = self.output_token_limit

        # 构建 extra_body：先设置内置值，再合并用户配置（用户值优先）
        extra_body = {}

        # GLM
        if any(v.search(self.model_id) is not None for v in __class__.RE_GLM):
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

    def request_openai(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> tuple[Exception | None, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: openai.OpenAI = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: openai.types.completion.Completion = (
                client.chat.completions.create(
                    **self.generate_openai_args(messages, args)
                )
            )

            # 提取回复内容
            message = response.choices[0].message
            if hasattr(message, "reasoning_content") and isinstance(
                message.reasoning_content, str
            ):
                response_think = __class__.RE_LINE_BREAK.sub(
                    "\n", message.reasoning_content.strip()
                )
                response_result = message.content.strip()
            elif "</think>" in message.content:
                splited = message.content.split("</think>")
                response_think = __class__.RE_LINE_BREAK.sub(
                    "\n", splited[0].removeprefix("<think>").strip()
                )
                response_result = splited[-1].strip()
            else:
                response_think = ""
                response_result = message.content.strip()
        except Exception as e:
            return e, "", "", 0, 0

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage.prompt_tokens)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(response.usage.completion_tokens)
        except Exception:
            output_tokens = 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Google 请求 ==========

    def generate_google_args(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> dict:
        config_args = args | {
            "max_output_tokens": self.output_token_limit,
            "safety_settings": (
                types.SafetySetting(
                    category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"
                ),
                types.SafetySetting(
                    category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"
                ),
            ),
        }

        # Gemini 3 Pro
        if __class__.RE_GEMINI_3_PRO.search(self.model_id) is not None:
            if self.thinking_level in (
                ThinkingLevel.OFF,
                ThinkingLevel.LOW,
                ThinkingLevel.MEDIUM,
            ):
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level="low",
                    include_thoughts=True,
                )
            else:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level="high",
                    include_thoughts=True,
                )
        # Gemini 3 Flash
        elif __class__.RE_GEMINI_3_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level="minimal",
                    include_thoughts=False,
                )
            else:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=self.thinking_level.lower(),
                    include_thoughts=True,
                )
        # Gemini 2.5 Pro
        elif __class__.RE_GEMINI_2_5_PRO.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=128,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=1024,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=1536,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=2048,
                    include_thoughts=True,
                )
        # Gemini 2.5 Flash
        elif __class__.RE_GEMINI_2_5_FLASH.search(self.model_id) is not None:
            if self.thinking_level == ThinkingLevel.OFF:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=0,
                    include_thoughts=False,
                )
            elif self.thinking_level == ThinkingLevel.LOW:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=1024,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.MEDIUM:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=1536,
                    include_thoughts=True,
                )
            elif self.thinking_level == ThinkingLevel.HIGH:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinkingBudget=2048,
                    include_thoughts=True,
                )

        # Custom Body
        if self.extra_body:
            config_args.update(self.extra_body)

        return {
            "model": self.model_id,
            "contents": [v.get("content") for v in messages if v.get("role") == "user"],
            "config": types.GenerateContentConfig(**config_args),
        }

    def request_google(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> tuple[Exception | None, str, str, int, int]:
        try:
            # 将 custom_headers 转换为 tuple 以支持 lru_cache
            extra_headers_tuple = (
                tuple(sorted(self.extra_headers.items())) if self.extra_headers else ()
            )
            with __class__.LOCK:
                client: genai.Client = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                    extra_headers_tuple=extra_headers_tuple,
                )

            response: types.GenerateContentResponse = client.models.generate_content(
                **self.generate_google_args(messages, args)
            )

            # 提取回复内容
            response_think = ""
            response_result = ""
            if (
                len(response.candidates) > 0
                and len(response.candidates[-1].content.parts) > 0
            ):
                parts = response.candidates[-1].content.parts
                think_messages = [v for v in parts if v.thought]
                if len(think_messages) > 0:
                    response_think = __class__.RE_LINE_BREAK.sub(
                        "\n", think_messages[-1].text.strip()
                    )
                result_messages = [v for v in parts if not v.thought]
                if len(result_messages) > 0:
                    response_result = result_messages[-1].text.strip()
        except Exception as e:
            return e, "", "", 0, 0

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage_metadata.prompt_token_count)
        except Exception:
            input_tokens = 0

        try:
            total_token_count = int(response.usage_metadata.total_token_count)
            prompt_token_count = int(response.usage_metadata.prompt_token_count)
            output_tokens = total_token_count - prompt_token_count
        except Exception:
            output_tokens = 0

        return None, response_think, response_result, input_tokens, output_tokens

    # ========== Anthropic 请求 ==========

    def generate_anthropic_args(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
        }

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

    def request_anthropic(
        self, messages: list[dict[str, str]], args: dict[str, float]
    ) -> tuple[Exception | None, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: anthropic.Anthropic = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: anthropic.types.Message = client.messages.create(
                **self.generate_anthropic_args(messages, args)
            )

            # 提取回复内容
            text_messages = [
                msg
                for msg in response.content
                if hasattr(msg, "text") and isinstance(msg.text, str)
            ]
            think_messages = [
                msg
                for msg in response.content
                if hasattr(msg, "thinking") and isinstance(msg.thinking, str)
            ]

            if text_messages:
                response_result = text_messages[-1].text.strip()
            else:
                response_result = ""

            if think_messages:
                response_think = __class__.RE_LINE_BREAK.sub(
                    "\n", think_messages[-1].thinking.strip()
                )
            else:
                response_think = ""
        except Exception as e:
            return e, "", "", 0, 0

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage.input_tokens)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(response.usage.output_tokens)
        except Exception:
            output_tokens = 0

        return None, response_think, response_result, input_tokens, output_tokens
