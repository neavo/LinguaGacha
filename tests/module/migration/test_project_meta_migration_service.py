from types import SimpleNamespace
from unittest.mock import MagicMock

from module.Data.Core.DataEnums import TextPreserveMode
from module.Migration.ProjectMetaMigrationService import ProjectMetaMigrationService


def build_fake_db() -> SimpleNamespace:
    return SimpleNamespace(set_meta=MagicMock())


def test_migrate_text_preserve_mode_uses_legacy_switch_when_mode_invalid() -> None:
    db = build_fake_db()
    meta_cache = {
        "text_preserve_mode": "invalid-mode",
        "text_preserve_enable": True,
    }

    changed = ProjectMetaMigrationService.migrate_text_preserve_mode_if_needed(
        db,
        meta_cache,
    )

    assert changed is True
    db.set_meta.assert_called_once_with(
        "text_preserve_mode", TextPreserveMode.CUSTOM.value
    )
    assert meta_cache["text_preserve_mode"] == TextPreserveMode.CUSTOM.value


def test_migrate_text_preserve_mode_defaults_to_smart_when_legacy_switch_missing() -> (
    None
):
    db = build_fake_db()
    meta_cache: dict[str, object] = {}

    changed = ProjectMetaMigrationService.migrate_text_preserve_mode_if_needed(
        db,
        meta_cache,
    )

    assert changed is True
    db.set_meta.assert_called_once_with(
        "text_preserve_mode", TextPreserveMode.SMART.value
    )
    assert meta_cache["text_preserve_mode"] == TextPreserveMode.SMART.value


def test_migrate_text_preserve_mode_skips_when_mode_already_valid() -> None:
    db = build_fake_db()
    meta_cache: dict[str, object] = {"text_preserve_mode": TextPreserveMode.SMART.value}

    changed = ProjectMetaMigrationService.migrate_text_preserve_mode_if_needed(
        db,
        meta_cache,
    )

    assert changed is False
    db.set_meta.assert_not_called()
