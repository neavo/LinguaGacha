from typing import Any

from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.ProjectSession import ProjectSession


class BatchService:
    """批量事务写入（meta / rules / items），并同步会话缓存。"""

    PREPARED_UPDATE_METHODS: tuple[str, ...] = (
        "prepare_item_update_params",
        "prepare_rule_delete_params",
        "prepare_rule_insert_params",
        "prepare_meta_upsert_params",
        "update_batch_prepared",
    )

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

    def sync_session_caches(
        self,
        *,
        items: list[dict[str, Any]] | None,
        rules: dict[LGDatabase.RuleType, Any] | None,
        meta: dict[str, Any] | None,
    ) -> None:
        """数据库提交成功后立即同步当前工程缓存，避免工程切换时缓存串写。"""
        # 1) 同步 meta 缓存
        if meta:
            for k, v in meta.items():
                self.session.meta_cache[k] = v

        # 2) 同步 rules 缓存
        if rules:
            for rule_type, rule_data in rules.items():
                self.session.rule_cache[rule_type] = rule_data
                self.session.rule_text_cache.pop(rule_type, None)

        # 3) 同步 items 缓存（仅在已加载全量缓存时做增量更新）
        if items and self.session.item_cache is not None:
            for item in items:
                item_id = item.get("id")
                if not isinstance(item_id, int):
                    continue
                idx = self.session.item_cache_index.get(item_id)
                if idx is None:
                    continue
                self.session.item_cache[idx] = item

    def build_prepared_update_payload(
        self,
        db: Any,
        *,
        items: list[dict[str, Any]] | None,
        rules: dict[LGDatabase.RuleType, Any] | None,
        meta: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        """支持预序列化批量接口时，先在锁外准备好 SQL 参数。"""
        supports_prepared_update = all(
            hasattr(db, attr_name) for attr_name in self.PREPARED_UPDATE_METHODS
        )
        if not supports_prepared_update:
            return None

        return {
            "item_params": db.prepare_item_update_params(items),
            "rule_delete_params": db.prepare_rule_delete_params(rules),
            "rule_insert_params": db.prepare_rule_insert_params(rules),
            "meta_params": db.prepare_meta_upsert_params(meta),
        }

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[LGDatabase.RuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        with self.session.state_lock:
            db = self.session.db
            if db is None:
                raise RuntimeError("工程未加载")

        prepared_payload = self.build_prepared_update_payload(
            db,
            items=items,
            rules=rules,
            meta=meta,
        )

        with self.session.state_lock:
            if self.session.db is not db:
                raise RuntimeError("工程上下文已切换")

            if prepared_payload is not None:
                db.update_batch_prepared(**prepared_payload)
            else:
                db.update_batch(items=items, rules=rules, meta=meta)

            self.sync_session_caches(items=items, rules=rules, meta=meta)
