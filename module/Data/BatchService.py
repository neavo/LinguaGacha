from typing import Any

from module.Data.LGDatabase import LGDatabase
from module.Data.ProjectSession import ProjectSession


class BatchService:
    """批量事务写入（meta / rules / items），并同步会话缓存。"""

    def __init__(self, session: ProjectSession) -> None:
        self.session = session

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

            db.update_batch(items=items, rules=rules, meta=meta)

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
