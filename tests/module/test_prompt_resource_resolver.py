from pathlib import Path

import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.PromptResourceResolver import PromptResourceResolver


@pytest.fixture(autouse=True)
def reset_app_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)


@pytest.fixture
def resolver_root(fs, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = Path("/workspace/prompt_resolver")
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(str(root))
    return root


def test_template_helpers_follow_task_type_and_language(
    resolver_root: Path,
) -> None:
    template_dir = resolver_root / "resource" / "translation_prompt" / "template" / "en"
    template_dir.mkdir(parents=True, exist_ok=True)
    (template_dir / "base.txt").write_text("  English Base  ", encoding="utf-8-sig")

    assert (
        PromptResourceResolver.get_task_dir_name(
            PromptResourceResolver.TaskType.TRANSLATION
        )
        == "translation_prompt"
    )
    assert (
        PromptResourceResolver.get_template_dir(
            PromptResourceResolver.TaskType.TRANSLATION,
            BaseLanguage.Enum.EN,
        ).replace("\\", "/")
        == "resource/translation_prompt/template/en"
    )
    assert (
        PromptResourceResolver.get_template_path(
            PromptResourceResolver.TaskType.TRANSLATION,
            "base.txt",
            BaseLanguage.Enum.EN,
        ).replace("\\", "/")
        == "resource/translation_prompt/template/en/base.txt"
    )
    assert (
        PromptResourceResolver.read_template(
            PromptResourceResolver.TaskType.TRANSLATION,
            "base.txt",
            BaseLanguage.Enum.EN,
        )
        == "English Base"
    )


def test_list_presets_returns_builtin_and_user_virtual_ids(
    resolver_root: Path,
) -> None:
    builtin_dir = resolver_root / "resource" / "translation_prompt" / "preset"
    user_dir = resolver_root / "userdata" / "translation_prompt"
    builtin_dir.mkdir(parents=True, exist_ok=True)
    user_dir.mkdir(parents=True, exist_ok=True)

    (builtin_dir / "01_demo.txt").write_text("builtin", encoding="utf-8")
    (builtin_dir / "ignore.md").write_text("skip", encoding="utf-8")
    (user_dir / "mine.txt").write_text("user", encoding="utf-8")

    PromptResourceResolver.migrate_legacy_translation_user_presets()
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


def test_virtual_id_helpers_validate_and_resolve_paths() -> None:
    assert (
        PromptResourceResolver.build_virtual_id(
            PromptResourceResolver.PresetSource.USER,
            "demo.txt",
        )
        == "user:demo.txt"
    )
    assert PromptResourceResolver.split_virtual_id("builtin:demo.txt") == (
        PromptResourceResolver.PresetSource.BUILTIN,
        "demo.txt",
    )
    assert (
        PromptResourceResolver.resolve_virtual_id_path(
            PromptResourceResolver.TaskType.ANALYSIS,
            "user:demo.txt",
        ).replace("\\", "/")
        == "userdata/analysis_prompt/demo.txt"
    )

    with pytest.raises(ValueError, match="invalid virtual preset id"):
        PromptResourceResolver.split_virtual_id("demo")

    with pytest.raises(ValueError, match="invalid virtual preset id"):
        PromptResourceResolver.split_virtual_id("builtin:demo.md")


def test_user_preset_round_trip_supports_save_read_rename_delete(
    resolver_root: Path,
) -> None:
    del resolver_root
    saved_path = PromptResourceResolver.save_user_preset(
        PromptResourceResolver.TaskType.TRANSLATION,
        "  my preset  ",
        "  hello world  ",
    )

    assert saved_path == "userdata/translation_prompt/my preset.txt"
    assert (
        PromptResourceResolver.read_preset(
            PromptResourceResolver.TaskType.TRANSLATION,
            "user:my preset.txt",
        )
        == "hello world"
    )

    renamed_item = PromptResourceResolver.rename_user_preset(
        PromptResourceResolver.TaskType.TRANSLATION,
        "user:my preset.txt",
        " renamed ",
    )
    assert renamed_item == {
        "name": "renamed",
        "file_name": "renamed.txt",
        "virtual_id": "user:renamed.txt",
        "path": "userdata/translation_prompt/renamed.txt",
        "type": "user",
    }

    deleted_path = PromptResourceResolver.delete_user_preset(
        PromptResourceResolver.TaskType.TRANSLATION,
        "user:renamed.txt",
    )
    assert deleted_path == "userdata/translation_prompt/renamed.txt"
    assert not Path(deleted_path).exists()


def test_build_migration_target_path_appends_suffix_and_index(
    resolver_root: Path,
) -> None:
    destination_dir = resolver_root / "userdata" / "translation_prompt"
    destination_dir.mkdir(parents=True, exist_ok=True)
    (destination_dir / "demo.txt").write_text("base", encoding="utf-8")
    (destination_dir / "demo_zh.txt").write_text("suffix", encoding="utf-8")

    assert (
        PromptResourceResolver.build_migration_target_path(
            "userdata/translation_prompt",
            "story.txt",
            "zh",
        ).replace("\\", "/")
        == "userdata/translation_prompt/story.txt"
    )
    assert (
        PromptResourceResolver.build_migration_target_path(
            "userdata/translation_prompt",
            "demo.txt",
            "zh",
        ).replace("\\", "/")
        == "userdata/translation_prompt/demo_zh_2.txt"
    )


def test_migrate_legacy_translation_user_presets_handles_conflicts(
    resolver_root: Path,
) -> None:
    legacy_zh_dir = (
        resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    )
    legacy_en_dir = (
        resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "en"
    )
    destination_dir = resolver_root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    legacy_en_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)

    (destination_dir / "demo.txt").write_text("existing", encoding="utf-8")
    (destination_dir / "demo_zh.txt").write_text("existing-zh", encoding="utf-8")
    (legacy_zh_dir / "demo.txt").write_text("old-zh", encoding="utf-8")
    (legacy_en_dir / "demo.txt").write_text("old-en", encoding="utf-8")

    PromptResourceResolver.migrate_legacy_translation_user_presets()

    assert not (legacy_zh_dir / "demo.txt").exists()
    assert not (legacy_en_dir / "demo.txt").exists()
    assert (destination_dir / "demo_zh_2.txt").read_text(encoding="utf-8") == "old-zh"
    assert (destination_dir / "demo_en.txt").read_text(encoding="utf-8") == "old-en"


