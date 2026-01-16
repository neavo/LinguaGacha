import dataclasses
import json
import os
import threading
from enum import StrEnum
from typing import Any
from typing import ClassVar
from typing import Self

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from model.Model import Model
from model.ModelManager import ModelManager
from module.Localizer.Localizer import Localizer

@dataclasses.dataclass
class Config():

    class Theme(StrEnum):

        DARK = "DARK"
        LIGHT = "LIGHT"

    # Application
    theme: str = Theme.LIGHT
    app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

    # ModelPage - 模型管理系统
    activate_model_id: str = ""
    models: list[dict[str, Any]] = None

    # AppSettingsPage
    expert_mode: bool = False
    proxy_url: str = ""
    proxy_enable: bool = False
    font_hinting: bool = True
    scale_factor: str = ""

    request_timeout: int = 120
    max_round: int = 16

    # ExpertSettingsPage
    preceding_lines_threshold: int = 0
    enable_preceding_on_local: bool = False
    clean_ruby: bool = False
    deduplication_in_trans: bool = True
    deduplication_in_bilingual: bool = True
    write_translated_name_fields_to_file: bool = True
    auto_process_prefix_suffix_preserved_text: bool = True

    # BasicSettingsPage
    source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA
    target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
    input_folder: str = "./input"
    output_folder: str = "./output"
    output_folder_open_on_finish: bool = False
    traditional_chinese_enable: bool = False

    # GlossaryPage
    glossary_enable: bool = True
    glossary_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # TextPreservePage
    text_preserve_enable: bool = False
    text_preserve_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # PreTranslationReplacementPage
    pre_translation_replacement_enable: bool = True
    pre_translation_replacement_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # PostTranslationReplacementPage
    post_translation_replacement_enable: bool = True
    post_translation_replacement_data: list[dict[str, str]] = dataclasses.field(default_factory = list)

    # CustomPromptZHPage
    custom_prompt_zh_enable: bool = False
    custom_prompt_zh_data: str = None

    # CustomPromptENPage
    custom_prompt_en_enable: bool = False
    custom_prompt_en_data: str = None

    # LaboratoryPage
    auto_glossary_enable: bool = False
    mtool_optimizer_enable: bool = False

    # 类属性
    CONFIG_LOCK: ClassVar[threading.Lock] = threading.Lock()

    @staticmethod
    def get_config_path() -> str:
        """根据环境获取配置文件路径。"""
        data_dir = os.environ.get("LINGUAGACHA_DATA_DIR")
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR")
        # 便携式环境（AppImage, macOS .app）使用 data_dir/config.json
        if data_dir and app_dir and data_dir != app_dir:
            return os.path.join(data_dir, "config.json")
        # 默认：使用应用目录下的 resource/config.json
        return os.path.join(app_dir or ".", "resource", "config.json")

    def load(self, path: str = None) -> Self:
        if path is None:
            path = __class__.get_config_path()

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok = True)
                if os.path.isfile(path):
                    with open(path, "r", encoding = "utf-8-sig") as reader:
                        config: dict = json.load(reader)
                        for k, v in config.items():
                            if hasattr(self, k):
                                setattr(self, k, v)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_read_file_fail}", e)

        # 便携式环境下调整默认路径
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR", ".")
        data_dir = os.environ.get("LINGUAGACHA_DATA_DIR", ".")
        if data_dir != app_dir:
            # 便携式环境中，将默认相对路径解析到 data_dir
            if self.input_folder == "./input":
                self.input_folder = os.path.join(data_dir, "input")
            if self.output_folder == "./output":
                self.output_folder = os.path.join(data_dir, "output")

        return self

    def save(self, path: str = None) -> Self:
        if path is None:
            path = __class__.get_config_path()

        # 按分类排序: 预设 - Google - OpenAI - Claude
        if self.models:
            def get_sort_key(model: dict[str, Any]) -> int:
                type_str = model.get("type", "")
                if type_str == "PRESET":
                    return 0
                elif type_str == "CUSTOM_GOOGLE":
                    return 1
                elif type_str == "CUSTOM_OPENAI":
                    return 2
                elif type_str == "CUSTOM_ANTHROPIC":
                    return 3
                return 99

            self.models.sort(key=get_sort_key)

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok = True)
                with open(path, "w", encoding = "utf-8") as writer:
                    json.dump(dataclasses.asdict(self), writer, indent = 4, ensure_ascii = False)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_write_file_fail}", e)

        return self

    # 重置专家模式
    def reset_expert_settings(self) -> None:
        # ExpertSettingsPage
        self.preceding_lines_threshold: int = 0
        self.enable_preceding_on_local: bool = False
        self.clean_ruby: bool = True
        self.deduplication_in_trans: bool = True
        self.deduplication_in_bilingual: bool = True
        self.write_translated_name_fields_to_file: bool = True
        self.auto_process_prefix_suffix_preserved_text: bool = True

        # TextPreservePage
        self.text_preserve_enable: bool = False
        self.text_preserve_data: list[Any] = []



    # 初始化模型管理器
    def initialize_models(self) -> int:
        """初始化模型列表，如果没有则从预设复制。返回已被迁移的失效预设模型数量。"""
        manager = ModelManager.get()
        self.models, migrated_count = manager.initialize_models(self.models or [])
        manager.set_models(self.models)
        # 如果没有激活模型，设置为第一个
        if not self.activate_model_id and self.models:
            self.activate_model_id = self.models[0].get("id", "")
        manager.set_active_model_id(self.activate_model_id)
        return migrated_count

    # 获取模型配置
    def get_model(self, model_id: str) -> dict[str, Any] | None:
        """根据 ID 获取模型配置字典"""
        for model in self.models or []:
            if model.get("id") == model_id:
                return model
        return None

    # 更新模型配置
    def set_model(self, model_data: dict[str, Any]) -> None:
        """更新模型配置"""
        model_id = model_data.get("id")
        for i, model in enumerate(self.models or []):
            if model.get("id") == model_id:
                self.models[i] = model_data
                break
        # 同步到 ModelManager
        ModelManager.get().set_models(self.models)

    # 获取激活的模型
    def get_active_model(self) -> dict[str, Any] | None:
        """获取当前激活的模型配置"""
        if self.activate_model_id:
            model = self.get_model(self.activate_model_id)
            if model:
                return model
        # 如果没有或找不到，返回第一个
        if self.models:
            return self.models[0]
        return None

    # 设置激活的模型
    def set_active_model_id(self, model_id: str) -> None:
        """设置激活的模型 ID"""
        self.activate_model_id = model_id
        ModelManager.get().set_active_model_id(model_id)

    # 同步模型数据到 ModelManager
    def sync_models_to_manager(self) -> None:
        """将 Config 中的 models 同步到 ModelManager"""
        manager = ModelManager.get()
        manager.set_models(self.models or [])
        manager.set_active_model_id(self.activate_model_id)

    # 从 ModelManager 同步模型数据
    def sync_models_from_manager(self) -> None:
        """从 ModelManager 同步数据到 Config"""
        manager = ModelManager.get()
        self.models = manager.get_models_as_dict()
        self.activate_model_id = manager.activate_model_id
