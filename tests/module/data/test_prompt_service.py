from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock


from module.PromptPathResolver import PromptPathResolver
from module.Data.Quality.PromptService import PromptService


def build_service() -> tuple[PromptService, dict[str, object]]:
    """构造带内存态的 prompt 服务，方便验证快照与文件读写。"""

    meta_store: dict[str, object] = {}
    prompt_store: dict[str, object] = {
        "translation_prompt": "请翻译以下内容。",
        "translation_prompt_enable": True,
        "analysis_prompt": "请分析以下内容。",
        "analysis_prompt_enable": False,
    }

    def get_translation_prompt() -> str:
        return str(prompt_store["translation_prompt"])

    def set_translation_prompt(text: str) -> None:
        prompt_store["translation_prompt"] = text

    def get_translation_prompt_enable() -> bool:
        return bool(prompt_store["translation_prompt_enable"])

    def set_translation_prompt_enable(enable: bool) -> None:
        prompt_store["translation_prompt_enable"] = bool(enable)

    def get_analysis_prompt() -> str:
        return str(prompt_store["analysis_prompt"])

    def set_analysis_prompt(text: str) -> None:
        prompt_store["analysis_prompt"] = text

    def get_analysis_prompt_enable() -> bool:
        return bool(prompt_store["analysis_prompt_enable"])

    def set_analysis_prompt_enable(enable: bool) -> None:
        prompt_store["analysis_prompt_enable"] = bool(enable)

    quality_rule_service = SimpleNamespace(
        get_translation_prompt=MagicMock(side_effect=get_translation_prompt),
        set_translation_prompt=MagicMock(side_effect=set_translation_prompt),
        get_translation_prompt_enable=MagicMock(
            side_effect=get_translation_prompt_enable
        ),
        set_translation_prompt_enable=MagicMock(
            side_effect=set_translation_prompt_enable
        ),
        get_analysis_prompt=MagicMock(side_effect=get_analysis_prompt),
        set_analysis_prompt=MagicMock(side_effect=set_analysis_prompt),
        get_analysis_prompt_enable=MagicMock(side_effect=get_analysis_prompt_enable),
        set_analysis_prompt_enable=MagicMock(side_effect=set_analysis_prompt_enable),
    )
    meta_service = SimpleNamespace(
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
    )
    service = PromptService(quality_rule_service, meta_service)
    return service, meta_store


def test_prompt_snapshot_contains_text_meta_and_revision() -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("translation")] = 6

    snapshot = service.get_prompt_snapshot("translation")

    assert snapshot["task_type"] == "translation"
    assert snapshot["revision"] == 6
    assert snapshot["meta"]["enabled"] is True
    assert snapshot["text"] == "请翻译以下内容。"


def test_save_prompt_updates_text_enable_and_revision() -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("translation")] = 1

    result = service.save_prompt(
        "translation",
        expected_revision=1,
        text="新的翻译提示词。",
        enabled=False,
    )

    assert meta_store[service.build_revision_meta_key("translation")] == 2
    assert result["revision"] == 2
    assert result["meta"]["enabled"] is False
    assert result["text"] == "新的翻译提示词。"


def test_import_and_export_prompt_round_trip(tmp_path: Path) -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("analysis")] = 0
    input_path = tmp_path / "analysis.txt"
    output_path = tmp_path / "analysis-export.txt"
    input_path.write_text("导入的分析提示词", encoding="utf-8")

    exported_path = service.export_prompt("analysis", output_path)
    imported_snapshot = service.import_prompt(
        "analysis",
        input_path,
        expected_revision=0,
        enabled=True,
    )

    assert exported_path == output_path.as_posix()
    assert output_path.read_text(encoding="utf-8") == "请分析以下内容。"
    assert imported_snapshot["text"] == "导入的分析提示词"
    assert imported_snapshot["meta"]["enabled"] is True


def test_prompt_preset_helpers_delegate_to_resolver(monkeypatch) -> None:
    service, _meta_store = build_service()
    monkeypatch.setattr(
        PromptPathResolver, "list_presets", lambda task_type: (["builtin"], ["user"])
    )

    assert service.list_presets("translation") == (["builtin"], ["user"])
