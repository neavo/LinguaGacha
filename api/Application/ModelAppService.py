from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from api.Contract.ModelPayloads import ModelPageSnapshotPayload
from base.BaseLanguage import BaseLanguage
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelPageSnapshot
from model.Model import ModelType
from module.Config import Config
from module.ModelManager import ModelManager


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
    ) -> None:
        self.config_loader = (
            config_loader if config_loader is not None else self.default_config_loader
        )
        self.model_manager = (
            model_manager if model_manager is not None else ModelManager.get()
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
