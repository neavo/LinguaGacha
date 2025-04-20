import re
import threading

import httpx
import rapidjson as json
import openai
import anthropic
from google import genai
from google.genai import types

from base.Base import Base
from module.Localizer.Localizer import Localizer
from module.VersionManager import VersionManager

# 接口请求器
class TranslatorRequester(Base):

    # 类线程锁
    API_KEY_LOCK = threading.Lock()

    # 客户端
    GOOGLE_CLIENTS: dict[str, genai.Client] = {}
    SAKURA_CLIENTS: dict[str, openai.OpenAI] = {}
    OPENAI_CLIENTS: dict[str, openai.OpenAI] = {}
    ANTHROPIC_CLIENTS: dict[str, anthropic.Anthropic] = {}

    # OPENAI 思考模型 o1 o3-mini o4-mini-20240406
    REGEX_O_Series_MODEL: re.Pattern = re.compile(r"o\d$|o\d\-", flags = re.IGNORECASE)

    def __init__(self, config: dict, platform: dict, current_round: int) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.platform = platform
        self.current_round = current_round

    # 重置
    @classmethod
    def reset(cls) -> None:
        cls.GOOGLE_CLIENTS: dict[str, genai.Client] = {}
        cls.SAKURA_CLIENTS: dict[str, openai.OpenAI] = {}
        cls.OPENAI_CLIENTS: dict[str, openai.OpenAI] = {}
        cls.ANTHROPIC_CLIENTS: dict[str, anthropic.Anthropic] = {}

    # 发起请求
    def request(self, messages: list[dict]) -> tuple[bool, str, int, int]:
        thinking = self.platform.get("thinking")
        temperature = self.platform.get("temperature")
        top_p = self.platform.get("top_p")
        presence_penalty = self.platform.get("presence_penalty")
        frequency_penalty = self.platform.get("frequency_penalty") if self.current_round == 0 else max(0.20, self.platform.get("frequency_penalty"))

        # 发起请求
        if self.platform.get("api_format") == Base.APIFormat.SAKURALLM:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_sakura(
                messages,
                thinking,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        elif self.platform.get("api_format") == Base.APIFormat.GOOGLE:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_google(
                messages,
                thinking,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        elif self.platform.get("api_format") == Base.APIFormat.ANTHROPIC:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_anthropic(
                messages,
                thinking,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        else:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_openai(
                messages,
                thinking,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )

        return skip, response_think, response_result, prompt_tokens, completion_tokens

    # 获取客户端
    def get_client(self, platform: dict, timeout: int) -> openai.OpenAI | genai.Client | anthropic.Anthropic:
        with TranslatorRequester.API_KEY_LOCK:
            # 初始化索引
            if getattr(TranslatorRequester, "_api_key_index", None) is None:
                TranslatorRequester._api_key_index = 0

            # 轮询获取密钥
            keys = platform.get("api_key", [])
            if len(keys) == 1:
                api_key = keys[0]
            elif TranslatorRequester._api_key_index >= len(keys) - 1:
                TranslatorRequester._api_key_index = 0
                api_key = keys[0]
            else:
                TranslatorRequester._api_key_index = TranslatorRequester._api_key_index + 1
                api_key = keys[TranslatorRequester._api_key_index]

            # 从缓存中获取客户端
            if platform.get("api_format") == Base.APIFormat.SAKURALLM:
                if api_key not in TranslatorRequester.SAKURA_CLIENTS:
                    TranslatorRequester.SAKURA_CLIENTS[api_key] = openai.OpenAI(
                        base_url = platform.get("api_url"),
                        api_key = api_key,
                        timeout = httpx.Timeout(timeout = timeout, connect = 10.0),
                        max_retries = 1,
                    )
                return TranslatorRequester.SAKURA_CLIENTS.get(api_key)
            elif platform.get("api_format") == Base.APIFormat.GOOGLE:
                # https://github.com/googleapis/python-genai
                # https://ai.google.dev/gemini-api/docs/libraries
                if api_key not in TranslatorRequester.GOOGLE_CLIENTS:
                    TranslatorRequester.GOOGLE_CLIENTS[api_key] = genai.Client(
                        api_key = api_key,
                        http_options = types.HttpOptions(
                            timeout = timeout * 1000,
                            api_version = "v1alpha",
                        ),
                    )
                return TranslatorRequester.GOOGLE_CLIENTS.get(api_key)
            elif platform.get("api_format") == Base.APIFormat.ANTHROPIC:
                if api_key not in TranslatorRequester.ANTHROPIC_CLIENTS:
                    TranslatorRequester.ANTHROPIC_CLIENTS[api_key] = anthropic.Anthropic(
                        base_url = platform.get("api_url"),
                        api_key = api_key,
                        timeout = httpx.Timeout(timeout = timeout, connect = 10.0),
                        max_retries = 1,
                    )
                return TranslatorRequester.ANTHROPIC_CLIENTS.get(api_key)
            else:
                if api_key not in TranslatorRequester.OPENAI_CLIENTS:
                    TranslatorRequester.OPENAI_CLIENTS[api_key] = openai.OpenAI(
                        base_url = platform.get("api_url"),
                        api_key = api_key,
                        timeout = httpx.Timeout(timeout = timeout, connect = 10.0),
                        max_retries = 1,
                    )
                return TranslatorRequester.OPENAI_CLIENTS.get(api_key)

    # 发起请求
    def request_sakura(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            client: openai.OpenAI = self.get_client(
                self.platform,
                self.config.get("request_timeout"),
            )
            response = client.chat.completions.create(
                model = self.platform.get("model"),
                messages = messages,
                top_p = top_p,
                temperature = temperature,
                presence_penalty = pp,
                frequency_penalty = fp,
                max_tokens = max(512, self.config.get("task_token_limit")),
                extra_headers = {
                    "User-Agent": f"LinguaGacha/{VersionManager.VERSION} (https://github.com/neavo/LinguaGacha)"
                },
            )

            # 提取回复的文本内容
            response_result = response.choices[0].message.content
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取输入消耗
        try:
            prompt_tokens = int(response.usage.prompt_tokens)
        except Exception:
            prompt_tokens = 0

        # 获取回复消耗
        try:
            completion_tokens = int(response.usage.completion_tokens)
        except Exception:
            completion_tokens = 0

        # Sakura 返回的内容多行文本，将其转换为 JSON 字符串
        response_result = json.dumps(
            {str(i): line.strip() for i, line in enumerate(response_result.strip().splitlines())},
            indent = None,
            ensure_ascii = False,
        )

        return False, "", response_result, prompt_tokens, completion_tokens

    # 生成请求参数
    def generate_openai_args(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> dict:
        args: dict = {
            "model": self.platform.get("model"),
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "presence_penalty": pp,
            "frequency_penalty": fp,
            "max_tokens": max(4 * 1024, self.config.get("task_token_limit")),
            "extra_headers": {
                "User-Agent": f"LinguaGacha/{VersionManager.VERSION} (https://github.com/neavo/LinguaGacha)"
            }
        }

        # 根据是否为 OpenAI O-Series 模型对请求参数进行处理
        if __class__.REGEX_O_Series_MODEL.search(self.platform.get("model")) is not None:
            args.pop("top_p")
            args.pop("presence_penalty")
            args.pop("frequency_penalty")
            args.pop("temperature")

            args.pop("max_tokens")
            args["max_completion_tokens"] = max(4 * 1024, self.config.get("task_token_limit"))

        return args

    # 发起请求
    def request_openai(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            # 获取客户端
            client: openai.OpenAI = self.get_client(
                self.platform,
                self.config.get("request_timeout"),
            )

            # 发起请求
            response: openai.types.completion.Completion = client.chat.completions.create(
                **self.generate_openai_args(messages, thinking, temperature, top_p, pp, fp)
            )

            # 提取回复内容
            message = response.choices[0].message
            if hasattr(message, "reasoning_content") and isinstance(message.reasoning_content, str):
                response_think = message.reasoning_content.replace("\n\n", "\n").strip()
                response_result = message.content.strip()
            elif "</think>" in message.content:
                splited = message.content.split("</think>")
                response_think = splited[0].removeprefix("<think>").replace("\n\n", "\n").strip()
                response_result = splited[-1].strip()
            else:
                response_think = ""
                response_result = message.content.strip()
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取输入消耗
        try:
            prompt_tokens = int(response.usage.prompt_tokens)
        except Exception:
            prompt_tokens = 0

        # 获取回复消耗
        try:
            completion_tokens = int(response.usage.completion_tokens)
        except Exception:
            completion_tokens = 0

        return False, response_think, response_result, prompt_tokens, completion_tokens

    # 生成请求参数
    def generate_google_args(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> dict[str, str | int | float]:
        args: dict = {
            "temperature": temperature,
            "top_p": top_p,
            "presence_penalty": pp,
            "frequency_penalty": fp,
            "max_output_tokens": max(4 * 1024, self.config.get("task_token_limit")),
            "safety_settings": (
                types.SafetySetting(
                    category = "HARM_CATEGORY_HARASSMENT",
                    threshold = "BLOCK_NONE",
                ),
                types.SafetySetting(
                    category = "HARM_CATEGORY_HATE_SPEECH",
                    threshold = "BLOCK_NONE",
                ),
                types.SafetySetting(
                    category = "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold = "BLOCK_NONE",
                ),
                types.SafetySetting(
                    category = "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold = "BLOCK_NONE",
                ),
            ),
        }

        # 是否使用思考模型对请求参数进行处理
        if any(v in self.platform.get("model") for v in ("2.5", "thinking")):
            args.pop("presence_penalty")
            args.pop("frequency_penalty")
            args["thinking_config"] = types.ThinkingConfig(
                thinking_budget = 1024 if thinking == True else 0,
                include_thoughts = thinking == True,
            )

        return {
            "model": self.platform.get("model"),
            "contents": [v.get("content") for v in messages if v.get("role") == "user"],
            "config": types.GenerateContentConfig(**args),
        }

    # 发起请求
    def request_google(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, int, int]:
        try:
            # 获取客户端
            client: genai.Client = self.get_client(
                self.platform,
                self.config.get("request_timeout"),
            )

            # 发起请求
            response: types.GenerateContentResponse = client.models.generate_content(
                **self.generate_google_args(messages, thinking, temperature, top_p, pp, fp)
            )

            # 提取回复内容
            response_result = response.text
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取指令消耗
        try:
            prompt_tokens = int(response.usage_metadata.prompt_token_count)
        except Exception:
            prompt_tokens = 0

        # 获取回复消耗
        try:
            completion_tokens = int(response.usage_metadata.candidates_token_count)
        except Exception:
            completion_tokens = 0

        return False, "", response_result, prompt_tokens, completion_tokens

    # 发起请求
    def request_anthropic(self, messages: list[dict], thinking: bool, temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            client: anthropic.Anthropic = self.get_client(
                self.platform,
                self.config.get("request_timeout"),
            )
            # 根据是否为思考模式，选择不同的请求方式
            if thinking == True:
                response = client.messages.create(
                    model = self.platform.get("model"),
                    messages = messages,
                    thinking = {
                        "type": "enabled",
                        "budget_tokens": 1024
                    },
                    max_tokens = max(4 * 1024, self.config.get("task_token_limit")),
                    extra_headers = {
                        "User-Agent": f"LinguaGacha/{VersionManager.VERSION} (https://github.com/neavo/LinguaGacha)"
                    },
                )
            else:
                response = client.messages.create(
                    model = self.platform.get("model"),
                    messages = messages,
                    temperature = temperature,
                    top_p = top_p,
                    max_tokens = max(4 * 1024, self.config.get("task_token_limit")),
                    extra_headers = {
                        "User-Agent": f"LinguaGacha/{VersionManager.VERSION} (https://github.com/neavo/LinguaGacha)"
                    },
                )

            # 提取回复内容
            text_messages = [msg for msg in response.content if hasattr(msg, "text") and isinstance(msg.text, str)]
            think_messages = [msg for msg in response.content if hasattr(msg, "thinking") and isinstance(msg.thinking, str)]

            if text_messages != []:
                response_result = text_messages[-1].text.strip()
            else:
                response_result = ""

            if think_messages != []:
                response_think = think_messages[-1].thinking.replace("\n\n", "\n").strip()
            else:
                response_think = ""
        except Exception as e:
            self.error(f"{Localizer.get().log_task_fail}", e)
            return True, None, None, None, None

        # 获取输入消耗
        try:
            prompt_tokens = int(response.usage.input_tokens)
        except Exception:
            prompt_tokens = 0

        # 获取回复消耗
        try:
            completion_tokens = int(response.usage.output_tokens)
        except Exception:
            completion_tokens = 0

        return False, response_think, response_result, prompt_tokens, completion_tokens