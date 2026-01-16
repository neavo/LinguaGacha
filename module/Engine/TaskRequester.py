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
from module.Localizer.Localizer import Localizer

class TaskRequester(Base):
    """
    任务请求器 - 负责向各种 LLM API 发送请求
    直接使用新的 Model 数据结构，不兼容旧的 platform 格式
    """

    # 密钥索引
    API_KEY_INDEX: int = 0

    # Gemini
    RE_GEMINI_2_5_FLASH: re.Pattern = re.compile(r"gemini-2\.5-flash", flags=re.IGNORECASE)
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
    RE_DEEPSEEK: tuple[re.Pattern] = (
        re.compile(r"deepseek-v3-1", flags=re.IGNORECASE),
        re.compile(r"deepseek-v3-2", flags=re.IGNORECASE),
        re.compile(r"deepseek-v3\.1", flags=re.IGNORECASE),
        re.compile(r"deepseek-v3\.2", flags=re.IGNORECASE),
    )
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
        api_key_raw = model.get("api_key", "")
        if isinstance(api_key_raw, str):
            self.api_keys: list[str] = [k.strip() for k in api_key_raw.split("\n") if k.strip()]
        elif isinstance(api_key_raw, list):
            self.api_keys = api_key_raw
        else:
            self.api_keys = []

        # 提取阈值配置
        self.output_token_limit: int = model.get("thresholds", {}).get("output_token_limit", 4096)

        # 提取网络配置
        network_config = model.get("network_config", {})
        self.custom_headers: dict = network_config.get("custom_headers", {})
        self.custom_body: dict = network_config.get("custom_body", {})

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
    @lru_cache(maxsize=None)
    def get_client(cls, url: str, key: str, api_format: str, timeout: int) -> openai.OpenAI | genai.Client | anthropic.Anthropic:
        if api_format == Base.APIFormat.SAKURALLM:
            return openai.OpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(read=timeout, pool=8.00, write=8.00, connect=8.00),
                max_retries=0,
            )
        elif api_format == Base.APIFormat.GOOGLE:
            return genai.Client(
                api_key=key,
                http_options=types.HttpOptions(
                    base_url=url,
                    timeout=timeout * 1000,
                    headers={
                        "User-Agent": f"LinguaGacha/{VersionManager.get().get_version()} (https://github.com/neavo/LinguaGacha)",
                    },
                ),
            )
        elif api_format == Base.APIFormat.ANTHROPIC:
            return anthropic.Anthropic(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(read=timeout, pool=8.00, write=8.00, connect=8.00),
                max_retries=0,
            )
        else:
            return openai.OpenAI(
                base_url=url,
                api_key=key,
                timeout=httpx.Timeout(read=timeout, pool=8.00, write=8.00, connect=8.00),
                max_retries=0,
            )

    def request(self, messages: list[dict]) -> tuple[bool, str, str, int, int]:
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
        headers = {
            "User-Agent": f"LinguaGacha/{VersionManager.get().get_version()} (https://github.com/neavo/LinguaGacha)"
        }
        headers.update(self.custom_headers)
        return headers

    # ========== Sakura 请求 ==========

    def generate_sakura_args(self, messages: list[dict[str, str]], args: dict[str, float]) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
        }

        # 合并自定义 Body
        if self.custom_body:
            result["extra_body"] = result.get("extra_body", {})
            result["extra_body"].update(self.custom_body)

        return result

    def request_sakura(self, messages: list[dict[str, str]], args: dict[str, float]) -> tuple[bool, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: openai.OpenAI = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: openai.types.completion.Completion = client.chat.completions.create(
                **self.generate_sakura_args(messages, args)
            )

            response_result = response.choices[0].message.content
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

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
            {str(i): line.strip() for i, line in enumerate(response_result.strip().splitlines())},
            indent=None,
            ensure_ascii=False,
        )

        return False, "", response_result, input_tokens, output_tokens

    # ========== OpenAI 请求 ==========

    def generate_openai_args(self, messages: list[dict[str, str]], args: dict[str, float]) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
        }

        # 初始化 extra_body 并合并自定义 Body
        result["extra_body"] = result.get("extra_body", {})
        if self.custom_body:
            result["extra_body"].update(self.custom_body)

        # 为 OpenAI 平台设置 max_completion_tokens
        if (
            self.api_url.startswith("https://api.openai.com")
            or any(v.search(self.model_id) is not None for v in __class__.RE_OPENAI)
        ):
            result.pop("max_tokens", None)
            result["max_completion_tokens"] = self.output_token_limit

        # 思考挡位映射
        thinking_enabled = self.thinking_level != ThinkingLevel.OFF

        # GLM
        if any(v.search(self.model_id) is not None for v in __class__.RE_GLM):
            if thinking_enabled:
                result["extra_body"].setdefault("thinking", {})["type"] = "enabled"
            else:
                result["extra_body"].setdefault("thinking", {})["type"] = "disabled"
        # Doubao
        elif any(v.search(self.model_id) is not None for v in __class__.RE_DOUBAO):
            if thinking_enabled:
                effort_mapping = {
                    ThinkingLevel.LOW: "low",
                    ThinkingLevel.MEDIUM: "medium",
                    ThinkingLevel.HIGH: "high",
                }
                result["extra_body"]["reasoning_effort"] = effort_mapping.get(self.thinking_level, "low")
                result["extra_body"].setdefault("thinking", {})["type"] = "enabled"
            else:
                result["extra_body"]["reasoning_effort"] = "minimal"
                result["extra_body"].setdefault("thinking", {})["type"] = "disabled"
        # DeepSeek
        elif any(v.search(self.model_id) is not None for v in __class__.RE_DEEPSEEK):
            if thinking_enabled:
                result["extra_body"].setdefault("thinking", {})["type"] = "enabled"
            else:
                result["extra_body"].setdefault("thinking", {})["type"] = "disabled"

        return result

    def request_openai(self, messages: list[dict[str, str]], args: dict[str, float]) -> tuple[bool, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: openai.OpenAI = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: openai.types.completion.Completion = client.chat.completions.create(
                **self.generate_openai_args(messages, args)
            )

            # 提取回复内容
            message = response.choices[0].message
            if hasattr(message, "reasoning_content") and isinstance(message.reasoning_content, str):
                response_think = __class__.RE_LINE_BREAK.sub("\n", message.reasoning_content.strip())
                response_result = message.content.strip()
            elif "</think>" in message.content:
                splited = message.content.split("</think>")
                response_think = __class__.RE_LINE_BREAK.sub("\n", splited[0].removeprefix("<think>").strip())
                response_result = splited[-1].strip()
            else:
                response_think = ""
                response_result = message.content.strip()
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage.prompt_tokens)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(response.usage.completion_tokens)
        except Exception:
            output_tokens = 0

        return False, response_think, response_result, input_tokens, output_tokens

    # ========== Google 请求 ==========

    def generate_google_args(self, messages: list[dict[str, str]], args: dict[str, float]) -> dict:
        config_args = args | {
            "max_output_tokens": self.output_token_limit,
            "safety_settings": (
                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
            ),
        }

        # 思考挡位映射
        thinking_enabled = self.thinking_level != ThinkingLevel.OFF

        # Gemini 2.5 Flash - 使用 budget 模式
        if __class__.RE_GEMINI_2_5_FLASH.search(self.model_id) is not None:
            if thinking_enabled:
                budget_mapping = {
                    ThinkingLevel.LOW: 1024,
                    ThinkingLevel.MEDIUM: 1536,
                    ThinkingLevel.HIGH: 2048,
                }
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=budget_mapping.get(self.thinking_level, 1024),
                    include_thoughts=True,
                )
            else:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_budget=0,
                    include_thoughts=False,
                )
        # Gemini 3 Flash - 使用 level 模式
        elif __class__.RE_GEMINI_3_FLASH.search(self.model_id) is not None:
            if thinking_enabled:
                level_mapping = {
                    ThinkingLevel.LOW: "low",
                    ThinkingLevel.MEDIUM: "medium",
                    ThinkingLevel.HIGH: "high",
                }
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level=level_mapping.get(self.thinking_level, "low"),
                )
            else:
                config_args["thinking_config"] = types.ThinkingConfig(
                    thinking_level="minimal",
                )

        return {
            "model": self.model_id,
            "contents": [v.get("content") for v in messages if v.get("role") == "user"],
            "config": types.GenerateContentConfig(**config_args),
        }

    def request_google(self, messages: list[dict[str, str]], args: dict[str, float]) -> tuple[bool, str, str, int, int]:
        try:
            with __class__.LOCK:
                client: genai.Client = __class__.get_client(
                    url=__class__.get_url(self.api_url, self.api_format),
                    key=__class__.get_key(self.api_keys),
                    api_format=self.api_format,
                    timeout=self.config.request_timeout,
                )

            response: types.GenerateContentResponse = client.models.generate_content(
                **self.generate_google_args(messages, args)
            )

            # 提取回复内容
            response_think = ""
            response_result = ""
            if len(response.candidates) > 0 and len(response.candidates[-1].content.parts) > 0:
                parts = response.candidates[-1].content.parts
                think_messages = [v for v in parts if v.thought == True]
                if len(think_messages) > 0:
                    response_think = __class__.RE_LINE_BREAK.sub("\n", think_messages[-1].text.strip())
                result_messages = [v for v in parts if v.thought != True]
                if len(result_messages) > 0:
                    response_result = result_messages[-1].text.strip()
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

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

        return False, response_think, response_result, input_tokens, output_tokens

    # ========== Anthropic 请求 ==========

    def generate_anthropic_args(self, messages: list[dict[str, str]], args: dict[str, float]) -> dict:
        result = args | {
            "model": self.model_id,
            "messages": messages,
            "max_tokens": self.output_token_limit,
            "extra_headers": self.build_extra_headers(),
        }

        # 移除不支持的参数
        result.pop("presence_penalty", None)
        result.pop("frequency_penalty", None)

        # 思考挡位映射
        thinking_enabled = self.thinking_level != ThinkingLevel.OFF

        # Claude-3.7 Claude-4.0
        if any(v.search(self.model_id) is not None for v in __class__.RE_CLAUDE):
            if thinking_enabled:
                budget_mapping = {
                    ThinkingLevel.LOW: 1024,
                    ThinkingLevel.MEDIUM: 1536,
                    ThinkingLevel.HIGH: 2048,
                }
                result["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": budget_mapping.get(self.thinking_level, 1024),
                }

        return result

    def request_anthropic(self, messages: list[dict[str, str]], args: dict[str, float]) -> tuple[bool, str, str, int, int]:
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
            text_messages = [msg for msg in response.content if hasattr(msg, "text") and isinstance(msg.text, str)]
            think_messages = [msg for msg in response.content if hasattr(msg, "thinking") and isinstance(msg.thinking, str)]

            if text_messages:
                response_result = text_messages[-1].text.strip()
            else:
                response_result = ""

            if think_messages:
                response_think = __class__.RE_LINE_BREAK.sub("\n", think_messages[-1].thinking.strip())
            else:
                response_think = ""
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取 Token 消耗
        try:
            input_tokens = int(response.usage.input_tokens)
        except Exception:
            input_tokens = 0

        try:
            output_tokens = int(response.usage.output_tokens)
        except Exception:
            output_tokens = 0

        return False, response_think, response_result, input_tokens, output_tokens