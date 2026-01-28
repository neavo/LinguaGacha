import contextlib
import json
import sqlite3
import threading
import time
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import Generator

from base.Base import Base


class DataStore(Base):
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
    YIELD_EVERY = 512

    def __init__(self, db_path: str) -> None:
        super().__init__()
        self.db_path = db_path
        self.lock = threading.RLock()
        self.keep_alive_conn: sqlite3.Connection | None = None

    def open(self) -> None:
        """打开数据库连接（长连接，维持 WAL 模式）"""
        if self.keep_alive_conn is None:
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            self.keep_alive_conn = sqlite3.connect(
                self.db_path, check_same_thread=False
            )
            self.keep_alive_conn.execute("PRAGMA journal_mode=WAL")
            self.keep_alive_conn.execute("PRAGMA synchronous=NORMAL")
            self.keep_alive_conn.row_factory = sqlite3.Row
            self.ensure_schema()

    def close(self) -> None:
        """关闭数据库连接"""
        if self.keep_alive_conn is not None:
            self.keep_alive_conn.close()
            self.keep_alive_conn = None

    def is_open(self) -> bool:
        """检查数据库是否已打开"""
        return self.keep_alive_conn is not None

    @contextlib.contextmanager
    def connection(self) -> Generator[sqlite3.Connection, None, None]:
        """获取数据库连接上下文管理器

        如果长连接已打开，则复用长连接（不会关闭）；
        否则创建临时短连接（用完即关闭，触发 WAL checkpoint）。
        """
        # 长连接模式：复用已打开的连接，加锁保证多线程安全
        if self.keep_alive_conn is not None:
            with self.lock:
                yield self.keep_alive_conn
            return

        # 短连接模式：创建临时连接，操作完成后关闭
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            self.ensure_schema(conn)
            yield conn
        finally:
            conn.close()

    def ensure_schema(self, conn: sqlite3.Connection | None = None) -> None:
        """确保数据库表结构存在"""
        target_conn = conn or self.keep_alive_conn
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
        with self.connection() as conn:
            cursor = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row is None:
                return default
            return json.loads(row["value"])

    def set_meta(self, key: str, value: Any) -> None:
        """设置元数据"""
        with self.connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                (key, json.dumps(value, ensure_ascii=False)),
            )
            conn.commit()

    def get_all_meta(self) -> dict[str, Any]:
        """获取所有元数据"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT key, value FROM meta")
            return {row["key"]: json.loads(row["value"]) for row in cursor.fetchall()}

    # ========== 资产操作 ==========

    def add_asset(self, path: str, data: bytes, original_size: int) -> int:
        """添加资产（已压缩的数据）"""
        with self.connection() as conn:
            cursor = conn.execute(
                "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
                (path, data, original_size, len(data)),
            )
            conn.commit()
            if cursor.lastrowid is None:
                raise ValueError("Failed to get lastrowid")
            return cursor.lastrowid

    def get_asset(self, path: str) -> bytes | None:
        """获取资产数据"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT data FROM assets WHERE path = ?", (path,))
            row = cursor.fetchone()
            if row is None:
                return None
            return row["data"]

    def get_all_asset_paths(self) -> list[str]:
        """获取所有资产路径"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT path FROM assets ORDER BY path")
            return [row["path"] for row in cursor.fetchall()]

    def get_asset_count(self) -> int:
        """获取资产数量"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM assets")
            return cursor.fetchone()[0]

    # ========== 翻译条目操作 ==========

    def get_all_items(self) -> list[dict[str, Any]]:
        """获取所有翻译条目"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT id, data FROM items ORDER BY id")
            result = []
            yield_every = self.YIELD_EVERY
            loaded_count = 0
            for row in cursor:
                data = json.loads(row["data"])
                data["id"] = row["id"]
                result.append(data)
                loaded_count += 1
                if yield_every > 0 and loaded_count % yield_every == 0:
                    # 释放 GIL，避免大项目读取条目时 UI 假死
                    time.sleep(0)
            return result

    def set_item(self, item: dict[str, Any]) -> int:
        """保存单个翻译条目"""
        with self.connection() as conn:
            item_id = item.get("id")
            data = {k: v for k, v in item.items() if k != "id"}
            data_json = json.dumps(data, ensure_ascii=False)

            if item_id is None:
                cursor = conn.execute(
                    "INSERT INTO items (data) VALUES (?)", (data_json,)
                )
                new_id = cursor.lastrowid
                if new_id is None:
                    raise ValueError("Failed to get lastrowid")
                item_id = new_id
            else:
                conn.execute(
                    "UPDATE items SET data = ? WHERE id = ?", (data_json, item_id)
                )

            conn.commit()
            return int(item_id)

    def set_items(self, items: list[dict[str, Any]]) -> list[int]:
        """批量保存翻译条目（清空后重新写入，并保留原始 ID）"""
        with self.connection() as conn:
            conn.execute("DELETE FROM items")
            ids = []
            yield_every = self.YIELD_EVERY
            saved_count = 0
            for item in items:
                item_id = item.get("id")
                data = {k: v for k, v in item.items() if k != "id"}
                data_json = json.dumps(data, ensure_ascii=False)

                if item_id is not None:
                    conn.execute(
                        "INSERT INTO items (id, data) VALUES (?, ?)",
                        (item_id, data_json),
                    )
                    ids.append(item_id)
                else:
                    cursor = conn.execute(
                        "INSERT INTO items (data) VALUES (?)", (data_json,)
                    )
                    ids.append(cursor.lastrowid)
                saved_count += 1
                if yield_every > 0 and saved_count % yield_every == 0:
                    # 释放 GIL，避免大批量写入时阻塞 UI
                    time.sleep(0)
            conn.commit()
            return ids

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        """综合批量更新（在单次事务中更新条目、规则及元数据）

        Args:
            items: 待更新的条目列表
            rules: 待更新的规则字典 { RuleType: data }
            meta: 待更新的元数据字典 { key: value }
        """
        if not items and not rules and not meta:
            return

        with self.connection() as conn:
            # 1. 更新条目
            if items:
                params = [
                    (
                        json.dumps(
                            {k: v for k, v in item.items() if k != "id"},
                            ensure_ascii=False,
                        ),
                        item["id"],
                    )
                    for item in items
                    if "id" in item
                ]
                if params:
                    conn.executemany("UPDATE items SET data = ? WHERE id = ?", params)

            # 2. 更新规则
            if rules:
                for rule_type, rule_data in rules.items():
                    conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
                    conn.execute(
                        "INSERT INTO rules (type, data) VALUES (?, ?)",
                        (rule_type, json.dumps(rule_data, ensure_ascii=False)),
                    )

            # 3. 更新元数据
            if meta:
                meta_params = [
                    (k, json.dumps(v, ensure_ascii=False)) for k, v in meta.items()
                ]
                conn.executemany(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                    meta_params,
                )

            conn.commit()

    # ========== 规则操作 ==========

    def get_rules(self, rule_type: RuleType) -> list[dict[str, Any]]:
        """获取指定类型的规则"""
        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? ORDER BY id", (rule_type,)
            )
            rows = cursor.fetchall()

            if not rows:
                return []

            # 检查第一行数据结构
            try:
                first_data = json.loads(rows[0]["data"])
            except Exception:
                return []

            # 如果是新格式（单行存储列表），直接返回
            if isinstance(first_data, list):
                return first_data

            # 如果是旧格式（多行存储字典），聚合返回
            result = []
            for row in rows:
                try:
                    data = json.loads(row["data"])
                    if isinstance(data, dict):
                        result.append(data)
                    elif isinstance(data, list):
                        # 兼容性处理：如果混合了列表行
                        result.extend(data)
                except Exception:
                    continue
            return result

    def set_rules(self, rule_type: RuleType, rules: list[dict[str, Any]]) -> None:
        """设置指定类型的规则（清空后重新写入，存储为单行 JSON）"""
        with self.connection() as conn:
            conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
            # 将整个列表序列化为单行 JSON 存储
            conn.execute(
                "INSERT INTO rules (type, data) VALUES (?, ?)",
                (rule_type, json.dumps(rules, ensure_ascii=False)),
            )
            conn.commit()

    def get_rule_text(self, rule_type: RuleType) -> str:
        """获取文本类型的规则（如自定义提示词）"""
        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? LIMIT 1", (rule_type,)
            )
            row = cursor.fetchone()
            if row is None:
                return ""
            return json.loads(row["data"]).get("text", "")

    def set_rule_text(self, rule_type: RuleType, text: str) -> None:
        """设置文本类型的规则（如自定义提示词）"""
        with self.connection() as conn:
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
    ) -> "DataStore":
        """创建新的 .lg 数据库

        使用短连接初始化数据库结构和元数据，不保持长连接。
        """
        db = cls(db_path)

        # 使用短连接设置初始元数据（操作完成后自动关闭，WAL 文件消失）
        db.set_meta("schema_version", cls.SCHEMA_VERSION)
        db.set_meta("name", name)
        db.set_meta("created_at", datetime.now().isoformat())
        db.set_meta("updated_at", datetime.now().isoformat())

        return db

    # ========== 业务辅助 ==========

    def get_project_summary(self) -> dict[str, Any]:
        """获取项目概览信息（进度、文件数等）"""
        with self.connection() as conn:
            # 读取基础信息
            meta_cursor = conn.execute("SELECT key, value FROM meta")
            meta = {
                row["key"]: json.loads(row["value"]) for row in meta_cursor.fetchall()
            }

            file_count = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]

            # 计算进度
            # 优先使用翻译进度信息（更准确，排除已筛选的条目）
            extras = meta.get("translation_extras", {})
            if isinstance(extras, dict) and "line" in extras and "total_line" in extras:
                translated_items = extras["line"]
                total_items = extras["total_line"]

                # 临时处理：如果项目从未运行过翻译（total_line 为 0）
                # 回退使用物理总行数，确保工作台列表能显示工程规模
                if total_items == 0:
                    total_items = (
                        conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] or 0
                    )
            else:
                # 兼容旧版本：未开始翻译的项目视为 0 进度
                total_items = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
                translated_items = 0

            if total_items == 0:
                progress = 0.0
            else:
                progress = min(1.0, translated_items / total_items)

            return {
                "name": meta.get("name", Path(self.db_path).stem),
                "source_language": meta.get("source_language", ""),
                "target_language": meta.get("target_language", ""),
                "created_at": meta.get("created_at", ""),
                "updated_at": meta.get("updated_at", ""),
                "file_count": file_count,
                "total_items": total_items,
                "translated_items": translated_items,
                "progress": progress,
            }
