import contextlib
import sqlite3
import threading
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any
from typing import ClassVar
from typing import Generator

from base.Base import Base
from base.LogManager import LogManager
from module.Utils.JSONTool import JSONTool


class LGDatabase(Base):
    """统一的 .lg 文件访问类（SQLite）。"""

    LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE: ClassVar[str] = "CUSTOM_PROMPT_ZH"
    LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE: ClassVar[str] = "CUSTOM_PROMPT_EN"

    class RuleType(StrEnum):
        """规则类型枚举"""

        GLOSSARY = "GLOSSARY"  # 术语表
        PRE_REPLACEMENT = "PRE_REPLACEMENT"  # 翻译前替换
        POST_REPLACEMENT = "POST_REPLACEMENT"  # 翻译后替换
        TEXT_PRESERVE = "TEXT_PRESERVE"  # 文本保护
        TRANSLATION_PROMPT = "TRANSLATION_PROMPT"  # 翻译提示词
        ANALYSIS_PROMPT = "ANALYSIS_PROMPT"  # 分析提示词

    # 数据库版本号，用于未来的 schema 迁移
    SCHEMA_VERSION = 2

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
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """
        )

        # 资产表（原始文件 BLOB，Zstd 压缩）
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                data BLOB NOT NULL,
                original_size INTEGER NOT NULL,
                compressed_size INTEGER NOT NULL
            )
        """
        )

        # 翻译条目表
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL
            )
        """
        )

        # 规则表
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                data TEXT NOT NULL
            )
        """
        )

        # 分析检查点表：以 item_id 为主键，记录当前最新状态和失败次数。
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS analysis_item_checkpoint (
                item_id INTEGER PRIMARY KEY,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error_count INTEGER NOT NULL
            )
        """
        )

        # 候选池汇总表：项目级长期资产，按 src 聚合投票信息。
        target_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS analysis_candidate_aggregate (
                src TEXT PRIMARY KEY,
                dst_votes TEXT NOT NULL,
                info_votes TEXT NOT NULL,
                observation_count INTEGER NOT NULL,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                case_sensitive INTEGER NOT NULL
            )
        """
        )

        # 创建索引以加速查询
        target_conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_assets_path ON assets(path)"
        )
        self.ensure_asset_sort_order_schema(target_conn)
        target_conn.execute("CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type)")
        target_conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_analysis_item_checkpoint_status ON analysis_item_checkpoint(status)"
        )
        target_conn.commit()

    def ensure_asset_sort_order_schema(self, conn: sqlite3.Connection) -> None:
        """确保 assets.sort_order 存在，并把旧工程按原 id 顺序回填。"""

        cursor = conn.execute("PRAGMA table_info(assets)")
        columns = [str(row["name"]) for row in cursor.fetchall()]
        if "sort_order" in columns:
            return

        conn.execute(
            "ALTER TABLE assets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
        )

        asset_rows = conn.execute("SELECT id FROM assets ORDER BY id").fetchall()
        for sort_order, row in enumerate(asset_rows):
            conn.execute(
                "UPDATE assets SET sort_order = ? WHERE id = ?",
                (sort_order, int(row["id"])),
            )

    def get_next_asset_sort_order(
        self,
        conn: sqlite3.Connection,
    ) -> int:
        """为新导入文件分配稳定尾部顺序，避免默认值把它插到顶部。"""

        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM assets"
        )
        if not hasattr(row, "fetchone"):
            return 0

        row = row.fetchone()
        if row is None:
            return 0
        return int(row["next_sort_order"])

    # ========== 元数据操作 ==========

    def get_meta(self, key: str, default: Any = None) -> Any:
        """获取元数据"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT value FROM meta WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row is None:
                return default
            return JSONTool.loads(row["value"])

    def set_meta(self, key: str, value: Any) -> None:
        """设置元数据"""
        with self.connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                (key, JSONTool.dumps(value)),
            )
            conn.commit()

    def upsert_meta_entries(
        self,
        meta: dict[str, Any],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """批量写入元数据，并允许调用方复用现有事务。"""
        if not meta:
            return

        params = [(str(key), JSONTool.dumps(value)) for key, value in meta.items()]

        if conn is not None:
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                params,
            )
            return

        with self.connection() as local_conn:
            self.upsert_meta_entries(meta, conn=local_conn)
            local_conn.commit()

    def prepare_meta_upsert_params(
        self, meta: dict[str, Any] | None
    ) -> list[tuple[str, str]]:
        """把 meta 预序列化成 SQL 参数，供锁外准备阶段复用。"""
        if not meta:
            return []
        return [(str(key), JSONTool.dumps(value)) for key, value in meta.items()]

    def upsert_meta_entries_prepared(
        self,
        params: list[tuple[str, str]],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """接受预序列化 meta 参数，避免热点路径在事务锁内做 JSON dumps。"""
        if not params:
            return

        if conn is not None:
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
                params,
            )
            return

        with self.connection() as local_conn:
            self.upsert_meta_entries_prepared(params, conn=local_conn)
            local_conn.commit()

    def get_all_meta(self) -> dict[str, Any]:
        """获取所有元数据"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT key, value FROM meta")
            return {
                row["key"]: JSONTool.loads(row["value"]) for row in cursor.fetchall()
            }

    # ========== 分析状态操作 ==========

    def get_analysis_item_checkpoints(
        self, conn: sqlite3.Connection | None = None
    ) -> list[dict[str, Any]]:
        """读取所有分析检查点。"""
        target_conn = conn
        if target_conn is not None:
            cursor = target_conn.execute(
                """
                SELECT item_id, status, updated_at, error_count
                FROM analysis_item_checkpoint
                ORDER BY item_id
                """
            )
            return [dict(row) for row in cursor.fetchall()]

        with self.connection() as local_conn:
            return self.get_analysis_item_checkpoints(conn=local_conn)

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """批量写入分析检查点。"""
        if not checkpoints:
            return

        params = [
            (
                int(checkpoint["item_id"]),
                str(checkpoint["status"]),
                str(checkpoint["updated_at"]),
                int(checkpoint["error_count"]),
            )
            for checkpoint in checkpoints
        ]

        if conn is not None:
            conn.executemany(
                """
                INSERT INTO analysis_item_checkpoint (
                    item_id, status, updated_at, error_count
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    error_count = excluded.error_count
                """,
                params,
            )
            return

        with self.connection() as local_conn:
            self.upsert_analysis_item_checkpoints(checkpoints, conn=local_conn)
            local_conn.commit()

    def delete_analysis_item_checkpoints(
        self,
        *,
        status: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        """删除分析检查点；可按状态过滤。"""
        if conn is not None:
            if status is None:
                cursor = conn.execute("DELETE FROM analysis_item_checkpoint")
            else:
                cursor = conn.execute(
                    "DELETE FROM analysis_item_checkpoint WHERE status = ?",
                    (status,),
                )
            return int(cursor.rowcount)

        with self.connection() as local_conn:
            deleted = self.delete_analysis_item_checkpoints(
                status=status,
                conn=local_conn,
            )
            local_conn.commit()
            return deleted

    def normalize_analysis_candidate_aggregate_db_rows(
        self, rows: list[sqlite3.Row]
    ) -> list[dict[str, Any]]:
        """把候选池查询结果统一反序列化，避免多个读取入口各自维护 JSON 解码。"""
        result: list[dict[str, Any]] = []
        for row in rows:
            result.append(
                {
                    "src": str(row["src"]),
                    "dst_votes": JSONTool.loads(row["dst_votes"]),
                    "info_votes": JSONTool.loads(row["info_votes"]),
                    "observation_count": int(row["observation_count"]),
                    "first_seen_at": str(row["first_seen_at"]),
                    "last_seen_at": str(row["last_seen_at"]),
                    "case_sensitive": bool(row["case_sensitive"]),
                }
            )
        return result

    def get_analysis_candidate_aggregates(
        self, conn: sqlite3.Connection | None = None
    ) -> list[dict[str, Any]]:
        """读取项目级候选池汇总。"""
        if conn is not None:
            cursor = conn.execute(
                """
                SELECT
                    src,
                    dst_votes,
                    info_votes,
                    observation_count,
                    first_seen_at,
                    last_seen_at,
                    case_sensitive
                FROM analysis_candidate_aggregate
                ORDER BY src
                """
            )
            return self.normalize_analysis_candidate_aggregate_db_rows(
                cursor.fetchall()
            )

        with self.connection() as local_conn:
            return self.get_analysis_candidate_aggregates(conn=local_conn)

    def get_analysis_candidate_aggregates_by_srcs(
        self,
        srcs: list[str],
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        """按 src 批量读取候选池汇总，避免热路径每次全量扫描。"""
        normalized_srcs = [str(src).strip() for src in srcs if str(src).strip() != ""]
        if not normalized_srcs:
            return []

        placeholders = ",".join("?" for _ in normalized_srcs)
        sql = f"""
            SELECT
                src,
                dst_votes,
                info_votes,
                observation_count,
                first_seen_at,
                last_seen_at,
                case_sensitive
            FROM analysis_candidate_aggregate
            WHERE src IN ({placeholders})
            ORDER BY src
        """

        if conn is not None:
            cursor = conn.execute(sql, normalized_srcs)
            return self.normalize_analysis_candidate_aggregate_db_rows(
                cursor.fetchall()
            )

        with self.connection() as local_conn:
            return self.get_analysis_candidate_aggregates_by_srcs(
                normalized_srcs,
                conn=local_conn,
            )

    def upsert_analysis_candidate_aggregates(
        self,
        aggregates: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """批量写入项目级候选池汇总。"""
        if not aggregates:
            return

        params = self.prepare_analysis_candidate_aggregate_upsert_params(aggregates)

        if conn is not None:
            self.upsert_analysis_candidate_aggregates_prepared(params, conn=conn)
            return

        with self.connection() as local_conn:
            self.upsert_analysis_candidate_aggregates_prepared(params, conn=local_conn)
            local_conn.commit()

    def prepare_analysis_candidate_aggregate_upsert_params(
        self,
        aggregates: list[dict[str, Any]] | None,
    ) -> list[tuple[str, str, str, int, str, str, int]]:
        """把候选池聚合预序列化成 SQL 参数，减少事务内 JSON 开销。"""
        if not aggregates:
            return []

        return [
            (
                str(aggregate["src"]),
                JSONTool.dumps(aggregate["dst_votes"]),
                JSONTool.dumps(aggregate["info_votes"]),
                int(aggregate["observation_count"]),
                str(aggregate["first_seen_at"]),
                str(aggregate["last_seen_at"]),
                int(bool(aggregate["case_sensitive"])),
            )
            for aggregate in aggregates
        ]

    def upsert_analysis_candidate_aggregates_prepared(
        self,
        params: list[tuple[str, str, str, int, str, str, int]],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """接受预序列化候选池参数，缩短热点事务的锁持有时间。"""
        if not params:
            return

        if conn is not None:
            conn.executemany(
                """
                INSERT INTO analysis_candidate_aggregate (
                    src,
                    dst_votes,
                    info_votes,
                    observation_count,
                    first_seen_at,
                    last_seen_at,
                    case_sensitive
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(src) DO UPDATE SET
                    dst_votes = excluded.dst_votes,
                    info_votes = excluded.info_votes,
                    observation_count = excluded.observation_count,
                    first_seen_at = excluded.first_seen_at,
                    last_seen_at = excluded.last_seen_at,
                    case_sensitive = excluded.case_sensitive
                """,
                params,
            )
            return

        with self.connection() as local_conn:
            self.upsert_analysis_candidate_aggregates_prepared(
                params,
                conn=local_conn,
            )
            local_conn.commit()

    def clear_analysis_candidate_aggregates(
        self, conn: sqlite3.Connection | None = None
    ) -> None:
        """清空项目级候选池汇总。"""
        if conn is not None:
            conn.execute("DELETE FROM analysis_candidate_aggregate")
            return

        with self.connection() as local_conn:
            self.clear_analysis_candidate_aggregates(conn=local_conn)
            local_conn.commit()

    # ========== 资产操作 ==========

    def add_asset(
        self,
        path: str,
        data: bytes,
        original_size: int,
        *,
        sort_order: int | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        """添加资产（已压缩的数据）"""
        if conn is not None:
            effective_sort_order = (
                int(sort_order)
                if sort_order is not None
                else self.get_next_asset_sort_order(conn)
            )
            cursor = conn.execute(
                """
                INSERT INTO assets (
                    path, sort_order, data, original_size, compressed_size
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (path, effective_sort_order, data, original_size, len(data)),
            )
            if cursor.lastrowid is None:
                raise ValueError("Failed to get lastrowid")
            return int(cursor.lastrowid)

        with self.connection() as local_conn:
            asset_id = self.add_asset(
                path,
                data,
                original_size,
                sort_order=sort_order,
                conn=local_conn,
            )
            local_conn.commit()
            return asset_id

    def update_asset(
        self,
        path: str,
        data: bytes,
        original_size: int,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """更新资产数据（已压缩的数据）"""
        if conn is not None:
            conn.execute(
                "UPDATE assets SET data = ?, original_size = ?, compressed_size = ? WHERE path = ?",
                (data, original_size, len(data), path),
            )
            return

        with self.connection() as local_conn:
            local_conn.execute(
                "UPDATE assets SET data = ?, original_size = ?, compressed_size = ? WHERE path = ?",
                (data, original_size, len(data), path),
            )
            local_conn.commit()

    def update_asset_path(
        self,
        old_path: str,
        new_path: str,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        """更新 assets.path（文件名/相对路径）。

        返回：更新的行数。
        """

        if conn is not None:
            cursor = conn.execute(
                "UPDATE assets SET path = ? WHERE path = ?",
                (new_path, old_path),
            )
            return int(cursor.rowcount)

        with self.connection() as local_conn:
            cursor = local_conn.execute(
                "UPDATE assets SET path = ? WHERE path = ?",
                (new_path, old_path),
            )
            local_conn.commit()
            return int(cursor.rowcount)

    def get_asset(self, path: str) -> bytes | None:
        """获取资产数据"""
        with self.connection() as conn:
            cursor = conn.execute("SELECT data FROM assets WHERE path = ?", (path,))
            row = cursor.fetchone()
            if row is None:
                return None
            return row["data"]

    def delete_asset(self, path: str, conn: sqlite3.Connection | None = None) -> None:
        """删除指定路径的资产记录"""
        if conn is not None:
            conn.execute("DELETE FROM assets WHERE path = ?", (path,))
            return

        with self.connection() as local_conn:
            local_conn.execute("DELETE FROM assets WHERE path = ?", (path,))
            local_conn.commit()

    def asset_path_exists(self, path: str) -> bool:
        """检查资产路径是否已存在"""
        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT 1 FROM assets WHERE path = ? LIMIT 1",
                (path,),
            )
            return cursor.fetchone() is not None

    def get_all_asset_paths(self) -> list[str]:
        """获取所有资产路径"""
        with self.connection() as conn:
            # 先按显式排序字段读取；同序值时再退回 id，保证旧工程升级也稳定。
            cursor = conn.execute(
                "SELECT path FROM assets ORDER BY sort_order ASC, id ASC"
            )
            return [row["path"] for row in cursor.fetchall()]

    def get_all_asset_records(self) -> list[dict[str, Any]]:
        """获取所有资产的稳定顺序记录。"""

        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT path, sort_order FROM assets ORDER BY sort_order ASC, id ASC"
            )
            return [
                {
                    "path": row["path"],
                    "sort_order": int(row["sort_order"]),
                }
                for row in cursor.fetchall()
            ]

    def update_asset_sort_orders(
        self,
        ordered_paths: list[str],
        conn: sqlite3.Connection | None = None,
    ) -> None:
        """按调用方给定顺序批量更新 assets.sort_order。"""

        params = [(sort_order, path) for sort_order, path in enumerate(ordered_paths)]
        if conn is not None:
            conn.executemany(
                "UPDATE assets SET sort_order = ? WHERE path = ?",
                params,
            )
            return

        with self.connection() as local_conn:
            self.update_asset_sort_orders(ordered_paths, conn=local_conn)
            local_conn.commit()

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
            for row in cursor:
                data = JSONTool.loads(row["data"])
                data["id"] = row["id"]
                result.append(data)
            return result

    def get_items_by_file_path(self, file_path: str) -> list[dict[str, Any]]:
        """按 file_path（JSON 内字段）获取翻译条目"""
        with self.connection() as conn:
            try:
                cursor = conn.execute(
                    "SELECT id, data FROM items WHERE json_extract(data, '$.file_path') = ? ORDER BY id",
                    (file_path,),
                )
                result: list[dict[str, Any]] = []
                for row in cursor:
                    data = JSONTool.loads(row["data"])
                    data["id"] = row["id"]
                    result.append(data)
                return result
            except sqlite3.OperationalError as e:
                # 部分运行环境可能缺少 SQLite JSON1 扩展（json_extract 不可用）。
                if "json_extract" not in str(e):
                    raise

                cursor = conn.execute("SELECT id, data FROM items ORDER BY id")
                result = []
                for row in cursor:
                    data = JSONTool.loads(row["data"])
                    if data.get("file_path") != file_path:
                        continue
                    data["id"] = row["id"]
                    result.append(data)
                return result

    def delete_items_by_file_path(
        self, file_path: str, conn: sqlite3.Connection | None = None
    ) -> int:
        """按 file_path（JSON 内字段）删除翻译条目，返回删除行数"""

        def delete_with_json_extract(target_conn: sqlite3.Connection) -> int:
            cursor = target_conn.execute(
                "DELETE FROM items WHERE json_extract(data, '$.file_path') = ?",
                (file_path,),
            )
            return int(cursor.rowcount)

        def delete_with_fallback(target_conn: sqlite3.Connection) -> int:
            cursor = target_conn.execute("SELECT id, data FROM items")
            ids: list[int] = []
            for row in cursor:
                data = JSONTool.loads(row["data"])
                if data.get("file_path") == file_path:
                    ids.append(int(row["id"]))

            deleted = 0
            # 避免过长 IN 子句：分块删除。
            chunk_size = 500
            for i in range(0, len(ids), chunk_size):
                chunk = ids[i : i + chunk_size]
                placeholders = ",".join("?" for _ in chunk)
                cur = target_conn.execute(
                    f"DELETE FROM items WHERE id IN ({placeholders})",
                    tuple(chunk),
                )
                deleted += int(cur.rowcount)
            return deleted

        if conn is not None:
            try:
                return delete_with_json_extract(conn)
            except sqlite3.OperationalError as e:
                if "json_extract" not in str(e):
                    raise
                return delete_with_fallback(conn)

        with self.connection() as local_conn:
            try:
                cursor = local_conn.execute(
                    "DELETE FROM items WHERE json_extract(data, '$.file_path') = ?",
                    (file_path,),
                )
            except sqlite3.OperationalError as e:
                if "json_extract" not in str(e):
                    raise
                deleted = delete_with_fallback(local_conn)
                local_conn.commit()
                return deleted
            local_conn.commit()
            return int(cursor.rowcount)

    def set_item(self, item: dict[str, Any]) -> int:
        """保存单个翻译条目"""
        with self.connection() as conn:
            item_id = item.get("id")
            data = {k: v for k, v in item.items() if k != "id"}
            data_json = JSONTool.dumps(data)

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
                    "UPDATE items SET data = ? WHERE id = ?",
                    (data_json, item_id),
                )

            conn.commit()
            return int(item_id)

    def set_items(
        self,
        items: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> list[int]:
        """批量保存翻译条目（清空后重新写入，并保留原始 ID）"""
        if conn is not None:
            conn.execute("DELETE FROM items")
            ids = []
            for item in items:
                item_id = item.get("id")
                data = {k: v for k, v in item.items() if k != "id"}
                data_json = JSONTool.dumps(data)

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
            return ids

        with self.connection() as local_conn:
            ids = self.set_items(items, conn=local_conn)
            local_conn.commit()
            return ids

    def preview_replace_all_item_ids(
        self,
        items: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> list[int]:
        """预演 `set_items()` 将实际落库的 id 序列。"""

        if conn is None:
            with self.connection() as local_conn:
                return self.preview_replace_all_item_ids(items, conn=local_conn)

        sequence_row = conn.execute(
            "SELECT seq FROM sqlite_sequence WHERE name = 'items'"
        ).fetchone()
        sequence_value = (
            int(sequence_row["seq"] or 0) if sequence_row is not None else 0
        )
        max_row = conn.execute("SELECT MAX(id) AS max_id FROM items").fetchone()
        current_max_id = max(
            sequence_value,
            int(max_row["max_id"] or 0) if max_row is not None else 0,
        )

        preview_ids: list[int] = []
        for item in items:
            raw_item_id = item.get("id")
            item_id: int | None
            if raw_item_id is None or raw_item_id == "":
                item_id = None
            elif isinstance(raw_item_id, int):
                item_id = raw_item_id
            else:
                try:
                    item_id = int(raw_item_id)
                except TypeError:
                    item_id = None
                except ValueError:
                    item_id = None

            if item_id is None:
                current_max_id += 1
                preview_ids.append(current_max_id)
                continue

            current_max_id = max(current_max_id, item_id)
            preview_ids.append(item_id)

        return preview_ids

    def insert_items(
        self,
        items: list[dict[str, Any]],
        conn: sqlite3.Connection | None = None,
    ) -> list[int]:
        """批量插入翻译条目（不清空已有记录），返回新 ID 列表"""
        if conn is not None:
            ids = []
            for item in items:
                data_json = JSONTool.dumps({k: v for k, v in item.items() if k != "id"})
                cursor = conn.execute(
                    "INSERT INTO items (data) VALUES (?)",
                    (data_json,),
                )
                if cursor.lastrowid is None:
                    raise ValueError("Failed to get lastrowid")
                ids.append(int(cursor.lastrowid))
            return ids

        with self.connection() as local_conn:
            ids = []
            for item in items:
                data_json = JSONTool.dumps({k: v for k, v in item.items() if k != "id"})
                cursor = local_conn.execute(
                    "INSERT INTO items (data) VALUES (?)",
                    (data_json,),
                )
                if cursor.lastrowid is None:
                    raise ValueError("Failed to get lastrowid")
                ids.append(int(cursor.lastrowid))
            local_conn.commit()
            return ids

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        """综合批量更新（在单次事务中更新条目、规则及元数据）"""
        if not items and not rules and not meta:
            return

        self.update_batch_prepared(
            item_params=self.prepare_item_update_params(items),
            rule_delete_params=self.prepare_rule_delete_params(rules),
            rule_insert_params=self.prepare_rule_insert_params(rules),
            meta_params=self.prepare_meta_upsert_params(meta),
        )

    def prepare_item_update_params(
        self,
        items: list[dict[str, Any]] | None,
    ) -> list[tuple[str, int]]:
        """把 item 更新参数预序列化，避免在状态锁内重复调用 JSON.dumps。"""
        if not items:
            return []

        return [
            (
                JSONTool.dumps({k: v for k, v in item.items() if k != "id"}),
                int(item["id"]),
            )
            for item in items
            if isinstance(item.get("id"), int)
        ]

    def prepare_rule_delete_params(
        self,
        rules: dict[RuleType, Any] | None,
    ) -> list[tuple[str]]:
        """规则替换前的 delete 参数同样提前准备，缩短事务内分支时间。"""
        if not rules:
            return []
        return [(str(rule_type),) for rule_type in rules]

    def prepare_rule_insert_params(
        self,
        rules: dict[RuleType, Any] | None,
    ) -> list[tuple[str, str]]:
        """把规则载荷预序列化，避免高频批次在锁内做 JSON dumps。"""
        if not rules:
            return []
        return [
            (str(rule_type), JSONTool.dumps(rule_data))
            for rule_type, rule_data in rules.items()
        ]

    def update_batch_prepared(
        self,
        *,
        item_params: list[tuple[str, int]] | None = None,
        rule_delete_params: list[tuple[str]] | None = None,
        rule_insert_params: list[tuple[str, str]] | None = None,
        meta_params: list[tuple[str, str]] | None = None,
    ) -> None:
        """接受预序列化批量参数，让调用方把重活提前到锁外完成。"""
        if (
            not item_params
            and not rule_delete_params
            and not rule_insert_params
            and not meta_params
        ):
            return

        with self.connection() as conn:
            if item_params:
                conn.executemany("UPDATE items SET data = ? WHERE id = ?", item_params)

            if rule_delete_params:
                for delete_param in rule_delete_params:
                    conn.execute("DELETE FROM rules WHERE type = ?", delete_param)
            if rule_insert_params:
                conn.executemany(
                    "INSERT INTO rules (type, data) VALUES (?, ?)",
                    rule_insert_params,
                )

            if meta_params:
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
                "SELECT data FROM rules WHERE type = ? ORDER BY id",
                (rule_type,),
            )
            rows = cursor.fetchall()

            if not rows:
                return []

            # 检查第一行数据结构
            try:
                first_data = JSONTool.loads(rows[0]["data"])
            except Exception as e:
                LogManager.get().warning(
                    f"Failed to decode rules JSON: type={rule_type.value}", e
                )
                return []

            # 如果是新格式（单行存储列表），直接返回
            if isinstance(first_data, list):
                return first_data

            # 如果是旧格式（多行存储字典），聚合返回
            result = []
            had_decode_error = False
            for row in rows:
                try:
                    data = JSONTool.loads(row["data"])
                    if isinstance(data, dict):
                        result.append(data)
                    elif isinstance(data, list):
                        # 兼容性处理：如果混合了列表行
                        result.extend(data)
                except Exception as e:
                    if not had_decode_error:
                        LogManager.get().warning(
                            f"Failed to decode rule row JSON: type={rule_type.value}",
                            e,
                        )
                        had_decode_error = True
                    continue
            return result

    def set_rules(self, rule_type: RuleType, rules: list[dict[str, Any]]) -> None:
        """设置指定类型的规则（清空后重新写入，存储为单行 JSON）"""
        with self.connection() as conn:
            conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
            conn.execute(
                "INSERT INTO rules (type, data) VALUES (?, ?)",
                (rule_type, JSONTool.dumps(rules)),
            )
            conn.commit()

    def get_rule_text(self, rule_type: RuleType) -> str:
        """获取文本类型的规则（如自定义提示词）"""
        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? LIMIT 1",
                (rule_type,),
            )
            row = cursor.fetchone()
            if row is None:
                return ""
            return self.deserialize_rule_text_payload(row["data"], rule_type.value)

    def get_rule_text_by_name(self, rule_type_name: str) -> str:
        """按原始 type 名称读取文本规则，专供旧数据兼容迁移使用。"""
        with self.connection() as conn:
            cursor = conn.execute(
                "SELECT data FROM rules WHERE type = ? LIMIT 1",
                (rule_type_name,),
            )
            row = cursor.fetchone()
            if row is None:
                return ""
            return self.deserialize_rule_text_payload(row["data"], rule_type_name)

    def set_rule_text(self, rule_type: RuleType, text: str) -> None:
        """设置文本类型的规则（如自定义提示词）"""
        with self.connection() as conn:
            conn.execute("DELETE FROM rules WHERE type = ?", (rule_type,))
            conn.execute(
                "INSERT INTO rules (type, data) VALUES (?, ?)",
                (rule_type, JSONTool.dumps({"text": text})),
            )
            conn.commit()

    def deserialize_rule_text_payload(self, raw_data: str, rule_type_name: str) -> str:
        """兼容解析文本规则载荷，旧工程迁移时允许读到纯字符串旧格式。"""
        try:
            data = JSONTool.loads(raw_data)
        except Exception as e:
            LogManager.get().warning(
                f"Failed to decode text rule JSON: type={rule_type_name}",
                e,
            )
            return ""

        if isinstance(data, dict):
            text = data.get("text", "")
            if isinstance(text, str):
                return text
            if text is None:
                return ""
            return str(text)

        if isinstance(data, str):
            return data

        return ""

    # ========== 工厂方法 ==========

    @classmethod
    def create(cls, db_path: str, name: str) -> "LGDatabase":
        """创建新的 .lg 数据库

        使用短连接初始化数据库结构和元数据，不保持长连接。
        """
        db = cls(db_path)
        db.set_meta("schema_version", cls.SCHEMA_VERSION)
        db.set_meta("name", name)
        db.set_meta("created_at", datetime.now().isoformat())
        db.set_meta("updated_at", datetime.now().isoformat())
        return db

    # ========== 业务辅助 ==========

    def get_project_summary(self) -> dict[str, Any]:
        """获取项目概览信息（进度、文件数等）"""
        with self.connection() as conn:
            meta_cursor = conn.execute("SELECT key, value FROM meta")
            meta = {
                row["key"]: JSONTool.loads(row["value"])
                for row in meta_cursor.fetchall()
            }

            file_count = conn.execute("SELECT COUNT(*) FROM assets").fetchone()[0]

            extras = meta.get("translation_extras", {})
            if isinstance(extras, dict) and "line" in extras and "total_line" in extras:
                translated_items = extras["line"]
                total_items = extras["total_line"]
                if total_items == 0:
                    total_items = (
                        conn.execute("SELECT COUNT(*) FROM items").fetchone()[0] or 0
                    )
            else:
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