def test_migrate_legacy_translation_user_presets_is_idempotent(
    resolver_root: Path,
) -> None:
    legacy_zh_dir = (
        resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    )
    destination_dir = resolver_root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)
    (legacy_zh_dir / "story.txt").write_text("content", encoding="utf-8")

    PromptResourceResolver.migrate_legacy_translation_user_presets()
    PromptResourceResolver.migrate_legacy_translation_user_presets()

    files = sorted(path.name for path in destination_dir.iterdir())
    assert files == ["story.txt"]


def test_migrate_legacy_translation_user_presets_logs_failures(
    resolver_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    legacy_zh_dir = (
        resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "zh"
    )
    destination_dir = resolver_root / "userdata" / "translation_prompt"
    legacy_zh_dir.mkdir(parents=True, exist_ok=True)
    destination_dir.mkdir(parents=True, exist_ok=True)
    (legacy_zh_dir / "story.txt").write_text("content", encoding="utf-8")

    warnings: list[tuple[str, Exception]] = []

    class DummyLogger:
        def warning(self, msg: str, e: Exception) -> None:
            warnings.append((msg, e))

    monkeypatch.setattr(
        "module.PromptResourceResolver.LogManager.get",
        lambda: DummyLogger(),
    )
    monkeypatch.setattr(
        "module.PromptResourceResolver.shutil.move",
        lambda src, dst: (_ for _ in ()).throw(OSError(f"boom: {src} -> {dst}")),
    )

    PromptResourceResolver.migrate_legacy_translation_user_presets()

    assert len(warnings) == 1
    assert "Failed to migrate legacy custom prompt preset" in warnings[0][0]
    assert isinstance(warnings[0][1], OSError)
    assert (legacy_zh_dir / "story.txt").exists()
