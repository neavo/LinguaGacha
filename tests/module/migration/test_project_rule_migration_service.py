from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.BaseLanguage import BaseLanguage
from module.Data.Storage.LGDatabase import LGDatabase
from module.Migration.ProjectRuleMigrationService import ProjectRuleMigrationService

LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY = "translation_prompt_legacy_migrated"


def build_fake_db(
    *,
    current_translation_prompt: str = "",
    legacy_prompt_zh: str = "",
    legacy_prompt_en: str = "",
) -> SimpleNamespace:
    return SimpleNamespace(
        get_rule_text=MagicMock(return_value=current_translation_prompt),
        get_rule_text_by_name=MagicMock(
            side_effect=lambda rule_type: (
                legacy_prompt_zh
                if rule_type == LGDatabase.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE
                else legacy_prompt_en
            )
        ),
        set_rule_text=MagicMock(),
        set_meta=MagicMock(),
    )


def migrate(db: SimpleNamespace, meta_cache: dict[str, object]) -> bool:
    return ProjectRuleMigrationService.migrate_legacy_translation_prompt_text_once(
        db,
        meta_cache,
        rule_type=LGDatabase.RuleType,
        legacy_prompt_zh_rule_type=LGDatabase.LEGACY_TRANSLATION_PROMPT_ZH_RULE_TYPE,
        legacy_prompt_en_rule_type=LGDatabase.LEGACY_TRANSLATION_PROMPT_EN_RULE_TYPE,
        legacy_translation_prompt_migrated_meta_key=(
            LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY
        ),
    )


def test_migrate_legacy_translation_prompt_marks_only_when_current_prompt_exists() -> (
    None
):
    db = build_fake_db(current_translation_prompt="  现有提示词  ")
    meta_cache: dict[str, object] = {}

    changed = migrate(db, meta_cache)

    assert changed is True
    db.set_rule_text.assert_not_called()
    db.set_meta.assert_called_once_with(
        LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
        True,
    )
    assert meta_cache[LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY] is True


def test_migrate_legacy_translation_prompt_uses_fallback_and_marks_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = build_fake_db(legacy_prompt_zh="旧中文提示词")
    meta_cache: dict[str, object] = {}
    monkeypatch.setattr(
        "module.Migration.ProjectRuleMigrationService.Localizer.get_app_language",
        lambda: BaseLanguage.Enum.ZH,
    )

    changed = migrate(db, meta_cache)

    assert changed is True
    db.set_rule_text.assert_called_once_with(
        LGDatabase.RuleType.TRANSLATION_PROMPT,
        "旧中文提示词",
    )
    db.set_meta.assert_called_once_with(
        LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY,
        True,
    )


def test_migrate_legacy_translation_prompt_prefers_current_ui_language(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = build_fake_db(
        legacy_prompt_zh="旧中文提示词",
        legacy_prompt_en="Old English Prompt",
    )
    meta_cache: dict[str, object] = {}
    monkeypatch.setattr(
        "module.Migration.ProjectRuleMigrationService.Localizer.get_app_language",
        lambda: BaseLanguage.Enum.EN,
    )

    migrate(db, meta_cache)

    db.set_rule_text.assert_called_once_with(
        LGDatabase.RuleType.TRANSLATION_PROMPT,
        "Old English Prompt",
    )


def test_migrate_legacy_translation_prompt_skips_when_already_marked() -> None:
    db = build_fake_db(legacy_prompt_zh="旧中文提示词")
    meta_cache: dict[str, object] = {LEGACY_TRANSLATION_PROMPT_MIGRATED_META_KEY: True}

    changed = migrate(db, meta_cache)

    assert changed is False
    db.set_rule_text.assert_not_called()
    db.set_meta.assert_not_called()
