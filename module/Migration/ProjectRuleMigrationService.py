from __future__ import annotations

from typing import Any

from base.BaseLanguage import BaseLanguage
from module.Data.Storage.LGDatabase import LGDatabase
from module.Localizer.Localizer import Localizer


class ProjectRuleMigrationService:
    """统一承接工程规则旧槽位向当前规则类型的迁移。"""

    @classmethod
    def migrate_legacy_translation_prompt_text_once(
        cls,
        db: LGDatabase,
        meta_cache: dict[str, Any],
        *,
        rule_type: type[LGDatabase.RuleType],
        legacy_prompt_zh_rule_type: str,
        legacy_prompt_en_rule_type: str,
        legacy_translation_prompt_migrated_meta_key: str,
    ) -> bool:
        """把旧工程中的 ZH/EN 翻译提示词正文迁移到新字段。"""

        if bool(meta_cache.get(legacy_translation_prompt_migrated_meta_key, False)):
            return False

        current_prompt = db.get_rule_text(rule_type.TRANSLATION_PROMPT).strip()
        if current_prompt != "":
            cls.mark_legacy_translation_prompt_migrated(
                db,
                meta_cache,
                legacy_translation_prompt_migrated_meta_key,
            )
            return True

        migrated_prompt = cls.get_first_available_legacy_translation_prompt(
            db,
            legacy_prompt_zh_rule_type,
            legacy_prompt_en_rule_type,
        )
        if migrated_prompt != "":
            db.set_rule_text(rule_type.TRANSLATION_PROMPT, migrated_prompt)

        cls.mark_legacy_translation_prompt_migrated(
            db,
            meta_cache,
            legacy_translation_prompt_migrated_meta_key,
        )
        return True

    @classmethod
    def get_preferred_legacy_translation_prompt_types(
        cls,
        legacy_prompt_zh_rule_type: str,
        legacy_prompt_en_rule_type: str,
    ) -> tuple[str, str]:
        """按当前 UI 语言决定旧 ZH/EN 槽位的读取优先级。"""

        app_language = Localizer.get_app_language()
        if app_language == BaseLanguage.Enum.EN:
            return (
                legacy_prompt_en_rule_type,
                legacy_prompt_zh_rule_type,
            )

        return (
            legacy_prompt_zh_rule_type,
            legacy_prompt_en_rule_type,
        )

    @classmethod
    def get_first_available_legacy_translation_prompt(
        cls,
        db: LGDatabase,
        legacy_prompt_zh_rule_type: str,
        legacy_prompt_en_rule_type: str,
    ) -> str:
        """按优先级读取第一个可用的旧提示词正文。"""

        for legacy_rule_type in cls.get_preferred_legacy_translation_prompt_types(
            legacy_prompt_zh_rule_type,
            legacy_prompt_en_rule_type,
        ):
            candidate = db.get_rule_text_by_name(legacy_rule_type).strip()
            if candidate != "":
                return candidate
        return ""

    @classmethod
    def mark_legacy_translation_prompt_migrated(
        cls,
        db: LGDatabase,
        meta_cache: dict[str, Any],
        legacy_translation_prompt_migrated_meta_key: str,
    ) -> None:
        """记录旧翻译提示词已经迁移完成。"""

        db.set_meta(legacy_translation_prompt_migrated_meta_key, True)
        meta_cache[legacy_translation_prompt_migrated_meta_key] = True
