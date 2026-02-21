from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import patch

from base.Base import Base
from module.Engine.TaskRequesterClientPool import TaskRequesterClientPool


@dataclass
class FakeVersionManager:
    version: str

    def get_version(self) -> str:
        return self.version


@dataclass
class FakeOpenAI:
    base_url: str
    api_key: str
    timeout: Any
    max_retries: int


@dataclass
class FakeAnthropic:
    base_url: str
    api_key: str
    timeout: Any
    max_retries: int


@dataclass
class FakeHttpOptions:
    base_url: str | None = None
    api_version: str | None = None
    timeout: int | None = None
    headers: dict[str, str] | None = None


@dataclass
class FakeGenAIClient:
    api_key: str
    http_options: Any


class FlakyCache(dict):
    def __init__(self, value_on_second_get: Any) -> None:
        super().__init__()
        self.value_on_second_get = value_on_second_get
        self.get_calls = 0

    def get(self, key: Any, default: Any = None) -> Any:
        self.get_calls += 1
        if self.get_calls == 1:
            return None
        return self.value_on_second_get


def setup_function() -> None:
    TaskRequesterClientPool.KEY_INDEX = 0
    TaskRequesterClientPool.CLIENT_CACHE.clear()
    TaskRequesterClientPool.get_url.cache_clear()


def test_reset_clears_url_cache_and_resets_index() -> None:
    TaskRequesterClientPool.KEY_INDEX = 1
    TaskRequesterClientPool.get_url("https://x/chat/completions", Base.APIFormat.OPENAI)
    assert TaskRequesterClientPool.get_url.cache_info().currsize == 1

    TaskRequesterClientPool.reset()

    assert TaskRequesterClientPool.KEY_INDEX == 0
    assert TaskRequesterClientPool.get_url.cache_info().currsize == 0


def test_get_key_empty_returns_placeholder() -> None:
    assert TaskRequesterClientPool.get_key([]) == "no_key_required"


def test_get_key_single_returns_itself() -> None:
    assert TaskRequesterClientPool.get_key(["k1"]) == "k1"


def test_get_key_round_robin() -> None:
    keys = ["k1", "k2"]
    assert TaskRequesterClientPool.get_key(keys) == "k1"
    assert TaskRequesterClientPool.get_key(keys) == "k2"
    assert TaskRequesterClientPool.get_key(keys) == "k1"


def test_get_url_normalization_for_each_format() -> None:
    url = "https://example.invalid/chat/completions/"
    assert (
        TaskRequesterClientPool.get_url(url, Base.APIFormat.SAKURALLM)
        == "https://example.invalid"
    )
    assert (
        TaskRequesterClientPool.get_url(url, Base.APIFormat.OPENAI)
        == "https://example.invalid"
    )
    assert (
        TaskRequesterClientPool.get_url(url, Base.APIFormat.GOOGLE)
        == "https://example.invalid/chat/completions"
    )
    assert (
        TaskRequesterClientPool.get_url(url, Base.APIFormat.ANTHROPIC)
        == "https://example.invalid/chat/completions"
    )


def test_parse_google_api_url_variants() -> None:
    assert TaskRequesterClientPool.parse_google_api_url("") == ("", None)
    assert TaskRequesterClientPool.parse_google_api_url("  ") == ("", None)
    assert TaskRequesterClientPool.parse_google_api_url("https://a/v1beta") == (
        "https://a",
        "v1beta",
    )
    assert TaskRequesterClientPool.parse_google_api_url("https://a/v1") == (
        "https://a",
        "v1",
    )
    assert TaskRequesterClientPool.parse_google_api_url("https://a/") == (
        "https://a",
        None,
    )


def test_get_default_headers_includes_version() -> None:
    with patch(
        "module.Engine.TaskRequesterClientPool.VersionManager.get",
        return_value=FakeVersionManager("9.9.9"),
    ):
        headers = TaskRequesterClientPool.get_default_headers()
    assert "User-Agent" in headers
    assert "LinguaGacha/9.9.9" in headers["User-Agent"]


def test_get_client_returns_cached_instance() -> None:
    client = object()
    key = ("u", "k", Base.APIFormat.OPENAI, 1, ())
    TaskRequesterClientPool.CLIENT_CACHE[key] = client

    assert (
        TaskRequesterClientPool.get_client(
            url="u",
            key="k",
            api_format=Base.APIFormat.OPENAI,
            timeout=1,
        )
        is client
    )


