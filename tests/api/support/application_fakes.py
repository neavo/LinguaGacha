"""API 测试支持层的共享桩。

为什么这些桩属于测试支持层：
- 它们模拟的是应用服务依赖的稳定边界，而不是某个单独测试文件的临时细节。
- `application` 与 `client` 两类测试都会复用这些最小桩，因此放在支持层可以避免重复。
- pytest 9 不再允许在子目录 `conftest.py` 里借助插件注入夹具，因此这里主要承载 Fake 类与必要帮助。
"""

from copy import deepcopy

from base.BaseLanguage import BaseLanguage
from module.Model.Types import Model
from module.Model.Types import ModelType


class FakeModelConfig:
    """提供模型 API 测试使用的最小配置桩。"""

    DEFAULT_MODELS: tuple[dict[str, object], ...] = (
        {
            "id": "preset-1",
            "type": "PRESET",
            "name": "GPT-4.1",
            "api_format": "OpenAI",
            "api_url": "https://api.example.com/v1",
            "api_key": "preset-key",
            "model_id": "gpt-4.1",
            "request": {
                "extra_headers": {},
                "extra_headers_custom_enable": False,
                "extra_body": {},
                "extra_body_custom_enable": False,
            },
            "threshold": {
                "input_token_limit": 1024,
                "output_token_limit": 2048,
                "rpm_limit": 60,
                "concurrency_limit": 2,
            },
            "thinking": {"level": "HIGH"},
            "generation": {
                "temperature": 0.3,
                "temperature_custom_enable": True,
                "top_p": 0.8,
                "top_p_custom_enable": True,
                "presence_penalty": 0.1,
                "presence_penalty_custom_enable": False,
                "frequency_penalty": 0.2,
                "frequency_penalty_custom_enable": True,
            },
        },
        {
            "id": "preset-2",
            "type": "PRESET",
            "name": "GPT-4.1 Mini",
            "api_format": "OpenAI",
            "api_url": "https://api.example.com/v1",
            "api_key": "preset-key-2",
            "model_id": "gpt-4.1-mini",
            "request": {
                "extra_headers": {},
                "extra_headers_custom_enable": False,
                "extra_body": {},
                "extra_body_custom_enable": False,
            },
            "threshold": {
                "input_token_limit": 1024,
                "output_token_limit": 2048,
                "rpm_limit": 60,
                "concurrency_limit": 2,
            },
            "thinking": {"level": "LOW"},
            "generation": {
                "temperature": 0.4,
                "temperature_custom_enable": True,
                "top_p": 0.85,
                "top_p_custom_enable": True,
                "presence_penalty": 0.0,
                "presence_penalty_custom_enable": False,
                "frequency_penalty": 0.0,
                "frequency_penalty_custom_enable": False,
            },
        },
        {
            "id": "custom-openai-1",
            "type": "CUSTOM_OPENAI",
            "name": "Custom GPT",
            "api_format": "OpenAI",
            "api_url": "https://custom.example.com/v1",
            "api_key": "custom-key",
            "model_id": "gpt-custom",
            "request": {
                "extra_headers": {"X-Trace": "1"},
                "extra_headers_custom_enable": True,
                "extra_body": {},
                "extra_body_custom_enable": False,
            },
            "threshold": {
                "input_token_limit": 2048,
                "output_token_limit": 4096,
                "rpm_limit": 30,
                "concurrency_limit": 1,
            },
            "thinking": {"level": "OFF"},
            "generation": {
                "temperature": 0.7,
                "temperature_custom_enable": True,
                "top_p": 0.9,
                "top_p_custom_enable": False,
                "presence_penalty": 0.0,
                "presence_penalty_custom_enable": False,
                "frequency_penalty": 0.0,
                "frequency_penalty_custom_enable": False,
            },
        },
    )

    def __init__(self) -> None:
        self.app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
        self.activate_model_id: str = "preset-1"
        self.models: list[dict[str, object]] = deepcopy(list(self.DEFAULT_MODELS))
        self.load_calls: int = 0
        self.save_calls: int = 0
        self.initialize_calls: int = 0

    def load(self) -> "FakeModelConfig":
        self.load_calls += 1
        return self

    def save(self) -> "FakeModelConfig":
        self.save_calls += 1
        return self

    def initialize_models(self) -> int:
        self.initialize_calls += 1
        if not self.models:
            self.models = deepcopy(list(self.DEFAULT_MODELS))

        if self.activate_model_id == "" and self.models:
            self.activate_model_id = str(self.models[0].get("id", ""))

        return 0

    def get_model(self, model_id: str) -> dict[str, object] | None:
        for model in self.models:
            if model.get("id") == model_id:
                return model
        return None

    def set_model(self, model_data: dict[str, object]) -> None:
        model_id = model_data.get("id")
        for index, model in enumerate(self.models):
            if model.get("id") == model_id:
                self.models[index] = deepcopy(model_data)
                break

    def set_active_model_id(self, model_id: str) -> None:
        self.activate_model_id = model_id


