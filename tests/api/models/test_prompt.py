from api.Models.Prompt import CustomPromptSnapshot
from api.Models.Prompt import PromptPresetEntry


def test_custom_prompt_snapshot_from_dict_preserves_enable_and_text_fields() -> None:
    snapshot = CustomPromptSnapshot.from_dict(
        {
            "translation_prompt_enable": True,
            "translation_prompt": "translation",
            "analysis_prompt_enable": False,
            "analysis_prompt": "analysis",
        }
    )

    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "translation"
    assert snapshot.analysis_prompt_enable is False
    assert snapshot.analysis_prompt == "analysis"


def test_prompt_preset_entry_from_dict_keeps_identity_fields() -> None:
    entry = PromptPresetEntry.from_dict(
        {
            "name": "默认",
            "file_name": "base.txt",
            "virtual_id": "builtin:base.txt",
            "path": "resource/base.txt",
            "type": "builtin",
        }
    )

    assert entry.name == "默认"
    assert entry.file_name == "base.txt"
    assert entry.virtual_id == "builtin:base.txt"
    assert entry.path == "resource/base.txt"
    assert entry.type == "builtin"


def test_prompt_preset_entry_from_dict_ignores_source_compat_field() -> None:
    entry = PromptPresetEntry.from_dict(
        {
            "name": "默认",
            "file_name": "base.txt",
            "virtual_id": "builtin:base.txt",
            "path": "resource/base.txt",
            "source": "builtin",
        }
    )

    assert entry.name == "默认"
    assert entry.file_name == "base.txt"
    assert entry.virtual_id == "builtin:base.txt"
    assert entry.path == "resource/base.txt"
    assert entry.type == ""

    payload = entry.to_dict()

    assert "source" not in payload
