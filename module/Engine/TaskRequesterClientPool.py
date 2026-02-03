import threading
from functools import lru_cache
from typing import Any

import anthropic
import httpx
import openai
from google import genai
from google.genai import types

from base.Base import Base
from base.VersionManager import VersionManager


class TaskRequesterClientPool:
    """SDK client 池：负责 URL 规范化、API Key 轮询与 client 缓存。"""

    # 密钥索引
    KEY_INDEX: int = 0

    # 线程锁
    LOCK: threading.Lock = threading.Lock()

    # 客户端缓存键
    ClientCacheKey = tuple[str, str, str, int, tuple]
    CLIENT_CACHE: dict[ClientCacheKey, Any] = {}

    @classmethod
    def reset(cls) -> None:
        """重置密钥轮询与 URL 规范化缓存。

        注意：这里不清空 CLIENT_CACHE。
        - 翻译开始时会频繁调用 reset()；清空缓存会导致 client 反复新建，增加资源占用。
        - client cache key 已包含 url/key/api_format/timeout/headers，配置变化会自然命中新的 key。
        """

        with cls.LOCK:
            cls.KEY_INDEX = 0
            cls.get_url.cache_clear()

    @classmethod
    def get_key(cls, keys: list[str]) -> str:
        if len(keys) == 0:
            return "no_key_required"
        if len(keys) == 1:
            return keys[0]
        with cls.LOCK:
            key = keys[cls.KEY_INDEX % len(keys)]
            cls.KEY_INDEX = (cls.KEY_INDEX + 1) % len(keys)
            return key

    @classmethod
    @lru_cache(maxsize=None)
    def get_url(cls, url: str, api_format: str) -> str:
        if api_format == Base.APIFormat.SAKURALLM:
            return url.removesuffix("/").removesuffix("/chat/completions")
        if api_format == Base.APIFormat.GOOGLE:
            return url.removesuffix("/")
        if api_format == Base.APIFormat.ANTHROPIC:
            return url.removesuffix("/")
        return url.removesuffix("/").removesuffix("/chat/completions")

    @classmethod
    def parse_google_api_url(cls, url: str) -> tuple[str, str | None]:
        normalized_url: str = url.strip().removesuffix("/")
        if not normalized_url:
            return "", None
        if normalized_url.endswith("/v1beta"):
            return normalized_url.removesuffix("/v1beta"), "v1beta"
        if normalized_url.endswith("/v1"):
            return normalized_url.removesuffix("/v1"), "v1"
        return normalized_url, None

    @staticmethod
    def get_default_headers() -> dict:
        return {
            "User-Agent": f"LinguaGacha/{VersionManager.get().get_version()} (https://github.com/neavo/LinguaGacha)"
        }

    @classmethod
    def get_client(
        cls,
        url: str,
        key: str,
        api_format: str,
        timeout: int,
        extra_headers_tuple: tuple = (),
    ) -> openai.OpenAI | genai.Client | anthropic.Anthropic:
        cache_key = (
            url,
            key,
            api_format,
            int(timeout),
            extra_headers_tuple,
        )

        cached = cls.CLIENT_CACHE.get(cache_key)
        if cached is not None:
            return cached

        with cls.LOCK:
            cached = cls.CLIENT_CACHE.get(cache_key)
            if cached is not None:
                return cached

            if api_format == Base.APIFormat.SAKURALLM:
                client = openai.OpenAI(
                    base_url=url,
                    api_key=key,
                    timeout=httpx.Timeout(
                        read=timeout,
                        pool=8.00,
                        write=8.00,
                        connect=8.00,
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
                client = anthropic.Anthropic(
                    base_url=url,
                    api_key=key,
                    timeout=httpx.Timeout(
                        read=timeout,
                        pool=8.00,
                        write=8.00,
                        connect=8.00,
                    ),
                    max_retries=0,
                )
            else:
                client = openai.OpenAI(
                    base_url=url,
                    api_key=key,
                    timeout=httpx.Timeout(
                        read=timeout,
                        pool=8.00,
                        write=8.00,
                        connect=8.00,
                    ),
                    max_retries=0,
                )

            cls.CLIENT_CACHE[cache_key] = client
            return client
