from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from module.Data.Quality.PromptService import PromptService
from module.Data.Quality.QualityRuleFacadeService import (
    QualityRuleFacadeService,
)
from module.PromptPathResolver import PromptPathResolver


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
        session=SimpleNamespace(state_lock=threading.RLock()),
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
    )
    service = PromptService(quality_rule_service, meta_service)
    return service, meta_store


class RecordingLock:
    """记录是否进入临界区，验证 revision 流程没有裸窗口。"""

    def __init__(self) -> None:
        self.events: list[str] = []

    def __enter__(self) -> RecordingLock:
        self.events.append("enter")
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        self.events.append("exit")
        return False


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


def test_import_prompt_strips_bom_and_trailing_newline(tmp_path: Path) -> None:
    service, meta_store = build_service()
    meta_store[service.build_revision_meta_key("analysis")] = 0
    input_path = tmp_path / "analysis-import.txt"
    input_path.write_bytes("\ufeff  导入的分析提示词  \r\n".encode("utf-8"))

    imported_snapshot = service.import_prompt(
        "analysis",
        input_path,
        expected_revision=0,
        enabled=True,
    )

    assert imported_snapshot["text"] == "导入的分析提示词"


def test_export_prompt_adds_txt_suffix_and_strips_text(tmp_path: Path) -> None:
    service, _meta_store = build_service()
    service.quality_rule_service.get_analysis_prompt = MagicMock(
        return_value="  导出的分析提示词  \n"
    )
    output_path = tmp_path / "analysis-export"

    exported_path = service.export_prompt("analysis", output_path)

    assert exported_path.endswith(".txt")
    assert Path(exported_path).read_text(encoding="utf-8") == "导出的分析提示词"
    assert not output_path.exists()


def test_save_prompt_uses_session_lock_for_revision_window() -> None:
    lock = RecordingLock()
    service, meta_store = build_service()
    service.meta_service.session.state_lock = lock
    meta_store[service.build_revision_meta_key("translation")] = 0

    service.save_prompt(
        "translation",
        expected_revision=0,
        text="新的翻译提示词。",
        enabled=True,
    )

    assert lock.events == ["enter", "exit"]


def test_prompt_preset_helpers_delegate_to_resolver(monkeypatch) -> None:
    service, _meta_store = build_service()
    call_log: list[tuple[object, ...]] = []

    monkeypatch.setattr(
        PromptPathResolver,
        "list_presets",
        lambda task_type: (
            call_log.append(("list", task_type)) or (["builtin"], ["user"])
        ),
    )
    monkeypatch.setattr(
        PromptPathResolver,
        "read_preset",
        lambda task_type, virtual_id: (
            call_log.append(("read", task_type, virtual_id)) or "读取结果"
        ),
    )
    monkeypatch.setattr(
        PromptPathResolver,
        "save_user_preset",
        lambda task_type, name, text: (
            call_log.append(("save", task_type, name, text)) or "/tmp/preset.txt"
        ),
    )
    monkeypatch.setattr(
        PromptPathResolver,
        "rename_user_preset",
        lambda task_type, virtual_id, new_name: (
            call_log.append(("rename", task_type, virtual_id, new_name))
            or {"name": new_name, "virtual_id": virtual_id}
        ),
    )
    monkeypatch.setattr(
        PromptPathResolver,
        "delete_user_preset",
        lambda task_type, virtual_id: (
            call_log.append(("delete", task_type, virtual_id)) or "/tmp/deleted.txt"
        ),
    )
    monkeypatch.setattr(
        PromptPathResolver,
        "get_default_preset_text",
        lambda task_type, virtual_id: (
            call_log.append(("default", task_type, virtual_id)) or "默认预设"
        ),
    )

    assert service.list_presets("translation") == (["builtin"], ["user"])
    assert service.read_preset("translation", "builtin:sample.txt") == "读取结果"
    assert service.save_user_preset("analysis", "新预设", "文本") == "/tmp/preset.txt"
    assert service.rename_user_preset(
        "analysis",
        "user:old.txt",
        "新名字",
    ) == {"name": "新名字", "virtual_id": "user:old.txt"}
    assert service.delete_user_preset("analysis", "user:old.txt") == "/tmp/deleted.txt"
    assert (
        service.get_default_preset_text("translation", "builtin:default.txt")
        == "默认预设"
    )
    assert call_log == [
        ("list", PromptPathResolver.TaskType.TRANSLATION),
        ("read", PromptPathResolver.TaskType.TRANSLATION, "builtin:sample.txt"),
        ("save", PromptPathResolver.TaskType.ANALYSIS, "新预设", "文本"),
        ("rename", PromptPathResolver.TaskType.ANALYSIS, "user:old.txt", "新名字"),
        ("delete", PromptPathResolver.TaskType.ANALYSIS, "user:old.txt"),
        (
            "default",
            PromptPathResolver.TaskType.TRANSLATION,
            "builtin:default.txt",
        ),
    ]


def test_facade_forwards_preset_and_prompt_methods() -> None:
    facade = QualityRuleFacadeService(SimpleNamespace(), SimpleNamespace())
    facade.preset_service = SimpleNamespace(
        list_presets=MagicMock(return_value=(["builtin"], ["user"])),
        read_preset=MagicMock(return_value="预设内容"),
        save_user_preset=MagicMock(return_value="/tmp/preset.txt"),
        rename_user_preset=MagicMock(return_value={"name": "新名字"}),
        delete_user_preset=MagicMock(return_value="/tmp/deleted.txt"),
    )
    facade.prompt_service = SimpleNamespace(
        get_prompt_snapshot=MagicMock(return_value={"task_type": "translation"}),
        save_prompt=MagicMock(return_value={"task_type": "translation"}),
        get_default_preset_text=MagicMock(return_value="默认预设"),
    )

    assert facade.list_presets("translation") == (["builtin"], ["user"])
    assert facade.read_preset("translation", "builtin:sample.txt") == "预设内容"
    assert facade.save_user_preset("translation", "新预设", "文本") == "/tmp/preset.txt"
    assert facade.rename_user_preset(
        "translation",
        "user:old.txt",
        "新名字",
    ) == {"name": "新名字"}
    assert (
        facade.delete_user_preset("translation", "user:old.txt") == "/tmp/deleted.txt"
    )
    assert (
        facade.get_default_preset_text("translation", "builtin:default.txt")
        == "默认预设"
    )
    assert facade.get_prompt_snapshot("translation") == {"task_type": "translation"}
    assert facade.save_prompt(
        "translation",
        expected_revision=0,
        text="新内容",
        enabled=True,
    ) == {"task_type": "translation"}
    assert (
        facade.get_default_preset_text("translation", "builtin:default.txt")
        == "默认预设"
    )
