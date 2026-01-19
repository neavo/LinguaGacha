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

        total_items = self._db.get_item_count()
        translated_items = 0

        # 统计已翻译条目
        for item in self._db.get_all_items():
            if item.get("status") == Base.ProjectStatus.DONE:
                translated_items += 1

        progress = translated_items / max(1, total_items)

        return {
            "name": self._db.get_meta("name", ""),
            "source_language": self._db.get_meta("source_language", ""),
            "target_language": self._db.get_meta("target_language", ""),
            "created_at": self._db.get_meta("created_at", ""),
            "updated_at": self._db.get_meta("updated_at", ""),
            "total_items": total_items,
            "translated_items": translated_items,
            "progress": progress,
        }

    # ========== 保存 ==========

    def save(self) -> None:
        """保存当前工程配置"""
        if self._db is not None and self._config is not None:
            self._config.save_to_db(self._db)
