import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.CLIManager import CLIManager


def test_build_quality_snapshot_for_cli_uses_translation_custom_prompt(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager")
    prompt_path = root / "translation.txt"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("统一翻译提示词", encoding="utf-8")

    monkeypatch.chdir(str(root))

    snapshot = CLIManager().build_quality_snapshot_for_cli(
        glossary_path=None,
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=str(prompt_path),
        analysis_custom_prompt_path=None,
        custom_prompt_zh_path=None,
        custom_prompt_en_path=None,
    )

    assert snapshot is not None
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "统一翻译提示词"
    assert snapshot.analysis_prompt_enable is False


def test_build_quality_snapshot_for_cli_translation_prompt_uses_legacy_priority(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_legacy_priority")
    translation_path = root / "translation.txt"
    zh_path = root / "zh.txt"
    en_path = root / "en.txt"
    translation_path.parent.mkdir(parents=True, exist_ok=True)
    translation_path.write_text("新参数翻译提示词", encoding="utf-8")
    zh_path.write_text("旧中文提示词", encoding="utf-8")
    en_path.write_text("Old English prompt", encoding="utf-8")

    monkeypatch.chdir(str(root))

    snapshot = CLIManager().build_quality_snapshot_for_cli(
        glossary_path=None,
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=str(translation_path),
        analysis_custom_prompt_path=None,
        custom_prompt_zh_path=str(zh_path),
        custom_prompt_en_path=str(en_path),
    )

    assert snapshot is not None
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "新参数翻译提示词"


def test_build_quality_snapshot_for_cli_translation_prompt_falls_back_to_legacy_zh(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_legacy_zh")
    zh_path = root / "zh.txt"
    en_path = root / "en.txt"
    zh_path.parent.mkdir(parents=True, exist_ok=True)
    zh_path.write_text("旧中文提示词", encoding="utf-8")
    en_path.write_text("Old English prompt", encoding="utf-8")

    monkeypatch.chdir(str(root))

    snapshot = CLIManager().build_quality_snapshot_for_cli(
        glossary_path=None,
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=None,
        analysis_custom_prompt_path=None,
        custom_prompt_zh_path=str(zh_path),
        custom_prompt_en_path=str(en_path),
    )

    assert snapshot is not None
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "旧中文提示词"


def test_build_quality_snapshot_for_cli_translation_prompt_falls_back_to_legacy_en(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_legacy_en")
    en_path = root / "en.txt"
    en_path.parent.mkdir(parents=True, exist_ok=True)
    en_path.write_text("Old English prompt", encoding="utf-8")

    monkeypatch.chdir(str(root))

    snapshot = CLIManager().build_quality_snapshot_for_cli(
        glossary_path=None,
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=None,
        analysis_custom_prompt_path=None,
        custom_prompt_zh_path=None,
        custom_prompt_en_path=str(en_path),
    )

    assert snapshot is not None
    assert snapshot.translation_prompt_enable is True
    assert snapshot.translation_prompt == "Old English prompt"


def test_build_quality_snapshot_for_cli_maps_analysis_prompt_to_analysis_field(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_analysis")
    prompt_path = root / "analysis.txt"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text("统一分析提示词", encoding="utf-8")

    monkeypatch.chdir(str(root))

    snapshot = CLIManager().build_quality_snapshot_for_cli(
        glossary_path=None,
        pre_replacement_path=None,
        post_replacement_path=None,
        text_preserve_path=None,
        text_preserve_mode_arg=None,
        translation_custom_prompt_path=None,
        analysis_custom_prompt_path=str(prompt_path),
        custom_prompt_zh_path=None,
        custom_prompt_en_path=None,
    )

    assert snapshot is not None
    assert snapshot.translation_prompt_enable is False
    assert snapshot.analysis_prompt_enable is True
    assert snapshot.analysis_prompt == "统一分析提示词"


def test_build_quality_snapshot_for_cli_raises_when_translation_prompt_missing(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_missing_translation")
    root.mkdir(parents=True, exist_ok=True)
    missing_path = root / "missing.txt"

    monkeypatch.chdir(str(root))

    with pytest.raises(ValueError, match="规则文件不存在"):
        CLIManager().build_quality_snapshot_for_cli(
            glossary_path=None,
            pre_replacement_path=None,
            post_replacement_path=None,
            text_preserve_path=None,
            text_preserve_mode_arg=None,
            translation_custom_prompt_path=str(missing_path),
            analysis_custom_prompt_path=None,
            custom_prompt_zh_path=None,
            custom_prompt_en_path=None,
        )


def test_build_quality_snapshot_for_cli_raises_when_text_preserve_mode_invalid(
    fs, monkeypatch
) -> None:
    del fs
    root = Path("/workspace/cli_manager_invalid_text_preserve")
    root.mkdir(parents=True, exist_ok=True)

    monkeypatch.chdir(str(root))

    with pytest.raises(ValueError, match="文本保护参数组合无效"):
        CLIManager().build_quality_snapshot_for_cli(
            glossary_path=None,
            pre_replacement_path=None,
            post_replacement_path=None,
            text_preserve_path=str(root / "demo.json"),
            text_preserve_mode_arg="off",
            translation_custom_prompt_path=None,
            analysis_custom_prompt_path=None,
            custom_prompt_zh_path=None,
            custom_prompt_en_path=None,
        )


def test_run_logs_once_and_exits_when_quality_snapshot_build_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_path = "/workspace/cli_run/project.lg"
    logger = MagicMock()
    manager = CLIManager()
    fake_dm = SimpleNamespace(
        load_project=MagicMock(),
        get_project_status=MagicMock(),
        is_prefilter_needed=MagicMock(return_value=False),
        run_project_prefilter=MagicMock(),
    )

    monkeypatch.setattr(
        sys,
        "argv",
        ["cli_manager", "--cli", "--project", project_path],
    )
    monkeypatch.setattr(
        "base.CLIManager.os.path.exists", lambda path: path == project_path
    )
    monkeypatch.setattr("base.CLIManager.LogManager.get", lambda: logger)
    monkeypatch.setattr("base.CLIManager.DataManager.get", lambda: fake_dm)
    monkeypatch.setattr(
        manager,
        "build_quality_snapshot_for_cli",
        MagicMock(side_effect=ValueError("参数发生错误")),
    )
    monkeypatch.setattr(manager, "exit", MagicMock())

    assert manager.run() is True
    logger.error.assert_called_once_with("参数发生错误")
    manager.exit.assert_called_once()


def test_run_help_mentions_translation_prompt_deprecation(monkeypatch, capsys) -> None:
    monkeypatch.setattr(sys, "argv", ["cli_manager", "--help"])

    with pytest.raises(SystemExit):
        CLIManager().run()

    captured = capsys.readouterr()

    assert "--translation_custom_prompt" in captured.out
    assert "--analysis_custom_prompt" in captured.out
    assert "Deprecated:" in captured.out
    assert "--custom_analysis_prompt_zh" not in captured.out
    assert "--custom_analysis_prompt_en" not in captured.out