class FakeModelManager:
    """提供模型 API 测试使用的最小模型管理桩。"""

    PRESET_MODEL_BY_ID: dict[str, dict[str, object]] = {
        "preset-1": deepcopy(FakeModelConfig.DEFAULT_MODELS[0]),
        "preset-2": deepcopy(FakeModelConfig.DEFAULT_MODELS[1]),
    }
    TEMPLATE_BY_TYPE: dict[ModelType, dict[str, object]] = {
        ModelType.CUSTOM_GOOGLE: {
            "name": "New Google Model",
            "api_format": "Google",
            "api_url": "https://google.example.com/v1beta",
            "api_key": "google-key",
            "model_id": "gemini-2.5-pro",
            "request": {},
            "threshold": {},
            "thinking": {"level": "OFF"},
            "generation": {},
        },
        ModelType.CUSTOM_OPENAI: {
            "name": "New OpenAI Model",
            "api_format": "OpenAI",
            "api_url": "https://openai.example.com/v1",
            "api_key": "openai-key",
            "model_id": "gpt-4.1-mini",
            "request": {},
            "threshold": {},
            "thinking": {"level": "OFF"},
            "generation": {},
        },
        ModelType.CUSTOM_ANTHROPIC: {
            "name": "New Anthropic Model",
            "api_format": "Anthropic",
            "api_url": "https://anthropic.example.com/v1",
            "api_key": "anthropic-key",
            "model_id": "claude-3-7-sonnet",
            "request": {},
            "threshold": {},
            "thinking": {"level": "OFF"},
            "generation": {},
        },
    }

    def __init__(self) -> None:
        self.models: list[Model] = []
        self.activate_model_id: str = ""
        self.add_counter: int = 1

    def set_models(self, models_data: list[dict[str, object]]) -> None:
        self.models = [Model.from_dict(deepcopy(dict(model))) for model in models_data]

    def get_models_as_dict(self) -> list[dict[str, object]]:
        return [model.to_dict() for model in self.models]

    def get_model_by_id(self, model_id: str) -> Model | None:
        for model in self.models:
            if model.id == model_id:
                return model
        return None

    def get_active_model(self) -> Model | None:
        for model in self.models:
            if model.id == self.activate_model_id:
                return model

        if self.models:
            return self.models[0]
        return None

    def set_active_model_id(self, model_id: str) -> None:
        self.activate_model_id = model_id

    def add_model(self, model_type: ModelType) -> Model:
        template = deepcopy(self.TEMPLATE_BY_TYPE[model_type])
        template["id"] = f"{model_type.value.lower()}-{self.add_counter}"
        template["type"] = model_type.value
        self.add_counter += 1
        model = Model.from_dict(template)
        self.models.append(model)
        return model

    def delete_model(self, model_id: str) -> bool:
        target_model = self.get_model_by_id(model_id)
        if target_model is None:
            return False

        if target_model.is_preset():
            return False

        self.models = [model for model in self.models if model.id != model_id]
        if self.activate_model_id == model_id:
            active_model = self.get_active_model()
            if active_model is not None:
                self.activate_model_id = active_model.id
            else:
                self.activate_model_id = ""
        return True

    def reset_preset_model(self, model_id: str) -> bool:
        preset_model = self.PRESET_MODEL_BY_ID.get(model_id)
        if preset_model is None:
            return False

        for index, model in enumerate(self.models):
            if model.id == model_id:
                self.models[index] = Model.from_dict(deepcopy(preset_model))
                return True

        return False

    def reorder_models(self, ordered_ids: list[str]) -> None:
        model_map = {model.id: model for model in self.models}
        reordered_models: list[Model] = []
        for model_id in ordered_ids:
            if model_id in model_map:
                reordered_models.append(model_map[model_id])

        self.models = reordered_models
