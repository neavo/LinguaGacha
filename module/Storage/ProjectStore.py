import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from base.Base import Base
from model.Project import Project


class ProjectStore(Base):
    """项目元数据存储层 - 管理单例项目状态"""

    # 类级别线程锁
    _LOCK = threading.Lock()

    # 存储实例缓存（按数据库路径）
    _instances: dict[str, "ProjectStore"] = {}

    # 项目数据固定使用 id=1
    _PROJECT_ID = 1

    def __init__(self, db_path: str) -> None:
        super().__init__()
        self.db_path = db_path
        self._local = threading.local()
        self._ensure_table()

    @classmethod
    def get(cls, output_folder: str) -> "ProjectStore":
        """获取或创建指定输出目录的存储实例"""
        db_path = str(Path(output_folder) / "cache" / "cache.db")

        with cls._LOCK:
            if db_path not in cls._instances:
                # 确保目录存在
                Path(db_path).parent.mkdir(parents=True, exist_ok=True)
                cls._instances[db_path] = cls(db_path)

        return cls._instances[db_path]

    @classmethod
    def close_all(cls) -> None:
        """关闭所有存储实例"""
        with cls._LOCK:
            cls._instances.clear()

    def _get_connection(self) -> sqlite3.Connection:
        """获取当前线程的数据库连接（线程本地存储）"""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            # 确保目录存在（处理跨线程调用的情况）
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn

        return self._local.conn

    def _ensure_table(self) -> None:
        """确保数据表存在"""
        conn = self._get_connection()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            )
        """)
        conn.commit()

    def get_project(self) -> Project:
        """获取项目数据，不存在则返回空项目"""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT data FROM project WHERE id = ?", (self._PROJECT_ID,)
        )
        row = cursor.fetchone()

        if row is None:
            return Project()

        data: dict[str, Any] = json.loads(row["data"])
        return Project.from_dict(data)

    def set_project(self, project: Project) -> None:
        """保存项目数据（覆盖写入）"""
        conn = self._get_connection()
        data_json = json.dumps(project.to_dict(), ensure_ascii=False)

        # 使用 REPLACE 实现 upsert
        conn.execute(
            "INSERT OR REPLACE INTO project (id, data) VALUES (?, ?)",
            (self._PROJECT_ID, data_json),
        )
        conn.commit()

    def clear(self) -> None:
        """清空项目数据"""
        conn = self._get_connection()
        conn.execute("DELETE FROM project")
        conn.commit()
