from pathlib import Path

import pytest

from base.BaseLanguage import BaseLanguage
from base.BasePath import BasePath
from module.Localizer.Localizer import Localizer
from module.PromptPathResolver import PromptPathResolver


@pytest.fixture(autouse=True)
def reset_app_language() -> None:
    Localizer.set_app_language(BaseLanguage.Enum.ZH)
    BasePath.reset_for_test()


@pytest.fixture
def resolver_root(fs, monkeypatch: pytest.MonkeyPatch) -> Path:
    del fs
    root = Path("/workspace/prompt_resolver")
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(str(root))
    BasePath.initialize(str(root), False)
    return root


def test_template_helpers_follow_task_type_and_language(
    resolver_root: Path,
) -> None:
    template_dir = resolver_root / "resource" / "translation_prompt" / "template" / "en"
    template_dir.mkdir(parents=True, exist_ok=True)
    template_path = template_dir / "base.txt"
    template_path.write_text("  English Base  ", encoding="utf-8-sig")

    task_dir_name = PromptPathResolver.get_task_dir_name(
        PromptPathResolver.TaskType.TRANSLATION
    )
    assert task_dir_name == "translation_prompt"
    assert BasePath.get_prompt_template_dir(
        task_dir_name,
        BaseLanguage.Enum.EN,
    ).replace("\\", "/") == str(template_dir).replace("\\", "/")
    assert (
        PromptPathResolver.read_template(
            PromptPathResolver.TaskType.TRANSLATION,
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

    builtin_items, user_items = PromptPathResolver.list_presets(
        PromptPathResolver.TaskType.TRANSLATION
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
            "path": str(user_dir / "mine.txt").replace("\\", "/"),
            "type": "user",
        }
    ]


def test_virtual_id_helpers_validate_and_resolve_paths(
    resolver_root: Path,
) -> None:
    assert (
        PromptPathResolver.build_virtual_id(
            PromptPathResolver.PresetSource.USER,
            "demo.txt",
        )
        == "user:demo.txt"
    )
    assert PromptPathResolver.split_virtual_id("builtin:demo.txt") == (
        PromptPathResolver.PresetSource.BUILTIN,
        "demo.txt",
    )
    assert PromptPathResolver.resolve_virtual_id_path(
        PromptPathResolver.TaskType.ANALYSIS,
        "user:demo.txt",
    ).replace("\\", "/") == str(
        resolver_root / "userdata" / "analysis_prompt" / "demo.txt"
    ).replace("\\", "/")

    with pytest.raises(ValueError, match="invalid virtual preset id"):
        PromptPathResolver.split_virtual_id("demo")

    with pytest.raises(ValueError, match="invalid virtual preset id"):
        PromptPathResolver.split_virtual_id("builtin:demo.md")


def test_user_preset_round_trip_supports_save_read_rename_delete(
    resolver_root: Path,
) -> None:
    user_dir = resolver_root / "userdata" / "translation_prompt"
    saved_path = PromptPathResolver.save_user_preset(
        PromptPathResolver.TaskType.TRANSLATION,
        "  my preset  ",
        "  hello world  ",
    )

    assert saved_path.replace("\\", "/") == str(user_dir / "my preset.txt").replace(
        "\\",
        "/",
    )
    assert (
        PromptPathResolver.read_preset(
            PromptPathResolver.TaskType.TRANSLATION,
            "user:my preset.txt",
        )
        == "hello world"
    )

    renamed_item = PromptPathResolver.rename_user_preset(
        PromptPathResolver.TaskType.TRANSLATION,
        "user:my preset.txt",
        " renamed ",
    )
    assert renamed_item == {
        "name": "renamed",
        "file_name": "renamed.txt",
        "virtual_id": "user:renamed.txt",
        "path": str(user_dir / "renamed.txt").replace("\\", "/"),
        "type": "user",
    }

    deleted_path = PromptPathResolver.delete_user_preset(
        PromptPathResolver.TaskType.TRANSLATION,
        "user:renamed.txt",
    )
    assert deleted_path.replace("\\", "/") == str(user_dir / "renamed.txt").replace(
        "\\",
        "/",
    )
    assert not Path(deleted_path).exists()


def test_user_preset_round_trip_uses_data_dir_when_runtime_env_is_split(
    resolver_root: Path,
) -> None:
    data_dir = resolver_root / "portable_data"
    BasePath.APP_DIR = str(resolver_root)
    BasePath.DATA_DIR = str(data_dir)

    saved_path = PromptPathResolver.save_user_preset(
        PromptPathResolver.TaskType.TRANSLATION,
        "portable",
        "hello",
    )
    expected_path = data_dir / "userdata" / "translation_prompt" / "portable.txt"

    assert saved_path.replace("\\", "/") == str(expected_path).replace("\\", "/")
    assert (
        PromptPathResolver.read_preset(
            PromptPathResolver.TaskType.TRANSLATION,
            "user:portable.txt",
        )
        == "hello"
    )


def test_get_legacy_user_preset_dirs_returns_old_translation_dirs(
    resolver_root: Path,
) -> None:
    legacy_dirs = PromptPathResolver.get_legacy_user_preset_dirs()

    assert legacy_dirs == [
        str(resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "zh"),
        str(resolver_root / "resource" / "preset" / "custom_prompt" / "user" / "en"),
    ]
