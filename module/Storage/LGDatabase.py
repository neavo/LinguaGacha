"""统一的 .lg 文件访问类

.lg 文件是一个 SQLite 数据库，包含以下表：
- meta: 工程元数据（名称、语言、创建时间等）
- assets: 原始资产 BLOB（Zstd 压缩）
- items: 翻译条目
- rules: 质量规则（术语表、替换规则）
"""

import contextlib
import json
import sqlite3
import threading
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import Generator

from base.Base import Base


class LGDatabase(Base):
    """统一的 .lg 文件访问类"""

    class RuleType(StrEnum):
        """规则类型枚举"""

        GLOSSARY = "GLOSSARY"  # 术语表
        PRE_REPLACEMENT = "PRE_REPLACEMENT"  # 翻译前替换
        POST_REPLACEMENT = "POST_REPLACEMENT"  # 翻译后替换
        TEXT_PRESERVE = "TEXT_PRESERVE"  # 文本保护
        CUSTOM_PROMPT_ZH = "CUSTOM_PROMPT_ZH"  # 自定义提示词（中文）
        CUSTOM_PROMPT_EN = "CUSTOM_PROMPT_EN"  # 自定义提示词（英文）

    # 数据库版本号，用于未来的 schema 迁移
    SCHEMA_VERSION = 1

    def __init__(self, db_path: str) -> None:
        super().__init__()
        self.db_path = db_path
        self._lock = threading.Lock()
        self._keep_alive_conn: sqlite3.Connection | None = None

    def open(self) -> None:
        """打开数据库连接（长连接，维持 WAL 模式）"""
        if self._keep_alive_conn is None:
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            self._keep_alive_conn = sqlite3.connect(
                self.db_path, check_same_thread=False
            )
            self._keep_alive_conn.execute("PRAGMA journal_mode=WAL")
            self._keep_alive_conn.execute("PRAGMA synchronous=NORMAL")
            self._ensure_schema()

    def close(self) -> None:
        """关闭数据库连接"""
        if self._keep_alive_conn is not None:
            self._keep_alive_conn.close()
            self._keep_alive_conn = None

    def is_open(self) -> bool:
        """检查数据库是否已打开"""
        return self._keep_alive_conn is not None

    @contextlib.contextmanager
    def _connection(self) -> Generator[sqlite3.Connection, None, None]:
        """获取数据库连接上下文管理器"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            self._ensure_schema(conn)
            yield conn
        finally:
            conn.close()

    def _ensure_schema(self, conn: sqlite3.Connection | None = None) -> None:
        """确保数据库表结构存在"""
        target_conn = conn or self._keep_alive_conn
        if target_conn is None:
            return

        # 元数据表
        target_conn.execute("""
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # 资产表（原始文件 BLOB，Zstd 压缩）
        target_conn.execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                data BLOB NOT NULL,
                original_size INTEGER NOT NULL,
                compressed_size INTEGER NOT NULL
            )
        """)

        # 翻译条目表
        target_conn.execute("""
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL
            )
        """)

        # 规则表
        target_conn.execute("""
            CREATE TABLE IF NOT EXISTS rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """)

        # 创建索引以加速查询
        target_conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path)"
        )
        target_conn.execute("CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type)")

        target_conn.commit()

    # ========== 元数据操作 ==========

    def get_meta(self, key: str, default: Any = None) -> Any:
        """获取元数据"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row is None:
                return default
            return json.loads(row["value"])

    def set_meta(self, key: str, value: Any) -> None:
        """设置元数据"""
        with self._connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )
            conn.commit()

    def get_all_meta(self) -> dict[str, Any]:
        """获取所有元数据"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT key, value FROM meta")
            return {row["key"]: json.loads(row["value"]) for row in cursor.fetchall()}

    # ========== 资产操作 ==========

    def add_asset(self, path: str, data: bytes, original_size: int) -> int:
        """添加资产（已压缩的数据）"""
        with self._connection() as conn:
            cursor = conn.execute(
                "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
                (path, data, original_size, len(data)),
            )
            conn.commit()
            return cursor.lastrowid

    def get_asset(self, path: str) -> bytes | None:
        """获取资产数据"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT data FROM assets WHERE path = ?", (path,))
            row = cursor.fetchone()
            if row is None:
                return None
            return row["data"]

    def get_all_asset_paths(self) -> list[str]:
        """获取所有资产路径"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT path FROM assets ORDER BY path")
            return [row["path"] for row in cursor.fetchall()]

    def get_asset_count(self) -> int:
        """获取资产数量"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM assets")
            return cursor.fetchone()[0]

    # ========== 翻译条目操作 ==========

    def get_item(self, item_id: int) -> dict[str, Any] | None:
        """获取单个翻译条目"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT id, data FROM items WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if row is None:
                return None
            data = json.loads(row["data"])
            data["id"] = row["id"]
            return data

    def get_all_items(self) -> list[dict[str, Any]]:
        """获取所有翻译条目"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT id, data FROM items ORDER BY id")
            result = []
            for row in cursor.fetchall():
                data = json.loads(row["data"])
                data["id"] = row["id"]
                result.append(data)
            return result

    def set_item(self, item: dict[str, Any]) -> int:
        """保存单个翻译条目"""
        with self._connection() as conn:
            item_id = item.get("id")
            data = {k: v for k, v in item.items() if k != "id"}
            data_json = json.dumps(data, ensure_ascii=False)

            if item_id is None:
                cursor = conn.execute(
                    "INSERT INTO items (data) VALUES (?)", (data_json,)
                )
                item_id = cursor.lastrowid
            else:
                conn.execute(
                    "UPDATE items SET data = ? WHERE id = ?", (data_json, item_id)
                )

            conn.commit()
            return item_id

    def set_items(self, items: list[dict[str, Any]]) -> list[int]:
        """批量保存翻译条目（清空后重新写入）"""
        with self._connection() as conn:
            conn.execute("DELETE FROM items")
            ids = []
            for item in items:
                data = {k: v for k, v in item.items() if k != "id"}
                data_json = json.dumps(data, ensure_ascii=False)
                cursor = conn.execute(
                    "INSERT INTO items (data) VALUES (?)", (data_json,)
                )
                ids.append(cursor.lastrowid)
            conn.commit()
            return ids

    def get_item_count(self) -> int:
        """获取翻译条目数量"""
        with self._connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM items")
            return cursor.fetchone()[0]

    def clear_items(self) -> None:
        """清空所有翻译条目"""
        with self._connection() as conn:
            conn.execute("DELETE FROM items")
            conn.commit()

    # ========== 规则操作 ==========

    def get_rules(self, rule_type: RuleType) -> list[dict[str, str]]:
        """获取指定类型的规则"""
        with self._connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? ORDER BY id", (rule_type,)
            )
            return [json.loads(row["data"]) for row in cursor.fetchall()]

    def set_rules(self, rule_type: RuleType, rules: list[dict[str, str]]) -> None:
        """设置指定类型的规则（清空后重新写入）"""
        with self._connection() as conn:
            conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
            for rule in rules:
                conn.execute(
                    "INSERT INTO rules (type, data) VALUES (?, ?)",
                    (rule_type, json.dumps(rule, ensure_ascii=False)),
                )
            conn.commit()

    def get_rule_text(self, rule_type: RuleType) -> str:
        """获取文本类型的规则（如自定义提示词）"""
        with self._connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? LIMIT 1", (rule_type,)
            )
            row = cursor.fetchone()
            if row is None:
                return ""
            return json.loads(row["data"]).get("text", "")

    def set_rule_text(self, rule_type: RuleType, text: str) -> None:
        """设置文本类型的规则（如自定义提示词）"""
        with self._connection() as conn:
            conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
            conn.execute(
                "INSERT INTO rules (type, data) VALUES (?, ?)",
                (rule_type, json.dumps({"text": text}, ensure_ascii=False)),
            )
            conn.commit()

    # ========== 工厂方法 ==========

    @classmethod
    def create(
        cls,
        db_path: str,
        name: str,
    ) -> "LGDatabase":
        """创建新的 .lg 数据库"""
        db = cls(db_path)
        db.open()

        # 设置初始元数据
        db.set_meta("schema_version", cls.SCHEMA_VERSION)
        db.set_meta("name", name)
        db.set_meta("created_at", datetime.now().isoformat())
        db.set_meta("updated_at", datetime.now().isoformat())

        return db

    @classmethod
    def load(cls, db_path: str) -> "LGDatabase":
        """加载已有的 .lg 数据库"""
        if not Path(db_path).exists():
            raise FileNotFoundError(f"工程文件不存在: {db_path}")

        db = cls(db_path)
        db.open()

        # 更新最后访问时间
        db.set_meta("updated_at", datetime.now().isoformat())

        return db
