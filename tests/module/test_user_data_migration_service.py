import json
from pathlib import Path

import pytest

from base.BasePath import BasePath
from module.Config import Config
import module.Migration.UserDataMigrationService as migration_service_module
from module.Migration.UserDataMigrationService import UserDataMigrationService


class FakeLogManager:
    def __init__(self) -> None:
        self.warning_messages: list[str] = []
        self.warning_exceptions: list[BaseException | None] = []

    def warning(self, msg: str, e: BaseException | None = None) -> None:
        self.warning_messages.append(msg)
        self.warning_exceptions.append(e)


@pytest.fixture(autouse=True)
def reset_migration_service(monkeypatch: pytest.MonkeyPatch) -> FakeLogManager:
    BasePath.reset_for_test()
    # 迁移测试只验证文件与配置结果，不需要真实日志线程向控制台写输出。
    logger = FakeLogManager()
    monkeypatch.setattr(migration_service_module.LogManager, "get", lambda: logger)
    return logger


@pytest.fixture
def migration_root(fs, monkeypatch: pytest.MonkeyPatch) -> Path:
    del fs
    root = Path("/workspace/migration_service")
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(str(root))
    BasePath.initialize(str(root), False)
    return root


def test_migrate_prompt_user_presets_keeps_new_file_and_deletes_old_duplicate(
    migration_root: Path,
) -> None:
    legacy_dir = (
        migration_root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    )
    destination_dir = migration_root / "userdata" / "translation_prompt"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)

    (legacy_dir / "story.txt").write_text("old", encoding="utf-8")
    (destination_dir / "story.txt").write_text("new", encoding="utf-8")

    UserDataMigrationService.migrate_prompt_user_presets()

    assert (destination_dir / "story.txt").read_text(encoding="utf-8") == "new"
    assert not (legacy_dir / "story.txt").exists()


def test_migrate_quality_rule_user_presets_moves_to_flat_userdata_dir(
    migration_root: Path,
) -> None:
    legacy_dir = migration_root / "resource" / "preset" / "glossary" / "user"
    destination_dir = migration_root / "userdata" / "glossary"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    (legacy_dir / "demo.json").write_text("[]", encoding="utf-8")

    UserDataMigrationService.migrate_quality_rule_user_presets()

    assert (destination_dir / "demo.json").exists()
    assert not (legacy_dir / "demo.json").exists()


def test_migrate_quality_rule_builtin_layout_moves_to_new_resource_shape(
    migration_root: Path,
) -> None:
    legacy_dir = migration_root / "resource" / "preset" / "glossary" / "zh"
    destination_dir = migration_root / "resource" / "glossary" / "preset"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    (legacy_dir / "demo.json").write_text("[]", encoding="utf-8")

    UserDataMigrationService.migrate_quality_rule_builtin_layout()

    assert (destination_dir / "demo.json").exists()
    assert not (legacy_dir / "demo.json").exists()


def test_migrate_quality_rule_builtin_layout_moves_layered_resource_shape(
    migration_root: Path,
) -> None:
    layered_dir = migration_root / "resource" / "glossary" / "preset" / "zh"
    destination_dir = migration_root / "resource" / "glossary" / "preset"
    layered_dir.mkdir(parents=True, exist_ok=True)
    (layered_dir / "demo.json").write_text("[]", encoding="utf-8")

    UserDataMigrationService.migrate_quality_rule_builtin_layout()

    assert (destination_dir / "demo.json").exists()
    assert not (layered_dir / "demo.json").exists()


def test_normalize_config_payload_converts_old_paths_to_virtual_ids(
    migration_root: Path,
) -> None:
    del migration_root
    config_data = {
        "glossary_default_preset": "resource/preset/glossary/zh/01_demo.json",
        "text_preserve_default_preset": "resource/preset/text_preserve/user/mine.json",
        "pre_translation_replacement_default_preset": "resource/pre_translation_replacement/preset/en/rule.json",
        "post_translation_replacement_default_preset": "unknown.txt",
    }

    normalized, changed = UserDataMigrationService.normalize_config_payload(config_data)

    assert changed is True
    assert normalized["glossary_default_preset"] == "builtin:01_demo.json"
    assert normalized["text_preserve_default_preset"] == "user:mine.json"
    assert (
        normalized["pre_translation_replacement_default_preset"] == "builtin:rule.json"
    )
    assert normalized["post_translation_replacement_default_preset"] == ""


def test_normalize_default_preset_config_values_rewrites_default_config_file(
    migration_root: Path,
) -> None:
    del migration_root
    config_path = Path(Config.get_default_path())
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(
            {
                "glossary_default_preset": "resource/preset/glossary/zh/01_demo.json",
                "text_preserve_default_preset": (
                    "resource/preset/text_preserve/user/mine.json"
                ),
                "post_translation_replacement_default_preset": "unknown.txt",
            }
        ),
        encoding="utf-8",
    )

    UserDataMigrationService.normalize_default_preset_config_values()

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["glossary_default_preset"] == "builtin:01_demo.json"
    assert saved["text_preserve_default_preset"] == "user:mine.json"
    assert saved["post_translation_replacement_default_preset"] == ""


def test_run_startup_migrations_copies_legacy_config_and_normalizes_values(
    migration_root: Path,
) -> None:
    legacy_path = migration_root / "resource" / "config.json"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_path.write_text(
        json.dumps(
            {
                "expert_mode": True,
                "glossary_default_preset": "resource/preset/glossary/zh/01_demo.json",
            }
        ),
        encoding="utf-8",
    )

    UserDataMigrationService.run_startup_migrations()

    config_path = migration_root / "userdata" / "config.json"
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["expert_mode"] is True
    assert saved["glossary_default_preset"] == "builtin:01_demo.json"


def test_migrate_update_runtime_artifacts_moves_runtime_files_to_userdata(
    migration_root: Path,
) -> None:
    legacy_dir = migration_root / "resource" / "update"
    runtime_dir = migration_root / "userdata" / "update"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    (legacy_dir / "update.log").write_text("old log", encoding="utf-8")
    (legacy_dir / "result.json").write_text(
        json.dumps({"status": "failed"}),
        encoding="utf-8",
    )
    (legacy_dir / "update.ps1").write_text("template", encoding="utf-8")

    UserDataMigrationService.migrate_update_runtime_artifacts_if_needed()

    assert (runtime_dir / "update.log").exists()
    assert (runtime_dir / "result.json").exists()
    assert (legacy_dir / "update.ps1").exists()
