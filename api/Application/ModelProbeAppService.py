from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from base.Base import Base
from base.LogManager import LogManager
from api.Models.ModelTest import ModelApiTestResult
from api.Models.ModelTest import ModelKeyTestResult
from module.Config import Config


class ModelProbeConfigLike(Protocol):
    """模型探测只需要读取现有配置，不拥有模型页 CRUD 状态。"""

    def load(self) -> object:
        """声明配置加载入口，保证模型探测只依赖窄协议。"""

        ...

    def initialize_models(self) -> int:
        """声明模型初始化入口，隔离探测服务和具体模型管理器实现。"""

        ...

    def get_model(self, model_id: str) -> dict[str, object] | None:
        """声明模型读取入口，保持模型探测按 id 查询。"""

        ...


class ModelProbeAppService:
    """保留 Python SDK/Engine 相关模型探测能力。"""

    BROWSER_USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    )

    def __init__(
        self,
        config_loader: Callable[[], ModelProbeConfigLike] | None = None,
        available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
        api_test_runner: Callable[[dict[str, object]], object] | None = None,
    ) -> None:
        """初始化 ModelProbeAppService 依赖和状态，保持对象写入口明确。"""

        self.config_loader = (
            config_loader if config_loader is not None else self.default_config_loader
        )
        self.available_models_loader = (
            available_models_loader
            if available_models_loader is not None
            else self.default_available_models_loader
        )
        self.api_test_runner = (
            api_test_runner
            if api_test_runner is not None
            else self.default_api_test_runner
        )

    def list_available_models(self, request: dict[str, object]) -> dict[str, object]:
        """把可选模型列表查询留在 Core 侧，避免页面自行依赖各家 SDK。"""

        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return {"models": self.available_models_loader(model)}

    def test_model(self, request: dict[str, object]) -> dict[str, object]:
        """把模型连通性测试留在 Core 侧，保证页面只消费稳定结果。"""

        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return self.build_api_test_response(self.api_test_runner(model))

    def load_config(self) -> ModelProbeConfigLike:
        """探测前同步默认模型，避免 SDK 入口读到旧内存状态。"""

        config = self.config_loader()
        config.load()
        config.initialize_models()
        return config

    def default_config_loader(self) -> Config:
        """默认从真实配置创建读取对象。"""

        return Config()

    def default_available_models_loader(self, model: dict[str, object]) -> list[str]:
        """真实环境下复用各家 SDK 拉模型列表，页面只拿稳定字符串数组。"""

        try:
            api_key = self.get_primary_api_key(model)
            api_url = str(model.get("api_url", ""))
            api_format = str(model.get("api_format", Base.APIFormat.OPENAI))
            headers = self.build_browser_headers(model)

            if api_format == Base.APIFormat.GOOGLE:
                from google import genai
                from google.genai import types

                normalized_url = api_url.strip().removesuffix("/")
                api_version: str | None = None
                if normalized_url.endswith("/v1beta"):
                    api_version = "v1beta"
                    normalized_url = normalized_url.removesuffix("/v1beta")
                elif normalized_url.endswith("/v1"):
                    api_version = "v1"
                    normalized_url = normalized_url.removesuffix("/v1")

                http_options_args: dict[str, object] = {"headers": headers}
                if normalized_url != "":
                    http_options_args["base_url"] = normalized_url
                if api_version is not None:
                    http_options_args["api_version"] = api_version

                client = genai.Client(
                    api_key=api_key,
                    http_options=types.HttpOptions(**http_options_args),
                )
                return [str(item.name) for item in client.models.list()]

            if api_format == Base.APIFormat.ANTHROPIC:
                import anthropic

                client = anthropic.Anthropic(
                    api_key=api_key,
                    base_url=api_url,
                    default_headers=headers,
                )
                return [str(item.id) for item in client.models.list()]

            import openai

            client = openai.OpenAI(
                base_url=api_url,
                api_key=api_key,
                default_headers=headers,
            )
            return [str(item.id) for item in client.models.list()]
        except Exception as e:
            LogManager.get().warning("获取模型列表失败。", e)
            raise ValueError("获取模型列表失败，请检查接口配置。") from e

    def default_api_test_runner(self, model: dict[str, object]) -> object:
        """真实环境下委托引擎侧 runner 执行模型测试。"""

        from module.Engine.ModelApiTestRunner import ModelApiTestRunner

        return ModelApiTestRunner().run(model)

    def build_api_test_response(self, runner_result: object) -> dict[str, object]:
        """把 runner 结果映射到现有模型测试 API 响应契约。"""

        if isinstance(runner_result, dict):
            return dict(runner_result)

        key_results = tuple(
            ModelKeyTestResult(
                masked_key=str(getattr(key_result, "masked_key")),
                success=bool(getattr(key_result, "success")),
                input_tokens=int(getattr(key_result, "input_tokens")),
                output_tokens=int(getattr(key_result, "output_tokens")),
                response_time_ms=int(getattr(key_result, "response_time_ms")),
                error_reason=str(getattr(key_result, "error_reason")),
            )
            for key_result in getattr(runner_result, "key_results")
        )
        api_test_result = ModelApiTestResult(
            success=bool(getattr(runner_result, "success")),
            result_msg=str(getattr(runner_result, "result_msg")),
            total_count=int(getattr(runner_result, "total_count")),
            success_count=int(getattr(runner_result, "success_count")),
            failure_count=int(getattr(runner_result, "failure_count")),
            total_response_time_ms=int(
                getattr(runner_result, "total_response_time_ms")
            ),
            key_results=key_results,
        )
        return api_test_result.to_dict()

    def get_model_or_raise(
        self,
        config: ModelProbeConfigLike,
        model_id: str,
    ) -> dict[str, object]:
        """统一处理模型不存在的错误，避免各动作散落空值判断。"""

        model = config.get_model(model_id)
        if isinstance(model, dict):
            return dict(model)
        raise ValueError("model not found")

    def collect_api_keys(self, model: dict[str, object]) -> list[str]:
        """统一按换行切分 API Key，保证测试与列表查询读同一份配置。"""

        api_keys_raw = str(model.get("api_key", ""))
        api_keys = [key.strip() for key in api_keys_raw.splitlines() if key.strip()]
        if api_keys:
            return api_keys
        return ["no_key_required"]

    def get_primary_api_key(self, model: dict[str, object]) -> str:
        """列表查询只取首个 key，保持与旧模型选择器一致。"""

        return self.collect_api_keys(model)[0]

    def build_browser_headers(self, model: dict[str, object]) -> dict[str, str]:
        """模型列表查询统一伪装浏览器 UA，降低部分网关对 SDK UA 的拦截。"""

        headers = {"User-Agent": self.BROWSER_USER_AGENT}
        request_config = model.get("request", {})
        if isinstance(request_config, dict) and bool(
            request_config.get("extra_headers_custom_enable", False)
        ):
            extra_headers = request_config.get("extra_headers", {})
            if isinstance(extra_headers, dict):
                for key, value in extra_headers.items():
                    headers[str(key)] = str(value)
        return headers
