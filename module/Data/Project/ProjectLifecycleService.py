from __future__ import annotations

from datetime import datetime
from pathlib import Path

from module.Data.Core.AssetService import AssetService
from module.Data.Core.ItemService import ItemService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Migration.ProjectMetaMigrationService import ProjectMetaMigrationService
from module.Migration.ProjectRuleMigrationService import ProjectRuleMigrationService


class ProjectLifecycleService:
    """工程生命周期服务。"""

    def __init__(
        self,
        session: ProjectSession,
        meta_service: MetaService,
        item_service: ItemService,
        asset_service: AssetService,
        rule_type: type[LGDatabase.RuleType],
        legacy_prompt_zh_rule_type: str,
        legacy_prompt_en_rule_type: str,
        legacy_translation_prompt_migrated_meta_key: str,
    ) -> None:
        self.session = session
        self.meta_service = meta_service
        self.item_service = item_service
        self.asset_service = asset_service
        self.rule_type = rule_type
        self.legacy_prompt_zh_rule_type = legacy_prompt_zh_rule_type
        self.legacy_prompt_en_rule_type = legacy_prompt_en_rule_type
        self.legacy_translation_prompt_migrated_meta_key = (
            legacy_translation_prompt_migrated_meta_key
        )

    def load_project(self, lg_path: str) -> None:
        """加载工程并完成必要的旧数据迁移。"""

        with self.session.state_lock:
            if not Path(lg_path).exists():
                raise FileNotFoundError(f"工程文件不存在: {lg_path}")

            self.session.lg_path = lg_path
            self.session.db = LGDatabase(lg_path)
            self.session.db.set_meta("updated_at", datetime.now().isoformat())
            self.meta_service.refresh_cache_from_db()
            ProjectMetaMigrationService.migrate_text_preserve_mode_if_needed(
                self.session.db,
                self.session.meta_cache,
            )
            ProjectRuleMigrationService.migrate_legacy_translation_prompt_text_once(
                self.session.db,
                self.session.meta_cache,
                rule_type=self.rule_type,
                legacy_prompt_zh_rule_type=self.legacy_prompt_zh_rule_type,
                legacy_prompt_en_rule_type=self.legacy_prompt_en_rule_type,
                legacy_translation_prompt_migrated_meta_key=(
                    self.legacy_translation_prompt_migrated_meta_key
                ),
            )
            self.session.rule_cache.clear()
            self.session.rule_text_cache.clear()
            self.item_service.clear_item_cache()
            self.asset_service.clear_decompress_cache()

    def unload_project(self) -> str | None:
        """卸载工程并返回旧路径。"""

        with self.session.state_lock:
            old_path = self.session.lg_path
            if self.session.db is not None:
                self.session.db.close()
            self.session.db = None
            self.session.lg_path = None
            self.session.clear_all_caches()
            return old_path
