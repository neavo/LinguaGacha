import threading

import rapidjson as json
import anthropic
import google.generativeai as genai
from openai import OpenAI

from base.Base import Base
from module.Localizer.Localizer import Localizer

# 接口请求器
class TranslatorRequester(Base):

    # 类线程锁
    API_KEY_LOCK = threading.Lock()

    def __init__(self, config: dict, platform: dict, current_round: int) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.platform = platform
        self.current_round = current_round

    # 发起请求
    def request(self, messages: list[dict]) -> tuple[bool, str, int, int]:
        temperature = self.platform.get("temperature")
        top_p = self.platform.get("top_p")
        presence_penalty = self.platform.get("presence_penalty")
        frequency_penalty = self.platform.get("frequency_penalty") if self.current_round == 0 else max(0.20, self.platform.get("frequency_penalty"))

        # 发起请求
        if self.platform.get("api_format") == Base.APIFormat.SAKURALLM:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_sakura(
                messages,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        elif self.platform.get("api_format") == Base.APIFormat.GOOGLE:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_google(
                messages,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        elif self.platform.get("api_format") == Base.APIFormat.ANTHROPIC:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_anthropic(
                messages,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )
        else:
            skip, response_think, response_result, prompt_tokens, completion_tokens = self.request_openai(
                messages,
                temperature,
                top_p,
                presence_penalty,
                frequency_penalty
            )

        return skip, response_think, response_result, prompt_tokens, completion_tokens

    # 轮询获取key列表里的key
    def get_apikey(self) -> str:
        # 如果密钥列表长度为 1，则直接返回固定密钥
        # 如果密钥索引已达到最大长度，则重置索引，否则切换到下一个密钥
        with TranslatorRequester.API_KEY_LOCK:
            # 初始化索引
            if getattr(TranslatorRequester, "api_key_index", None) is None:
                TranslatorRequester.api_key_index = 0

            api_key = self.platform.get("api_key", [])
            if len(api_key) == 1:
                return api_key[0]
            elif TranslatorRequester.api_key_index >= len(api_key) - 1:
                TranslatorRequester.api_key_index = 0
                return api_key[0]
            else:
                TranslatorRequester.api_key_index = TranslatorRequester.api_key_index + 1
                return api_key[TranslatorRequester.api_key_index]

    # 发起请求
    def request_sakura(self, messages: list[dict], temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            client = OpenAI(
                base_url = self.platform.get("api_url"),
                api_key = self.get_apikey(),
            )

            response = client.chat.completions.create(
                model = self.platform.get("model"),
                messages = messages,
                top_p = top_p,
                temperature = temperature,
                presence_penalty = pp,
                frequency_penalty = fp,
                timeout = self.config.get("request_timeout"),
                max_tokens = max(512, self.config.get("task_token_limit")),
                extra_query = {
                    "do_sample": True,
                    "num_beams": 1,
                    "repetition_penalty": 1.0
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

    # 发起请求
    def request_openai(self, messages: list[dict], temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            client = OpenAI(
                base_url = self.platform.get("api_url"),
                api_key = self.get_apikey(),
            )

            response = client.chat.completions.create(
                model = self.platform.get("model"),
                messages = messages,
                temperature = temperature,
                top_p = top_p,
                presence_penalty = pp,
                frequency_penalty = fp,
                timeout = self.config.get("request_timeout"),
                max_tokens = 4096,
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

    # 发起请求
    def request_google(self, messages: list[dict], temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, int, int]:
        try:
            # Gemini SDK 文档 - https://ai.google.dev/api?hl=zh-cn&lang=python
            genai.configure(
                api_key = self.get_apikey(),
                transport = "rest",
            )
            model = genai.GenerativeModel(
                model_name = self.platform.get("model"),
                # safety_settings = [
                #     {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                #     {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                #     {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                #     {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                # ],
            )

            # 提取回复的文本内容
            response = model.generate_content(
                messages,
                safety_settings = [
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                ],
                generation_config = genai.types.GenerationConfig(
                    temperature = temperature,
                    top_p = top_p,
                    presence_penalty = pp,
                    frequency_penalty = fp,
                    max_output_tokens = 4096,
                ),
            )
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
    def request_anthropic(self, messages: list[dict], temperature: float, top_p: float, pp: float, fp: float) -> tuple[bool, str, str, int, int]:
        try:
            client = anthropic.Anthropic(
                base_url = self.platform.get("api_url"),
                api_key = self.get_apikey(),
            )

            response = client.messages.create(
                model = self.platform.get("model"),
                messages = messages,
                temperature = temperature,
                top_p = top_p,
                timeout = self.config.get("request_timeout"),
                max_tokens = 4096,
            )

            # 提取回复的文本内容
            response_result = response.content[0].text
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

        return False, "", response_result, prompt_tokens, completion_tokens