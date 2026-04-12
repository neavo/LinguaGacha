"""API 测试支持层的共享桩。

为什么这些桩属于测试支持层：
- 它们模拟的是应用服务依赖的稳定边界，而不是某个单独测试文件的临时细节。
- `application` 与 `client` 两类测试都会复用这些最小桩，因此放在支持层可以避免重复。
- pytest 9 不再允许在子目录 `conftest.py` 里借助插件注入夹具，因此这里主要承载 Fake 类与必要帮助。
"""

from copy import deepcopy
from pathlib import Path
from typing import TYPE_CHECKING

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Model import Model
from model.Model import ModelType
from module.Config import Config

if TYPE_CHECKING:
    from module.Data.Core.DataTypes import WorkbenchSnapshot


class FakeProjectManager:
    """为 API 用例层测试提供最小工程读写桩。"""

    def __init__(self) -> None:
        self.loaded: bool = False
        self.project_path: str = ""
        self.load_calls: list[str] = []
        self.create_calls: list[tuple[str, str]] = []

    def load_project(self, path: str) -> None:
        self.loaded = True
        self.project_path = path
        self.load_calls.append(path)

    def create_project(self, source_path: str, output_path: str) -> None:
        self.create_calls.append((source_path, output_path))
        self.project_path = output_path

    def unload_project(self) -> None:
        self.loaded = False
        self.project_path = ""

    def is_loaded(self) -> bool:
        return self.loaded

    def get_lg_path(self) -> str:
        return self.project_path

    def get_supported_extensions(self) -> set[str]:
        return {".txt", ".json"}

    def collect_source_files(self, path: str) -> list[str]:
        return [path]

    def get_project_preview(self, path: str) -> dict[str, object]:
        return {
            "path": path,
            "name": Path(path).stem,
            "source_language": "JA",
            "target_language": "ZH",
            "file_count": 1,
            "created_at": "",
            "updated_at": "",
            "total_items": 8,
            "translated_items": 3,
            "progress": 0.375,
        }


class FakeEngine:
    """任务 API 测试使用的最小引擎桩。"""

    def __init__(self) -> None:
        self.status: Base.TaskStatus = Base.TaskStatus.IDLE
        self.request_in_flight_count: int = 0
        self.active_task_type: str = ""

    def get_status(self) -> Base.TaskStatus:
        return self.status

    def is_busy(self) -> bool:
        return self.status in (
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.ANALYZING,
            Base.TaskStatus.STOPPING,
        )

    def get_request_in_flight_count(self) -> int:
        return self.request_in_flight_count

    def get_active_task_type(self) -> str:
        return self.active_task_type


class FakeTaskDataManager:
    """提供任务快照所需的最小数据桩。"""

    def __init__(self) -> None:
        self.translation_extras: dict[str, int | float] = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0.0,
            "start_time": 0.0,
        }
        self.analysis_snapshot: dict[str, int | float] = {
            "line": 0,
            "total_line": 0,
            "processed_line": 0,
            "error_line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0.0,
            "start_time": 0.0,
        }
        self.analysis_candidate_count: int = 0

    def get_translation_extras(self) -> dict[str, int | float]:
        return dict(self.translation_extras)

    def get_analysis_progress_snapshot(self) -> dict[str, int | float]:
        return dict(self.analysis_snapshot)

    def get_task_progress_snapshot(self, task_type: str) -> dict[str, int | float]:
        if task_type == "analysis":
            return self.get_analysis_progress_snapshot()
        return self.get_translation_extras()

    def get_analysis_candidate_count(self) -> int:
        return self.analysis_candidate_count


