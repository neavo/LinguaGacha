import dataclasses
import os
import shutil
import threading
from enum import StrEnum
from typing import Any
from typing import ClassVar
from typing import Self

from base.BasePath import BasePath
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer
from module.Model.Manager import ModelManager
from module.Utils.JSONTool import JSONTool


@dataclasses.dataclass
class Config:
    CONFIG_FILE_NAME: ClassVar[str] = "config.json"
    MODEL_TYPE_SORT_ORDER: ClassVar[dict[str, int]] = {
        "PRESET": 0,
        "CUSTOM_GOOGLE": 1,
        "CUSTOM_OPENAI": 2,
        "CUSTOM_ANTHROPIC": 3,
    }

    class ProjectSaveMode(StrEnum):
        MANUAL = "MANUAL"
        SOURCE = "SOURCE"
        FIXED = "FIXED"

    # Application
    app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH

    # ModelPage - 模型管理系统
    activate_model_id: str = ""
    models: list[dict[str, Any]] | None = None

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
    mtool_optimizer_enable: bool = True

    # GlossaryPage
    glossary_default_preset: str = ""

    # TextPreservePage
    text_preserve_default_preset: str = ""

    # TextReplacementPage
    pre_translation_replacement_default_preset: str = ""
    post_translation_replacement_default_preset: str = ""

    # CustomPromptPage
    translation_custom_prompt_default_preset: str = ""
    analysis_custom_prompt_default_preset: str = ""

    # 最近打开的工程列表 [{"path": "...", "name": "...", "updated_at": "..."}]
    recent_projects: list[dict[str, str]] = dataclasses.field(default_factory=list)

    # 类属性
    CONFIG_LOCK: ClassVar[threading.Lock] = threading.Lock()

    @classmethod
    def get_default_path(cls) -> str:
        """统一返回默认配置文件路径，避免读写两边各自拼接。"""

        return os.path.join(BasePath.get_user_data_root_dir(), cls.CONFIG_FILE_NAME)

    @classmethod
    def resolve_path(cls, path: str | None) -> str:
        """把外部可选路径统一收口，减少 load/save 各自处理默认值。"""

        if path is None:
            return cls.get_default_path()
        return path

    @classmethod
    def build_recent_project_display_name(cls, path: str) -> str:
        """统一从工程文件路径推导最近项目标题，避免混入源目录或预览名。"""

        file_name = os.path.basename(path)
        stem, _ = os.path.splitext(file_name)

        if stem:
            return stem
        else:
            return file_name

    @classmethod
    def get_legacy_default_paths(cls) -> list[str]:
        """收口旧版默认配置位置，便于启动时做一次性迁移。"""

        data_dir = BasePath.get_data_dir()
        app_dir = BasePath.get_app_dir()

        # 迁移优先级必须与 main 分支旧默认读取规则一致：
        # 1. 便携/只读安装场景优先沿用 data_dir/config.json。
        # 2. 普通桌面场景优先沿用 resource/config.json。
        # 3. app_dir/config.json 仅作为更早历史残留的兜底来源。
        if os.path.normcase(os.path.normpath(data_dir)) != os.path.normcase(
            os.path.normpath(app_dir)
        ):
            candidate_paths: list[str] = [
                os.path.join(data_dir, cls.CONFIG_FILE_NAME),
                os.path.join(BasePath.get_resource_dir(), cls.CONFIG_FILE_NAME),
                os.path.join(app_dir, cls.CONFIG_FILE_NAME),
            ]
        else:
            candidate_paths = [
                os.path.join(BasePath.get_resource_dir(), cls.CONFIG_FILE_NAME),
                os.path.join(data_dir, cls.CONFIG_FILE_NAME),
                os.path.join(app_dir, cls.CONFIG_FILE_NAME),
            ]

        unique_paths: list[str] = []
        seen_paths: set[str] = set()

        for path in candidate_paths:
            normalized_path = os.path.normcase(os.path.normpath(path))
            if normalized_path in seen_paths:
                continue

            seen_paths.add(normalized_path)
            unique_paths.append(path)

        return unique_paths

    @classmethod
    def migrate_default_config_if_needed(cls, target_path: str) -> None:
        """把旧默认位置的配置复制到 userdata，后续优先读取新位置。"""

        if os.path.isfile(target_path):
            return

        target_dir = os.path.dirname(target_path)
        os.makedirs(target_dir, exist_ok=True)
        for source_path in cls.get_legacy_default_paths():
            if not os.path.isfile(source_path):
                continue

            shutil.copyfile(source_path, target_path)
            return

    def load(self, path: str | None = None) -> Self:
        path = __class__.resolve_path(path)

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

    def save(
        self,
        path: str | None = None,
        *,
        raise_on_error: bool = False,
    ) -> Self:
        path = __class__.resolve_path(path)

        # 按分类排序: 预设 - Google - OpenAI - Claude
        if self.models:

            def get_sort_key(model: dict[str, Any]) -> int:
                return __class__.MODEL_TYPE_SORT_ORDER.get(model.get("type", ""), 99)

            self.models.sort(key=get_sort_key)

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as writer:
                    writer.write(JSONTool.dumps(dataclasses.asdict(self), indent=4))
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_write_file_fail}", e)
                if raise_on_error:
                    raise

        return self

    # 初始化模型管理器
    def initialize_models(self) -> int:
        """初始化模型列表，如果没有则从预设复制。返回兼容保留的固定迁移数量。"""
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

    # ========== 最近打开的工程 ==========
    def add_recent_project(self, path: str, name: str) -> None:
        """添加最近打开的工程"""
        from datetime import datetime

        del name
        normalized_name = self.build_recent_project_display_name(path)

        # 移除已存在的同路径条目
        self.recent_projects = [
            p for p in self.recent_projects if p.get("path") != path
        ]

        # 添加到开头
        self.recent_projects.insert(
            0,
            {
                "path": path,
                # 最近使用列表代表的是工程文件本身，因此标题统一由 .lg 路径推导。
                "name": normalized_name,
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
