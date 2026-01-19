"""应用级别配置

存储跟随用户环境的设置，与项目无关：
- API Key、代理设置
- 主题、语言、缩放比例
- 最近打开的工程列表
"""

import dataclasses
import json
import os
import threading
from typing import Any
from typing import ClassVar
from typing import Self

from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer
from module.ModelManager import ModelManager

@dataclasses.dataclass
class AppConfig:
    """应用级别配置"""

    class Theme:
        DARK = "DARK"
        LIGHT = "LIGHT"

    # 外观
    theme: str = "LIGHT"
    app_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
    font_hinting: bool = True
    scale_factor: str = ""

    # 网络
    proxy_url: str = ""
    proxy_enable: bool = False
    request_timeout: int = 120

    # 模型管理
    activate_model_id: str = ""
    models: list[dict[str, Any]] = None

    # 翻译设置（App 级默认值，新建工程时使用）
    default_source_language: BaseLanguage.Enum = BaseLanguage.Enum.JA
    default_target_language: BaseLanguage.Enum = BaseLanguage.Enum.ZH
    max_round: int = 16

    # 专家模式
    expert_mode: bool = False

    # 最近打开的工程列表 [{"path": "...", "name": "...", "updated_at": "..."}]
    recent_projects: list[dict[str, str]] = dataclasses.field(default_factory=list)

    # 类属性
    CONFIG_LOCK: ClassVar[threading.Lock] = threading.Lock()

    @staticmethod
    def get_config_path() -> str:
        """获取配置文件路径"""
        data_dir = os.environ.get("LINGUAGACHA_DATA_DIR")
        app_dir = os.environ.get("LINGUAGACHA_APP_DIR")
        # 便携式环境使用 data_dir/app_config.json
        if data_dir and app_dir and data_dir != app_dir:
            return os.path.join(data_dir, "app_config.json")
        # 默认使用 resource/app_config.json
        return os.path.join(app_dir or ".", "resource", "app_config.json")

    def load(self, path: str = None) -> Self:
        """加载配置"""
        if path is None:
            path = __class__.get_config_path()

        with __class__.CONFIG_LOCK:
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                if os.path.isfile(path):
                    with open(path, "r", encoding="utf-8-sig") as reader:
                        config: dict = json.load(reader)
                        for k, v in config.items():
                            if hasattr(self, k):
                                setattr(self, k, v)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_read_file_fail}", e)

        return self

    def save(self, path: str = None) -> Self:
        """保存配置"""
        if path is None:
            path = __class__.get_config_path()

        # 按分类排序模型: 预设 - Google - OpenAI - Claude
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
                    json.dump(dataclasses.asdict(self), writer, indent=4, ensure_ascii=False)
            except Exception as e:
                LogManager.get().error(f"{Localizer.get().log_write_file_fail}", e)

        return self

    # ========== 模型管理 ==========

    def initialize_models(self) -> int:
        """初始化模型列表，如果没有则从预设复制。返回已被迁移的失效预设模型数量。"""
        manager = ModelManager.get()
        manager.set_app_language(self.app_language)
        self.models, migrated_count = manager.initialize_models(self.models or [])
        manager.set_models(self.models)
        if not self.activate_model_id and self.models:
            self.activate_model_id = self.models[0].get("id", "")
        manager.set_active_model_id(self.activate_model_id)
        return migrated_count

    def get_model(self, model_id: str) -> dict[str, Any] | None:
        """根据 ID 获取模型配置字典"""
        for model in self.models or []:
            if model.get("id") == model_id:
                return model
        return None

    def set_model(self, model_data: dict[str, Any]) -> None:
        """更新模型配置"""
        model_id = model_data.get("id")
        for i, model in enumerate(self.models or []):
            if model.get("id") == model_id:
                self.models[i] = model_data
                break
        ModelManager.get().set_models(self.models)

    def get_active_model(self) -> dict[str, Any] | None:
        """获取当前激活的模型配置"""
        if self.activate_model_id:
            model = self.get_model(self.activate_model_id)
            if model:
                return model
        if self.models:
            return self.models[0]
        return None

    def set_active_model_id(self, model_id: str) -> None:
        """设置激活的模型 ID"""
        self.activate_model_id = model_id
        ModelManager.get().set_active_model_id(model_id)

    def sync_models_to_manager(self) -> None:
        """将 Config 中的 models 同步到 ModelManager"""
        manager = ModelManager.get()
        manager.set_models(self.models or [])
        manager.set_active_model_id(self.activate_model_id)

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
        self.recent_projects = [p for p in self.recent_projects if p.get("path") != path]

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
        self.recent_projects = [p for p in self.recent_projects if p.get("path") != path]
