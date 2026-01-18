import contextlib
import json
import sqlite3
import threading
from pathlib import Path
from typing import Any
from typing import Generator

from base.Base import Base
from model.Item import Item

class ItemStore(Base):
    """翻译条目存储层 - 管理大量翻译条目的 CRUD 操作"""

    # 类级别线程锁
    _LOCK = threading.Lock()

    # 存储实例缓存（按数据库路径）
    _instances: dict[str, "ItemStore"] = {}

    def __init__(self, db_path: str) -> None:
        super().__init__()
        self.db_path = db_path
        self._keep_alive_conn: sqlite3.Connection | None = None

        # 内存缓存（避免频繁查询数据库）
        self._items_cache: list[Item] | None = None

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
    def get(cls, output_folder: str) -> "ItemStore":
        """获取或创建指定输出目录的存储实例"""
        db_path = str(Path(output_folder) / "cache" / "item.db")

        with cls._LOCK:
            if db_path not in cls._instances:
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

            # 确保表结构存在
            self._ensure_table(conn)

            yield conn
        finally:
            conn.close()

    def _ensure_table(self, conn: sqlite3.Connection) -> None:
        """确保数据表存在"""
        conn.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL
            )
        """)
        conn.commit()

    def _invalidate_cache(self) -> None:
        """使缓存失效"""
        self._items_cache = None

    # ========== 读取操作 ==========

    def get_item(self, item_id: int) -> Item | None:
        """根据 ID 获取单个条目"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()

            if row is None:
                return None

            return self._row_to_item(row)

    def get_all_items(self) -> list[Item]:
        """获取所有条目（带缓存）"""
        if self._items_cache is not None:
            return self._items_cache

        with self._connection() as conn:
            cursor = conn.execute("SELECT id, data FROM items ORDER BY id")
            self._items_cache = [self._row_to_item(row) for row in cursor.fetchall()]
            return self._items_cache

    def get_item_count(self) -> int:
        """获取条目总数"""
        return len(self.get_all_items())

    def get_item_count_by_status(self, status: Base.ProjectStatus) -> int:
        """按状态统计条目数量"""
        return len(
            [item for item in self.get_all_items() if item.get_status() == status]
        )

    def copy_items(self) -> list[Item]:
        """深拷贝条目列表"""
        return [Item.from_dict(item.to_dict()) for item in self.get_all_items()]

    # ========== 写入操作 ==========

    def set_item(self, item: Item) -> Item:
        """保存单个条目（新增或更新）"""
        with self._connection() as conn:
            data_json = self._item_to_json(item)

            if item.get_id() is None:
                cursor = conn.execute("INSERT INTO items (data) VALUES (?)", (data_json,))
                item.set_id(cursor.lastrowid)
            else:
                conn.execute(
                    "UPDATE items SET data = ? WHERE id = ?", (data_json, item.get_id())
                )

            conn.commit()

        self._invalidate_cache()
        return item

    def set_items(self, items: list[Item]) -> list[Item]:
        """批量保存条目（清空后重新写入）"""
        with self._connection() as conn:
            conn.execute("DELETE FROM items")

            for item in items:
                data_json = self._item_to_json(item)
                cursor = conn.execute("INSERT INTO items (data) VALUES (?)", (data_json,))
                item.set_id(cursor.lastrowid)

            conn.commit()

        # 直接更新缓存，避免再次查询
        self._items_cache = items
        return items

    def delete_item(self, item_id: int) -> bool:
        """删除指定条目"""
        with self._connection() as conn:
            cursor = conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
            conn.commit()

        self._invalidate_cache()
        return cursor.rowcount > 0

    def clear(self) -> None:
        """清空所有条目"""
        with self._connection() as conn:
            conn.execute("DELETE FROM items")
            conn.commit()
        self._items_cache = []

    # ========== 序列化 ==========

    def _item_to_json(self, item: Item) -> str:
        """将 Item 序列化为 JSON 字符串（不含 id）"""
        data = item.to_dict()
        data.pop("id", None)
        return json.dumps(data, ensure_ascii=False)

    def _row_to_item(self, row: sqlite3.Row) -> Item:
        """将数据库行转换为 Item 对象"""
        data: dict[str, Any] = json.loads(row["data"])
        data["id"] = row["id"]
        return Item.from_dict(data)
