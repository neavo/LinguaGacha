from pathlib import Path
from unittest.mock import MagicMock

import pytest

from module.PromptResourceResolver import PromptResourceResolver


def test_list_presets_returns_virtual_ids(fs, monkeypatch: pytest.MonkeyPatch) -> None:
    del fs
    root = Path("/workspace/prompt_resolver")
    builtin_dir = root / "resource" / "translation_prompt" / "preset"
    user_dir = root / "userdata" / "translation_prompt"
    builtin_dir.mkdir(parents=True, exist_ok=True)
    user_dir.mkdir(parents=True, exist_ok=True)

    (builtin_dir / "01_demo.txt").write_text("builtin", encoding="utf-8")
    (user_dir / "mine.txt").write_text("user", encoding="utf-8")

    monkeypatch.chdir(str(root))

    builtin_items, user_items = PromptResourceResolver.list_presets(
        PromptResourceResolver.TaskType.TRANSLATION
    )

    assert builtin_items == [
        {
            "name": "01_demo",
            "file_name": "01_demo.txt",
            "virtual_id": "builtin:01_demo.txt",
            "path": "resource/translation_prompt/preset/01_demo.txt",
            "type": "builtin",
        }
    ]
    assert user_items == [
        {
            "name": "mine",
            "file_name": "mine.txt",
            "virtual_id": "user:mine.txt",
            "path": "userdata/translation_prompt/mine.txt",
            "type": "user",
        }
    ]


def test_migrate_legacy_translation_user_presets_handles_conflicts(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    root = Path("/workspace/prompt_resolver_conflict")
    legacy_zh_dir = root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    legacy_en_dir = root / "resource" / "preset" / "custom_prompt" / "user" / "en"
    destination_dir = root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    legacy_en_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)

    (destination_dir / "demo.txt").write_text("existing", encoding="utf-8")
    (destination_dir / "demo_zh.txt").write_text("existing-zh", encoding="utf-8")
    (legacy_zh_dir / "demo.txt").write_text("old-zh", encoding="utf-8")
    (legacy_en_dir / "demo.txt").write_text("old-en", encoding="utf-8")

    monkeypatch.chdir(str(root))

    PromptResourceResolver.migrate_legacy_translation_user_presets()

    assert not (legacy_zh_dir / "demo.txt").exists()
    assert not (legacy_en_dir / "demo.txt").exists()
    assert (destination_dir / "demo_zh_2.txt").read_text(encoding="utf-8") == "old-zh"
    assert (destination_dir / "demo_en.txt").read_text(encoding="utf-8") == "old-en"


def test_migrate_legacy_translation_user_presets_is_idempotent(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    root = Path("/workspace/prompt_resolver_idempotent")
    legacy_zh_dir = root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    destination_dir = root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)

    (legacy_zh_dir / "story.txt").write_text("content", encoding="utf-8")

    monkeypatch.chdir(str(root))

    PromptResourceResolver.migrate_legacy_translation_user_presets()
    PromptResourceResolver.migrate_legacy_translation_user_presets()

    files = sorted(path.name for path in destination_dir.iterdir())
    assert files == ["story.txt"]


def test_migrate_legacy_translation_user_presets_logs_failures(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    root = Path("/workspace/prompt_resolver_failure")
    legacy_zh_dir = root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    destination_dir = root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)
    (legacy_zh_dir / "story.txt").write_text("content", encoding="utf-8")

    monkeypatch.chdir(str(root))
    logger = MagicMock()
    monkeypatch.setattr("module.PromptResourceResolver.LogManager.get", lambda: logger)
    monkeypatch.setattr(
        "module.PromptResourceResolver.shutil.move",
        lambda src, dst: (_ for _ in ()).throw(OSError("boom")),
    )

    PromptResourceResolver.migrate_legacy_translation_user_presets()

    logger.warning.assert_called_once()
    assert (legacy_zh_dir / "story.txt").exists()
