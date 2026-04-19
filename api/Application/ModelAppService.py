from __future__ import annotations

import copy
import time
from collections.abc import Callable
from typing import Protocol

from api.Contract.ModelPayloads import ModelPageSnapshotPayload
from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from api.Models.Model import ModelEntrySnapshot
from api.Models.Model import ModelPageSnapshot
from module.Model.Types import ModelType
from module.Config import Config
from module.Model.Manager import ModelManager


class ModelConfigLike(Protocol):
    """约束模型应用服务依赖的最小配置接口，避免类型退化成 Any。"""

    app_language: BaseLanguage.Enum
    activate_model_id: str
    models: list[dict[str, object]] | None

    def load(self) -> object: ...

    def save(self) -> object: ...

    def initialize_models(self) -> int: ...

    def get_model(self, model_id: str) -> dict[str, object] | None: ...

    def set_model(self, model_data: dict[str, object]) -> None: ...

    def set_active_model_id(self, model_id: str) -> None: ...


class ModelManagerLike(Protocol):
    """约束模型应用服务依赖的最小模型管理接口，保证真实对象与测试桩同构。"""

    activate_model_id: str

    def set_app_language(self, language: BaseLanguage.Enum) -> None: ...

    def set_models(self, models_data: list[dict[str, object]]) -> None: ...

    def set_active_model_id(self, model_id: str) -> None: ...

    def get_models_as_dict(self) -> list[dict[str, object]]: ...

    def add_model(self, model_type: ModelType) -> object: ...

    def delete_model(self, model_id: str) -> bool: ...

    def reset_preset_model(self, model_id: str) -> bool: ...

    def reorder_models(self, ordered_ids: list[str]) -> None: ...


