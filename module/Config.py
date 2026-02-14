import dataclasses
import os
import threading
from enum import StrEnum
from typing import Any
from typing import ClassVar
from typing import Self

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer
from module.ModelManager import ModelManager
from module.Utils.JSONTool import JSONTool


@dataclasses.dataclass
class Config:
    class Theme(StrEnum):
        DARK = "DARK"
        LIGHT = "LIGHT"

    class ProjectSaveMode(StrEnum):
        MANUAL = "MANUAL"
        SOURCE = "SOURCE"
        FIXED = "FIXED"

    # Application
    theme: str = Theme.LIGHT
    app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

    # ModelPage - 模型管理系统
    activate_model_id: str = ""
    models: list[dict[str, Any]] | None = None

    # AppSettingsPage
    expert_mode: bool = False
    proxy_url: str = ""
    proxy_enable: bool = False
    scale_factor: str = ""

    # BasicSettingsPage
    # 配置文件持久化为字符串，因此运行时也允许 str（例如 target_language="ZH"）。
    # 仅 source_language 支持 BaseLanguage.ALL（关闭语言过滤），target_language 不支持 ALL。
    source_language: BaseLanguage.Enum | str = BaseLanguage.Enum.JA
    target_language: BaseLanguage.Enum | str = BaseLanguage.Enum.ZH
    project_save_mode: str = ProjectSaveMode.MANUAL
    project_fixed_path: str = ""
    output_folder_open_on_finish: bool = False
    request_timeout: int = 120

    # ExpertSettingsPage
    preceding_lines_threshold: int = 0
    clean_ruby: bool = False
    deduplication_in_trans: bool = True
    deduplication_in_bilingual: bool = True
    check_kana_residue: bool = True
    check_hangeul_residue: bool = True
    check_similarity: bool = True
    write_translated_name_fields_to_file: bool = True
    auto_process_prefix_suffix_preserved_text: bool = True

    # LaboratoryPage
    auto_glossary_enable: bool = False
    mtool_optimizer_enable: bool = False

    # GlossaryPage
    glossary_default_preset: str = ""

    # TextPreservePage
    text_preserve_default_preset: str = ""

    # TextReplacementPage
    pre_translation_replacement_default_preset: str = ""
    post_translation_replacement_default_preset: str = ""

    # CustomPromptPage
    custom_prompt_zh_default_preset: str = ""
    custom_prompt_en_default_preset: str = ""

    # 最近打开的工程列表 [{"path": "...", "name": "...", "updated_at": "..."}]
    recent_projects: list[dict[str, str]] = dataclasses.field(default_factory=list)

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

    def load(self, path: str | None = None) -> Self:
        if path is None:
            path = __class__.get_config_path()

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                if os.path.isfile(path):
                    config: Any = JSONTool.load_file(path)
                    if isinstance(config, dict):
                        for k, v in config.items():
                            if hasattr(self, k):
                                setattr(self, k, v)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_read_file_fail}", e)

        return self

    def save(self, path: str | None = None) -> Self:
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
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as writer:
                    writer.write(JSONTool.dumps(dataclasses.asdict(self), indent=4))
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_write_file_fail}", e)

        return self

    # 重置专家模式
    def reset_expert_settings(self) -> None:
        # ExpertSettingsPage
        self.preceding_lines_threshold: int = 0
        self.clean_ruby: bool = True
        self.deduplication_in_trans: bool = True
        self.deduplication_in_bilingual: bool = True
        self.check_kana_residue: bool = True
        self.check_hangeul_residue: bool = True
        self.check_similarity: bool = True
        self.write_translated_name_fields_to_file: bool = True
        self.auto_process_prefix_suffix_preserved_text: bool = True

    # 初始化模型管理器
    def initialize_models(self) -> int:
        """初始化模型列表，如果没有则从预设复制。返回已被迁移的失效预设模型数量。"""
        manager = ModelManager.get()
        # 设置 UI 语言以确定预设目录
        manager.set_app_language(self.app_language)
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
        models = self.models or []
        model_id = model_data.get("id")
        for i, model in enumerate(models):
            if model.get("id") == model_id:
                models[i] = model_data
                break

        self.models = models
        # 同步到 ModelManager
        ModelManager.get().set_models(models)

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

    # ========== 最近打开的工程 ==========
    def add_recent_project(self, path: str, name: str) -> None:
        """添加最近打开的工程"""
        from datetime import datetime

        # 移除已存在的同路径条目
        self.recent_projects = [
            p for p in self.recent_projects if p.get("path") != path
        ]

        # 添加到开头
        self.recent_projects.insert(
            0,
            {
                "path": path,
                "name": name,
                "updated_at": datetime.now().isoformat(),
            },
        )

        # 保留最近 10 个
        self.recent_projects = self.recent_projects[:10]

    def remove_recent_project(self, path: str) -> None:
        """移除最近打开的工程"""
        self.recent_projects = [
            p for p in self.recent_projects if p.get("path") != path
        ]