def test_get_client_inside_lock_cache_hit_short_circuits_construction() -> None:
    sentinel = object()
    flaky_cache = FlakyCache(sentinel)

    with patch.object(TaskRequesterClientPool, "CLIENT_CACHE", flaky_cache):
        with patch(
            "module.Engine.TaskRequesterClientPool.openai.OpenAI"
        ) as openai_ctor:
            got = TaskRequesterClientPool.get_client(
                url="u",
                key="k",
                api_format=Base.APIFormat.OPENAI,
                timeout=1,
            )
    assert got is sentinel
    openai_ctor.assert_not_called()


def test_get_client_builds_openai_client_and_caches() -> None:
    constructed: list[FakeOpenAI] = []

    def ctor(**kwargs: Any) -> FakeOpenAI:
        client = FakeOpenAI(**kwargs)
        constructed.append(client)
        return client

    with patch("module.Engine.TaskRequesterClientPool.httpx.Timeout", lambda **kw: kw):
        with patch(
            "module.Engine.TaskRequesterClientPool.openai.OpenAI", side_effect=ctor
        ):
            client1 = TaskRequesterClientPool.get_client(
                url="https://x",
                key="k",
                api_format=Base.APIFormat.OPENAI,
                timeout=3,
            )
            client2 = TaskRequesterClientPool.get_client(
                url="https://x",
                key="k",
                api_format=Base.APIFormat.OPENAI,
                timeout=3,
            )

    assert client1 is client2
    assert len(constructed) == 1
    assert constructed[0].base_url == "https://x"
    assert constructed[0].api_key == "k"
    assert constructed[0].max_retries == 0


def test_get_client_builds_sakura_client() -> None:
    with patch("module.Engine.TaskRequesterClientPool.httpx.Timeout", lambda **kw: kw):
        with patch(
            "module.Engine.TaskRequesterClientPool.openai.OpenAI",
            side_effect=lambda **kw: FakeOpenAI(**kw),
        ):
            client = TaskRequesterClientPool.get_client(
                url="https://x",
                key="k",
                api_format=Base.APIFormat.SAKURALLM,
                timeout=3,
            )

    assert isinstance(client, FakeOpenAI)


def test_get_client_builds_anthropic_client() -> None:
    with patch("module.Engine.TaskRequesterClientPool.httpx.Timeout", lambda **kw: kw):
        with patch(
            "module.Engine.TaskRequesterClientPool.anthropic.Anthropic",
            side_effect=lambda **kw: FakeAnthropic(**kw),
        ):
            client = TaskRequesterClientPool.get_client(
                url="https://x",
                key="k",
                api_format=Base.APIFormat.ANTHROPIC,
                timeout=3,
            )

    assert isinstance(client, FakeAnthropic)


def test_get_client_builds_google_client_with_and_without_base_url() -> None:
    with patch(
        "module.Engine.TaskRequesterClientPool.VersionManager.get",
        return_value=FakeVersionManager("1.0.0"),
    ):
        with patch(
            "module.Engine.TaskRequesterClientPool.types.HttpOptions",
            side_effect=lambda **kw: FakeHttpOptions(**kw),
        ):
            with patch(
                "module.Engine.TaskRequesterClientPool.genai.Client",
                side_effect=lambda **kw: FakeGenAIClient(**kw),
            ):
                client_with = TaskRequesterClientPool.get_client(
                    url="https://g/v1beta",
                    key="k",
                    api_format=Base.APIFormat.GOOGLE,
                    timeout=2,
                    extra_headers_tuple=(("X", "1"),),
                )
                client_without = TaskRequesterClientPool.get_client(
                    url="",
                    key="k",
                    api_format=Base.APIFormat.GOOGLE,
                    timeout=2,
                    extra_headers_tuple=(),
                )

    assert isinstance(client_with, FakeGenAIClient)
    assert isinstance(client_with.http_options, FakeHttpOptions)
    assert client_with.http_options.base_url == "https://g"
    assert client_with.http_options.api_version == "v1beta"
    assert client_with.http_options.timeout == 2000
    assert client_with.http_options.headers is not None
    assert isinstance(client_without, FakeGenAIClient)
    assert isinstance(client_without.http_options, FakeHttpOptions)
    assert client_without.http_options.base_url is None
    assert client_without.http_options.api_version is None
    assert client_without.http_options.timeout == 2000
