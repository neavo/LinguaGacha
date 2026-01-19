import os
import threading
from datetime import datetime

from base.Base import Base
from module.Storage.DataStore import DataStore


class SessionContext(Base):
    """会话级上下文，管理当前工程实例"""

    _instance: "SessionContext | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        super().__init__()
        self._db: DataStore | None = None
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

        只记录工程路径并创建 DataStore 实例，不建立长连接。
        长连接由 Translator 在翻译期间按需管理。

        Args:
            lg_path: .lg 文件的绝对路径
        """
        # 先卸载当前工程
        if self.is_loaded():
            self.unload()

        # 检查文件是否存在
        if not os.path.exists(lg_path):
            raise FileNotFoundError(f"工程文件不存在: {lg_path}")

        # 加载新工程（只创建实例，不打开长连接）
        self._lg_path = lg_path
        self._db = DataStore(lg_path)

        # 更新最后访问时间（使用短连接）
        self._db.set_meta("updated_at", datetime.now().isoformat())

        # 发送工程加载事件
        self.emit(Base.Event.PROJECT_LOADED, {"path": lg_path})

    def unload(self) -> None:
        """卸载当前工程"""
        if self._db is not None:
            # 确保关闭任何可能存在的长连接
            self._db.close()

        # 清空状态
        old_path = self._lg_path
        self._db = None
        self._lg_path = None

        # 发送工程卸载事件
        if old_path:
            self.emit(Base.Event.PROJECT_UNLOADED, {"path": old_path})

    def is_loaded(self) -> bool:
        """检查是否已加载工程"""
        return self._db is not None and self._lg_path is not None

    # ========== 访问器 ==========

    def get_db(self) -> DataStore | None:
        """获取当前工程的数据库访问对象"""
        return self._db

    def get_lg_path(self) -> str | None:
        """获取当前工程的 .lg 文件路径"""
        return self._lg_path

    def get_project_status(self) -> "Base.ProjectStatus":
        """获取当前工程的项目状态"""
        if self._db is None:
            return Base.ProjectStatus.NONE
        status_str = self._db.get_meta("project_status", Base.ProjectStatus.NONE)
        return Base.ProjectStatus(status_str)

    def set_project_status(self, status: "Base.ProjectStatus") -> None:
        """设置当前工程的项目状态"""
        if self._db is not None:
            self._db.set_meta("project_status", status.value)

    def get_translation_extras(self) -> dict:
        """获取翻译进度额外数据"""
        if self._db is None:
            return {}
        extras = self._db.get_meta("translation_extras", {})
        return extras if isinstance(extras, dict) else {}

    def set_translation_extras(self, extras: dict) -> None:
        """设置翻译进度额外数据"""
        if self._db is not None:
            self._db.set_meta("translation_extras", extras)
