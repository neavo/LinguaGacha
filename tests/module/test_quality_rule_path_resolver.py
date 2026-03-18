from pathlib import Path

import pytest

from base.BaseBrand import BaseBrand
from base.BasePath import BasePath
from module.QualityRulePathResolver import QualityRulePathResolver


@pytest.fixture(autouse=True)
def reset_quality_rule_path_resolver() -> None:
    BasePath.reset_for_test()


@pytest.fixture
def resolver_root(fs, monkeypatch: pytest.MonkeyPatch) -> Path:
    del fs
    root = Path("/workspace/quality_rule_resolver")
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(str(root))
    BasePath.initialize(str(root), BaseBrand.get("lg"), False)
    return root


def test_list_presets_returns_flat_user_dir_and_builtin_virtual_ids(
    resolver_root: Path,
) -> None:
    builtin_dir = resolver_root / "resource" / "glossary" / "preset"
    user_dir = resolver_root / "userdata" / "glossary"
    builtin_dir.mkdir(parents=True, exist_ok=True)
    user_dir.mkdir(parents=True, exist_ok=True)

    (builtin_dir / "01_demo.json").write_text("[]", encoding="utf-8")
    (user_dir / "mine.json").write_text("[]", encoding="utf-8")

    builtin_items, user_items = QualityRulePathResolver.list_presets("glossary")

    assert builtin_items == [
        {
            "name": "01_demo",
            "file_name": "01_demo.json",
            "virtual_id": "builtin:01_demo.json",
            "path": "resource/glossary/preset/01_demo.json",
            "type": "builtin",
        }
    ]
    assert user_items == [
        {
            "name": "mine",
            "file_name": "mine.json",
            "virtual_id": "user:mine.json",
            "path": str(user_dir / "mine.json").replace("\\", "/"),
            "type": "user",
        }
    ]


def test_virtual_id_helpers_validate_and_resolve_paths(
    resolver_root: Path,
) -> None:
    assert (
        QualityRulePathResolver.build_virtual_id(
            QualityRulePathResolver.PresetSource.BUILTIN,
            "demo.json",
        )
        == "builtin:demo.json"
    )
    assert QualityRulePathResolver.split_virtual_id("user:mine.json") == (
        QualityRulePathResolver.PresetSource.USER,
        "mine.json",
    )
    assert QualityRulePathResolver.resolve_virtual_id_path(
        "glossary",
        "builtin:demo.json",
    ).replace("\\", "/") == str(
        resolver_root / "resource" / "glossary" / "preset" / "demo.json"
    ).replace("\\", "/")

    assert QualityRulePathResolver.split_virtual_id("builtin:zh:demo.json") == (
        QualityRulePathResolver.PresetSource.BUILTIN,
        "demo.json",
    )


def test_user_preset_round_trip_supports_save_read_rename_delete(
    resolver_root: Path,
) -> None:
    user_dir = resolver_root / "userdata" / "glossary"

    saved_item = QualityRulePathResolver.save_user_preset(
        "glossary",
        "  my preset  ",
        [{"src": "HP", "dst": "生命值"}],
    )

    assert saved_item == {
        "name": "my preset",
        "file_name": "my preset.json",
        "virtual_id": "user:my preset.json",
        "path": str(user_dir / "my preset.json").replace("\\", "/"),
        "type": "user",
    }
    assert QualityRulePathResolver.read_preset(
        "glossary",
        "user:my preset.json",
    ) == [{"src": "HP", "dst": "生命值"}]

    renamed_item = QualityRulePathResolver.rename_user_preset(
        "glossary",
        "user:my preset.json",
        " renamed ",
    )
    assert renamed_item["virtual_id"] == "user:renamed.json"

    deleted_path = QualityRulePathResolver.delete_user_preset(
        "glossary",
        "user:renamed.json",
    )
    assert deleted_path.replace("\\", "/") == str(user_dir / "renamed.json").replace(
        "\\",
        "/",
    )


def test_user_preset_uses_runtime_data_dir_when_split(
    resolver_root: Path,
) -> None:
    data_dir = resolver_root / "portable_data"
    BasePath.APP_DIR = str(resolver_root)
    BasePath.DATA_DIR = str(data_dir)

    saved_item = QualityRulePathResolver.save_user_preset(
        "glossary",
        "portable",
        [{"src": "A", "dst": "甲"}],
    )

    assert saved_item["path"].replace("\\", "/") == str(
        data_dir / "userdata" / "glossary" / "portable.json"
    ).replace("\\", "/")
