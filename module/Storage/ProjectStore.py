import contextlib
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any
from typing import Generator

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
        self._keep_alive_conn: sqlite3.Connection | None = None

    def open_session(self) -> None:
        """开启会话（建立长连接以维持 WAL 模式，避免频繁 checkpoint）"""
        if self._keep_alive_conn is None:
            # 确保持久化连接使用相同的参数
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            self._keep_alive_conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._keep_alive_conn.execute("PRAGMA journal_mode=WAL")
            self._keep_alive_conn.execute("PRAGMA synchronous=NORMAL")

    def close_session(self) -> None:
        """关闭会话（释放长连接，允许 SQLite 执行 checkpoint 并删除 WAL 文件）"""
        if self._keep_alive_conn is not None:
            self._keep_alive_conn.close()
            self._keep_alive_conn = None

    @classmethod
    def get(cls, output_folder: str) -> "ProjectStore":
        """获取或创建指定输出目录的存储实例"""
        db_path = str(Path(output_folder) / "cache" / "project.db")

        with cls._LOCK:
            if db_path not in cls._instances:
                # 确保目录存在
                Path(db_path).parent.mkdir(parents=True, exist_ok=True)
                cls._instances[db_path] = cls(db_path)

        return cls._instances[db_path]

    @contextlib.contextmanager
    def _connection(self) -> Generator[sqlite3.Connection, None, None]:
        """获取数据库连接上下文管理器（随用随连）"""
        # 确保目录存在
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row

            # 2. 确保表结构存在：每次新建连接时检查
            self._ensure_table(conn)

            yield conn
        finally:
            conn.close()

    def _ensure_table(self, conn: sqlite3.Connection) -> None:
        """确保数据表存在"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            )
        """)
        conn.commit()

    def get_project(self) -> Project:
        """获取项目数据，不存在则返回空项目"""
        with self._connection() as conn:
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
        with self._connection() as conn:
            data_json = json.dumps(project.to_dict(), ensure_ascii=False)

            # 使用 REPLACE 实现 upsert
            conn.execute(
                "INSERT OR REPLACE INTO project (id, data) VALUES (?, ?)",
                (self._PROJECT_ID, data_json),
            )
            conn.commit()

    def clear(self) -> None:
        """清空项目数据"""
        with self._connection() as conn:
            conn.execute("DELETE FROM project")
            conn.commit()
