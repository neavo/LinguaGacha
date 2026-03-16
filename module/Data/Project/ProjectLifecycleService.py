from __future__ import annotations

from datetime import datetime
from pathlib import Path

from base.BaseLanguage import BaseLanguage
from module.Data.Core.AssetService import AssetService
from module.Data.Core.DataEnums import TextPreserveMode
from module.Data.Core.ItemService import ItemService
from module.Data.Storage.LGDatabase import LGDatabase
from module.Data.Core.MetaService import MetaService
from module.Data.Core.ProjectSession import ProjectSession
from module.Localizer.Localizer import Localizer


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
            self.migrate_text_preserve_mode_if_needed()
            self.migrate_legacy_translation_prompt_text_once()
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

    def migrate_text_preserve_mode_if_needed(self) -> None:
        """把旧的 bool 开关迁移成新的 mode 枚举。"""

        raw_mode = self.session.meta_cache.get("text_preserve_mode")
        mode_valid = False
        if isinstance(raw_mode, str):
            try:
                TextPreserveMode(raw_mode)
                mode_valid = True
            except ValueError:
                mode_valid = False

        if mode_valid or self.session.db is None:
            return

        legacy_enable = bool(self.session.meta_cache.get("text_preserve_enable", False))
        migrated = (
            TextPreserveMode.CUSTOM.value
            if legacy_enable
            else TextPreserveMode.SMART.value
        )
        self.session.db.set_meta("text_preserve_mode", migrated)
        self.session.meta_cache["text_preserve_mode"] = migrated

    def migrate_legacy_translation_prompt_text_once(self) -> None:
        """把旧工程中的 ZH/EN 翻译提示词正文迁移到新字段。"""

        db = self.session.db
        if db is None:
            return

        if bool(
            self.session.meta_cache.get(
                self.legacy_translation_prompt_migrated_meta_key,
                False,
            )
        ):
            return

        current_prompt = db.get_rule_text(self.rule_type.TRANSLATION_PROMPT).strip()
        if current_prompt != "":
            self.mark_legacy_translation_prompt_migrated(db)
            return

        migrated_prompt = self.get_first_available_legacy_translation_prompt(db)
        if migrated_prompt != "":
            db.set_rule_text(self.rule_type.TRANSLATION_PROMPT, migrated_prompt)

        self.mark_legacy_translation_prompt_migrated(db)

    def get_preferred_legacy_translation_prompt_types(self) -> tuple[str, str]:
        """按当前 UI 语言决定旧 ZH/EN 槽位的读取优先级。"""

        app_language = Localizer.get_app_language()
        if app_language == BaseLanguage.Enum.EN:
            return (
                self.legacy_prompt_en_rule_type,
                self.legacy_prompt_zh_rule_type,
            )

        return (
            self.legacy_prompt_zh_rule_type,
            self.legacy_prompt_en_rule_type,
        )

    def get_first_available_legacy_translation_prompt(self, db: LGDatabase) -> str:
        """按优先级读取第一个可用的旧提示词正文。"""

        for legacy_rule_type in self.get_preferred_legacy_translation_prompt_types():
            candidate = db.get_rule_text_by_name(legacy_rule_type).strip()
            if candidate != "":
                return candidate
        return ""

    def mark_legacy_translation_prompt_migrated(self, db: LGDatabase) -> None:
        """记录旧翻译提示词已经迁移完成。"""

        db.set_meta(self.legacy_translation_prompt_migrated_meta_key, True)
        self.session.meta_cache[self.legacy_translation_prompt_migrated_meta_key] = True
