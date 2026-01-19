"""会话级上下文

管理当前工程实例的加载、运行、卸载生命周期。
替代静态全局变量，确保项目关闭后内存完全释放、状态彻底重置。
"""

import threading
from typing import Any

from base.Base import Base
from module.ProjectConfig import ProjectConfig
from module.Storage.LGDatabase import LGDatabase


class SessionContext(Base):
    """会话级上下文，管理当前工程实例"""

    _instance: "SessionContext | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        super().__init__()
        self._db: LGDatabase | None = None
        self._config: ProjectConfig | None = None
        self._lg_path: str | None = None

    @classmethod
    def get(cls) -> "SessionContext":
        """获取单例实例"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ========== 生命周期 ==========

    def load(self, lg_path: str) -> None:
        """加载工程

        Args:
            lg_path: .lg 文件的绝对路径
        """
        # 先卸载当前工程
        if self.is_loaded():
            self.unload()

        # 加载新工程
        self._lg_path = lg_path
        self._db = LGDatabase.load(lg_path)
        self._config = ProjectConfig.load_from_db(self._db)

        # 发送工程加载事件
        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload(self) -> None:
        """卸载当前工程"""
        if self._db is not None:
            # 保存配置
            if self._config is not None:
                self._config.save_to_db(self._db)

            # 关闭数据库
            self._db.close()

        # 清空状态
        old_path = self._lg_path
        self._db = None
        self._config = None
        self._lg_path = None

        # 发送工程卸载事件
        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def is_loaded(self) -> bool:
        """检查是否已加载工程"""
        return self._db is not None and self._db.is_open()

    # ========== 访问器 ==========

    def get_db(self) -> LGDatabase | None:
        """获取当前工程的数据库访问对象"""
        return self._db

    def get_config(self) -> ProjectConfig | None:
        """获取当前工程的配置"""
        return self._config

    def get_lg_path(self) -> str | None:
        """获取当前工程的 .lg 文件路径"""
        return self._lg_path

    def get_project_name(self) -> str:
        """获取当前工程名称"""
        if self._db is None:
            return ""
        return self._db.get_meta("name", "")

    # ========== 工程信息 ==========

    def get_project_info(self) -> dict[str, Any]:
        """获取当前工程的概要信息"""
        if self._db is None:
            return {}

        return self._db.get_project_summary()

    # ========== 翻译状态管理 ==========

    def get_project_status(self) -> Base.ProjectStatus:
        """获取当前工程的翻译状态"""
        if self._db is None:
            return Base.ProjectStatus.NONE
        return self._db.get_meta("project_status", Base.ProjectStatus.NONE)

    def set_project_status(self, status: Base.ProjectStatus) -> None:
        """设置当前工程的翻译状态"""
        if self._db is not None:
            self._db.set_meta("project_status", status)

    def get_translation_extras(self) -> dict[str, Any]:
        """获取翻译进度额外数据（用于断点续译）"""
        if self._db is None:
            return {}
        return self._db.get_meta("translation_extras", {})

    def set_translation_extras(self, extras: dict[str, Any]) -> None:
        """设置翻译进度额外数据"""
        if self._db is not None:
            self._db.set_meta("translation_extras", extras)

    # ========== 保存 ==========

    def save(self) -> None:
        """保存当前工程配置"""
        if self._db is not None and self._config is not None:
            self._config.save_to_db(self._db)