class ModelAppService:
    """把模型管理动作收口到应用服务，避免 UI 继续直连配置与模型管理器。"""

    BROWSER_USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    )

    PATCH_ALLOWED_KEYS: tuple[str, ...] = (
        "name",
        "api_url",
        "api_key",
        "model_id",
        "thinking",
        "threshold",
        "generation",
        "request",
    )
    PATCH_OBJECT_KEYS: tuple[str, ...] = (
        "thinking",
        "threshold",
        "generation",
        "request",
    )

    def __init__(
        self,
        config_loader: Callable[[], ModelConfigLike] | None = None,
        model_manager: ModelManagerLike | None = None,
        available_models_loader: Callable[[dict[str, object]], list[str]] | None = None,
        api_test_runner: Callable[[dict[str, object]], dict[str, object]] | None = None,
    ) -> None:
        self.config_loader = (
            config_loader if config_loader is not None else self.default_config_loader
        )
        self.model_manager = (
            model_manager if model_manager is not None else ModelManager.get()
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

    def get_snapshot(
        self,
        request: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """提供模型页首屏快照，并在 Core 侧统一补齐默认模型。"""

        del request
        config = self.load_config(persist_defaults=True)
        return self.build_snapshot_response(config)

    def update_model(self, request: dict[str, object]) -> dict[str, object]:
        """按白名单 patch 更新模型，并返回最新快照。"""

        model_id = str(request.get("model_id", ""))
        patch = request.get("patch", {})
        validated_patch = self.validate_patch(patch)

        config = self.load_config()
        model = self.get_model_or_raise(config, model_id)
        merged_model = self.apply_patch(model, validated_patch)
        config.set_model(merged_model)
        return self.persist_config_and_build_snapshot(config)

    def activate_model(self, request: dict[str, object]) -> dict[str, object]:
        """把激活模型的唯一写入口留在 Core 侧，避免页面双写状态。"""

        model_id = str(request.get("model_id", ""))
        config = self.load_config()
        self.get_model_or_raise(config, model_id)
        config.set_active_model_id(model_id)
        return self.persist_config_and_build_snapshot(config)

    def add_model(self, request: dict[str, object]) -> dict[str, object]:
        """统一由 Core 创建自定义模型，避免页面继续依赖模板细节。"""

        model_type_value = str(request.get("model_type", ""))
        try:
            model_type = ModelType(model_type_value)
        except ValueError as e:
            raise ValueError(f"unknown model type: {model_type_value}") from e

        config = self.load_config()
        self.prepare_manager(config)
        self.model_manager.add_model(model_type)
        self.sync_config_from_manager(config)
        return self.persist_config_and_build_snapshot(config)

    def delete_model(self, request: dict[str, object]) -> dict[str, object]:
        """统一由 Core 删除模型，保证激活模型回退策略只有一份。"""

        model_id = str(request.get("model_id", ""))
        config = self.load_config()
        target_model = self.get_model_or_raise(config, model_id)
        self.prepare_manager(config)
        deleted = bool(self.model_manager.delete_model(model_id))

        if deleted:
            self.sync_config_from_manager(config)
            return self.persist_config_and_build_snapshot(config)

        if str(target_model.get("type", "")) == ModelType.PRESET.value:
            raise ValueError("preset model cannot be deleted")
        raise ValueError("model delete failed")

    def reset_preset_model(self, request: dict[str, object]) -> dict[str, object]:
        """统一由 Core 重置预设模型，避免页面自己决定回退模板。"""

        model_id = str(request.get("model_id", ""))
        config = self.load_config()
        target_model = self.get_model_or_raise(config, model_id)
        if str(target_model.get("type", "")) != ModelType.PRESET.value:
            raise ValueError("model is not preset")

        self.prepare_manager(config)
        reset_result = bool(self.model_manager.reset_preset_model(model_id))
        if not reset_result:
            raise ValueError("preset model not found")

        self.sync_config_from_manager(config)
        return self.persist_config_and_build_snapshot(config)

    def reorder_model(self, request: dict[str, object]) -> dict[str, object]:
        """把排序规则留在 Core 侧，避免页面自己拼全局顺序。"""

        ordered_model_ids_raw = request.get("ordered_model_ids")
        if isinstance(ordered_model_ids_raw, list):
            ordered_model_ids = [
                str(model_id).strip()
                for model_id in ordered_model_ids_raw
                if str(model_id).strip() != ""
            ]
            if not ordered_model_ids:
                raise ValueError("ordered_model_ids is empty")

            config = self.load_config()
            target_model = self.get_model_or_raise(config, ordered_model_ids[0])
            target_type = str(target_model.get("type", ModelType.PRESET.value))
            expected_group_ids = self.collect_group_model_ids(
                config.models or [],
                target_type,
            )
            if len(ordered_model_ids) != len(expected_group_ids) or set(
                ordered_model_ids
            ) != set(expected_group_ids):
                raise ValueError("ordered_model_ids must match one model group exactly")

            global_order_ids = ModelManager.build_global_ordered_ids_for_group(
                config.models or [],
                target_type,
                ordered_model_ids,
            )
            self.prepare_manager(config)
            self.model_manager.reorder_models(global_order_ids)
            self.sync_config_from_manager(config)
            return self.persist_config_and_build_snapshot(config)

        return self.reorder_model_by_operation(request)

    def reorder_model_by_operation(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        """旧前端仍使用操作枚举重排，因此兼容逻辑单独收口。"""

        model_id = str(request.get("model_id", ""))
        operation_value = str(request.get("operation", ""))
        config = self.load_config()
        target_model = self.get_model_or_raise(config, model_id)

        try:
            operation = ModelManager.ReorderOperation(operation_value)
        except ValueError as e:
            raise ValueError(f"unknown reorder operation: {operation_value}") from e

        model_type = str(target_model.get("type", ModelType.PRESET.value))
        group_model_ids = self.collect_group_model_ids(config.models or [], model_type)
        reordered_group_ids = ModelManager.build_group_reordered_ids(
            group_model_ids,
            model_id,
            operation,
        )

        if reordered_group_ids == group_model_ids:
            return self.build_snapshot_response(config)

        ordered_ids = ModelManager.build_global_ordered_ids_for_group(
            config.models or [],
            model_type,
            reordered_group_ids,
        )
        self.prepare_manager(config)
        self.model_manager.reorder_models(ordered_ids)
        self.sync_config_from_manager(config)
        return self.persist_config_and_build_snapshot(config)

    def list_available_models(self, request: dict[str, object]) -> dict[str, object]:
        """把可选模型列表查询留在 Core 侧，避免页面自行依赖各家 SDK。"""

        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return {"models": self.available_models_loader(model)}

    def test_model(self, request: dict[str, object]) -> dict[str, object]:
        """把模型连通性测试留在 Core 侧，保证页面只消费稳定结果。"""

        config = self.load_config()
        model = self.get_model_or_raise(config, str(request.get("model_id", "")))
        return dict(self.api_test_runner(model))

    def build_snapshot(self, config: ModelConfigLike) -> ModelPageSnapshot:
        """把配置对象裁剪成模型页真正依赖的冻结快照。"""

        models = tuple(
            ModelEntrySnapshot.from_dict(model_data)
            for model_data in (config.models or [])
        )
        active_model_id = str(config.activate_model_id)
        if active_model_id == "" and models:
            active_model_id = models[0].id

        return ModelPageSnapshot(
            active_model_id=active_model_id,
            models=models,
        )

    def build_snapshot_response(self, config: ModelConfigLike) -> dict[str, object]:
        """统一收口 snapshot 响应结构，避免各动作重复拼字典。"""

        snapshot = self.build_snapshot(config)
        return {"snapshot": ModelPageSnapshotPayload.from_snapshot(snapshot).to_dict()}

    def load_config(self, persist_defaults: bool = False) -> ModelConfigLike:
        """统一加载配置并初始化模型，避免各入口分散补默认值。"""

        config = self.config_loader()
        config.load()
        config.initialize_models()
        if persist_defaults:
            config.save()
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

    def default_api_test_runner(self, model: dict[str, object]) -> dict[str, object]:
        """真实环境下复用请求器执行模型测试，并返回稳定的聚合结果。"""

        from module.Engine.APITest.APITestResult import APITestResult
        from module.Engine.APITest.APITestResult import KeyTestResult
        from module.Engine.TaskRequester import TaskRequester
        from module.Localizer.Localizer import Localizer

        config = Config().load()
        messages = self.build_api_test_messages(str(model.get("api_format", "")))
        api_keys = self.collect_api_keys(model)
        key_results: list[KeyTestResult] = []

        TaskRequester.reset()
        for api_key in api_keys:
            model_for_test = copy.deepcopy(model)
            model_for_test["api_key"] = api_key
            requester = TaskRequester(config, model_for_test)
            start_time_ns = time.perf_counter_ns()
            (
                exception,
                _response_think,
                _response_result,
                input_tokens,
                output_tokens,
            ) = requester.request(messages)
            response_time_ms = (time.perf_counter_ns() - start_time_ns) // 1_000_000

            if exception is None:
                key_results.append(
                    KeyTestResult(
                        masked_key=self.mask_api_key(api_key),
                        success=True,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        response_time_ms=response_time_ms,
                        error_reason="",
                    )
                )
            else:
                reason = self.build_api_test_error_reason(
                    exception,
                    int(config.request_timeout),
                    Localizer.get().api_test_timeout,
                )
                key_results.append(
                    KeyTestResult(
                        masked_key=self.mask_api_key(api_key),
                        success=False,
                        input_tokens=0,
                        output_tokens=0,
                        response_time_ms=response_time_ms,
                        error_reason=reason,
                    )
                )
                LogManager.get().warning(
                    Localizer.get().log_api_test_fail.replace("{REASON}", reason),
                    exception,
                )

        success_results = [result for result in key_results if result.success]
        failure_results = [result for result in key_results if not result.success]
        result_msg = (
            Localizer.get()
            .api_test_result.replace("{COUNT}", str(len(api_keys)))
            .replace("{SUCCESS}", str(len(success_results)))
            .replace("{FAILURE}", str(len(failure_results)))
        )
        api_test_result = APITestResult(
            success=len(failure_results) == 0,
            result_msg=result_msg,
            total_count=len(api_keys),
            success_count=len(success_results),
            failure_count=len(failure_results),
            total_response_time_ms=sum(
                result.response_time_ms for result in key_results
            ),
            key_results=tuple(key_results),
        )
        event_payload = api_test_result.to_event_dict()
        return {
            "success": bool(event_payload.get("result", False)),
            "result_msg": str(event_payload.get("result_msg", "")),
            "total_count": int(event_payload.get("total_count", 0)),
            "success_count": int(event_payload.get("success_count", 0)),
            "failure_count": int(event_payload.get("failure_count", 0)),
            "total_response_time_ms": int(
                event_payload.get("total_response_time_ms", 0)
            ),
            "key_results": list(event_payload.get("key_results", [])),
        }

    def persist_config_and_build_snapshot(
        self,
        config: ModelConfigLike,
    ) -> dict[str, object]:
        """统一保存配置并返回最新快照，避免动作分支重复收尾。"""

        config.save()
        return self.build_snapshot_response(config)

    def prepare_manager(self, config: ModelConfigLike) -> None:
        """在执行动作前先让模型管理器与配置真相对齐。"""

        self.model_manager.set_app_language(config.app_language)
        self.model_manager.set_models(config.models or [])
        self.model_manager.set_active_model_id(config.activate_model_id)

    def sync_config_from_manager(self, config: ModelConfigLike) -> None:
        """把模型管理器结果回写到配置，保持单一持久化入口。"""

        config.models = self.model_manager.get_models_as_dict()
        config.activate_model_id = str(self.model_manager.activate_model_id)

    def get_model_or_raise(
        self,
        config: ModelConfigLike,
        model_id: str,
    ) -> dict[str, object]:
        """统一处理模型不存在的错误，避免各动作散落空值判断。"""

        model = config.get_model(model_id)
        if isinstance(model, dict):
            return dict(model)
        raise ValueError("model not found")

    def validate_patch(self, patch: object) -> dict[str, object]:
        """在进入数据层前先锁住 patch 白名单，避免越权字段落盘。"""

        if not isinstance(patch, dict):
            raise ValueError("model patch must be a dict")

        for key in patch:
            if key not in self.PATCH_ALLOWED_KEYS:
                raise ValueError(f"forbidden model patch key: {key}")

        return dict(patch)

    def apply_patch(
        self,
        model: dict[str, object],
        patch: dict[str, object],
    ) -> dict[str, object]:
        """对模型配置执行局部 merge，保证未更新字段继续保持原值。"""

        merged_model = dict(model)

        for key, value in patch.items():
            if key in self.PATCH_OBJECT_KEYS:
                if not isinstance(value, dict):
                    raise ValueError(f"model patch field must be a dict: {key}")

                current_value = merged_model.get(key, {})
                if isinstance(current_value, dict):
                    merged_value = dict(current_value)
                else:
                    merged_value = {}

                for nested_key, nested_value in value.items():
                    merged_value[str(nested_key)] = nested_value
                merged_model[key] = merged_value
            else:
                merged_model[key] = str(value)

        return merged_model

    def collect_group_model_ids(
        self,
        models: list[dict[str, object]],
        model_type: str,
    ) -> list[str]:
        """提取分组内模型 ID，保证排序动作只影响目标分类。"""

        result: list[str] = []
        for model_data in models:
            if str(model_data.get("type", ModelType.PRESET.value)) == model_type:
                model_id = str(model_data.get("id", ""))
                if model_id != "":
                    result.append(model_id)
        return result

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

    def build_api_test_messages(self, api_format: str) -> list[dict[str, str]]:
        """模型测试统一复用旧测试入口的提示词，避免不同入口结论漂移。"""

        if api_format == Base.APIFormat.SAKURALLM:
            return [
                {
                    "role": "system",
                    "content": "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
                },
                {
                    "role": "user",
                    "content": "将下面的日文文本翻译成中文：魔導具師ダリヤはうつむかない",
                },
            ]

        return [
            {
                "role": "system",
                "content": "任务目标是将内容文本翻译成中文，译文必须严格保持原文的格式。",
            },
            {
                "role": "user",
                "content": '{"0":"魔導具師ダリヤはうつむかない"}',
            },
        ]

    def build_api_test_error_reason(
        self,
        exception: Exception,
        request_timeout: int,
        timeout_template: str,
    ) -> str:
        """统一归一化测试失败原因，避免页面和日志看到不同口径。"""

        from module.Engine.TaskRequestErrors import RequestHardTimeoutError

        if isinstance(exception, RequestHardTimeoutError):
            return timeout_template.replace("{SECONDS}", str(request_timeout))

        exception_text = str(exception).strip()
        if exception_text != "":
            return f"{exception.__class__.__name__}: {exception_text}"
        return exception.__class__.__name__

    def mask_api_key(self, key: str) -> str:
        """结果里只暴露脱敏后的密钥片段，避免测试反馈把敏感信息带回 UI。"""

        normalized_key = key.strip()
        if len(normalized_key) <= 16:
            return normalized_key
        return (
            f"{normalized_key[:8]}"
            f"{'*' * (len(normalized_key) - 16)}"
            f"{normalized_key[-8:]}"
        )