class FakeWorkbenchManager:
    """提供工作台快照与文件操作所需的最小数据桩。"""

    def __init__(self) -> None:
        self.file_op_running: bool = False
        self.supported_extensions: set[str] = {".txt", ".json"}
        self.snapshot: dict[str, int | tuple[dict[str, str | int], ...]] = {
            "file_count": 1,
            "total_items": 2,
            "translated": 1,
            "translated_in_past": 0,
            "untranslated": 1,
            "entries": (
                {
                    "rel_path": "script/a.txt",
                    "item_count": 2,
                    "file_type": "TXT",
                },
            ),
        }
        self.add_calls: list[str] = []
        self.replace_calls: list[tuple[str, str]] = []
        self.reset_calls: list[str] = []
        self.delete_calls: list[str] = []
        self.reorder_calls: list[list[str]] = []

    def build_workbench_snapshot(self) -> "WorkbenchSnapshot":
        from module.Data.Core.DataTypes import WorkbenchFileEntrySnapshot
        from module.Data.Core.DataTypes import WorkbenchSnapshot
        from model.Item import Item

        entry_dict = self.snapshot["entries"][0]
        entry = WorkbenchFileEntrySnapshot(
            rel_path=str(entry_dict["rel_path"]),
            item_count=int(entry_dict["item_count"]),
            file_type=Item.FileType(str(entry_dict["file_type"])),
        )
        return WorkbenchSnapshot(
            file_count=int(self.snapshot["file_count"]),
            total_items=int(self.snapshot["total_items"]),
            translated=int(self.snapshot["translated"]),
            translated_in_past=int(self.snapshot["translated_in_past"]),
            untranslated=int(self.snapshot["untranslated"]),
            entries=(entry,),
        )

    def is_file_op_running(self) -> bool:
        return self.file_op_running

    def get_supported_extensions(self) -> set[str]:
        return set(self.supported_extensions)

    def schedule_add_file(self, path: str) -> None:
        self.add_calls.append(path)

    def schedule_replace_file(self, rel_path: str, path: str) -> None:
        self.replace_calls.append((rel_path, path))

    def schedule_reset_file(self, rel_path: str) -> None:
        self.reset_calls.append(rel_path)

    def schedule_delete_file(self, rel_path: str) -> None:
        self.delete_calls.append(rel_path)

    def schedule_reorder_files(self, ordered_rel_paths: list[str]) -> None:
        self.reorder_calls.append(list(ordered_rel_paths))


class FakeSettingsConfig:
    """提供设置页 API 所需的最小配置桩。"""

    def __init__(self) -> None:
        self.theme: str = Config.Theme.LIGHT
        self.app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
        self.expert_mode: bool = False
        self.proxy_url: str = ""
        self.proxy_enable: bool = False
        self.scale_factor: str = ""
        self.source_language: BaseLanguage.Enum | str = BaseLanguage.Enum.JA
        self.target_language: BaseLanguage.Enum | str = BaseLanguage.Enum.ZH
        self.project_save_mode: str = Config.ProjectSaveMode.MANUAL
        self.project_fixed_path: str = ""
        self.output_folder_open_on_finish: bool = False
        self.request_timeout: int = 120
        self.preceding_lines_threshold: int = 0
        self.clean_ruby: bool = False
        self.deduplication_in_trans: bool = True
        self.deduplication_in_bilingual: bool = True
        self.check_kana_residue: bool = True
        self.check_hangeul_residue: bool = True
        self.check_similarity: bool = True
        self.write_translated_name_fields_to_file: bool = True
        self.auto_process_prefix_suffix_preserved_text: bool = True
        self.mtool_optimizer_enable: bool = False
        self.force_thinking_enable: bool = True
        self.glossary_default_preset: str = ""
        self.text_preserve_default_preset: str = ""
        self.pre_translation_replacement_default_preset: str = ""
        self.post_translation_replacement_default_preset: str = ""
        self.translation_custom_prompt_default_preset: str = ""
        self.analysis_custom_prompt_default_preset: str = ""
        self.recent_projects: list[dict[str, str]] = []
        self.load_calls: int = 0
        self.save_calls: int = 0
        self.reset_calls: int = 0

    def load(self) -> "FakeSettingsConfig":
        self.load_calls += 1
        return self

    def save(self) -> "FakeSettingsConfig":
        self.save_calls += 1
        return self

    def reset_expert_settings(self) -> None:
        self.reset_calls += 1
        self.preceding_lines_threshold = 0
        self.clean_ruby = True
        self.deduplication_in_trans = True
        self.deduplication_in_bilingual = True
        self.check_kana_residue = True
        self.check_hangeul_residue = True
        self.check_similarity = True
        self.write_translated_name_fields_to_file = True
        self.auto_process_prefix_suffix_preserved_text = True

    def add_recent_project(self, path: str, name: str) -> None:
        del name

        self.recent_projects = [
            project for project in self.recent_projects if project.get("path") != path
        ]

        file_name = path.replace("\\", "/").split("/")[-1]
        stem = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
        self.recent_projects.insert(0, {"path": path, "name": stem})
        self.recent_projects = self.recent_projects[:10]

    def remove_recent_project(self, path: str) -> None:
        self.recent_projects = [
            project for project in self.recent_projects if project.get("path") != path
        ]


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
        self.app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
        self.add_counter: int = 1

    def set_app_language(self, language: BaseLanguage.Enum) -> None:
        self.app_language = language

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
