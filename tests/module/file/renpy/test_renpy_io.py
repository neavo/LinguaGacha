from __future__ import annotations

import sys
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.RenPy.RenPy import RenPy
from tests.module.file.conftest import DummyDataManager


def test_read_from_stream_uses_parser_and_extractor(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = RenPy(config)
    renpy_module = sys.modules[RenPy.__module__]

    monkeypatch.setattr(renpy_module.TextHelper, "get_encoding", lambda **_: "utf-8")

    expected_doc = {"kind": "doc"}
    monkeypatch.setattr(renpy_module, "parse_document", lambda lines: expected_doc)

    class DummyExtractor:
        def extract(self, doc: dict, rel_path: str) -> list[Item]:
            assert doc is expected_doc
            assert rel_path == "script/a.rpy"
            return [Item.from_dict({"src": "ok"})]

    monkeypatch.setattr(renpy_module, "RenPyExtractor", DummyExtractor)

    items = handler.read_from_stream(b"line1\nline2", "script/a.rpy")

    assert [item.get_src() for item in items] == ["ok"]


def test_read_from_path_reads_files_and_builds_rel_paths(
    config: Config,
    fs,
) -> None:
    del fs
    handler = RenPy(config)
    input_root = Path("/workspace/renpy")
    file_a = input_root / "a.rpy"
    file_b = input_root / "sub" / "b.rpy"
    file_b.parent.mkdir(parents=True, exist_ok=True)
    file_a.write_text("A", encoding="utf-8")
    file_b.write_text("B", encoding="utf-8")

    called: list[str] = []

    def fake_read_from_stream(content: bytes, rel_path: str) -> list[Item]:
        del content
        called.append(rel_path.replace("\\", "/"))
        return [Item.from_dict({"src": rel_path})]

    handler.read_from_stream = fake_read_from_stream
    items = handler.read_from_path([str(file_a), str(file_b)], str(input_root))

    assert sorted(called) == ["a.rpy", "sub/b.rpy"]
    assert len(items) == 2


def test_write_to_path_logs_skipped_and_writes_output(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.write_translated_name_fields_to_file = False
    handler = RenPy(config)
    renpy_module = sys.modules[RenPy.__module__]

    monkeypatch.setattr(renpy_module.DataManager, "get", lambda: dummy_data_manager)
    monkeypatch.setattr(renpy_module.TextHelper, "get_encoding", lambda **_: "utf-8")

    warning_messages: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, console: bool = False) -> None:
            del console
            warning_messages.append(msg)

    monkeypatch.setattr(renpy_module.LogManager, "get", lambda: DummyLogger())

    observed_name_dst: list[str | list[str] | None] = []

    class DummyWriter:
        def apply_items_to_lines(
            self,
            lines: list[str],
            items_to_apply: list[Item],
        ) -> tuple[int, int]:
            observed_name_dst.append(items_to_apply[0].get_name_dst())
            lines[-1] = '    e "patched"'
            return 1, 1

    monkeypatch.setattr(renpy_module, "RenPyWriter", DummyWriter)

    rel_path = "script/a.rpy"
    dummy_data_manager.assets[rel_path] = b'translate chinese start:\n    e "old"'
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "name_src": "Alice",
            "name_dst": "Alicia",
            "file_type": Item.FileType.RENPY,
            "file_path": rel_path,
            "extra_field": {
                "renpy": {
                    "pair": {"target_line": 2},
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "a",
                    },
                }
            },
        }
    )

    handler.write_to_path([item])

    out_file = Path(dummy_data_manager.get_translated_path()) / rel_path
    assert out_file.exists()
    assert (
        out_file.read_text(encoding="utf-8")
        == 'translate chinese start:\n    e "patched"'
    )
    assert observed_name_dst == ["Alice"]
    assert len(warning_messages) == 1
    assert "RENPY 导出写回跳过 1 条" in warning_messages[0]


def test_write_to_path_uniform_name_when_config_enabled_and_no_skipped(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.write_translated_name_fields_to_file = True
    handler = RenPy(config)
    renpy_module = sys.modules[RenPy.__module__]

    monkeypatch.setattr(renpy_module.DataManager, "get", lambda: dummy_data_manager)
    monkeypatch.setattr(renpy_module.TextHelper, "get_encoding", lambda **_: "utf-8")

    warning_messages: list[str] = []

    class DummyLogger:
        def warning(self, msg: str, console: bool = False) -> None:
            del console
            warning_messages.append(msg)

    monkeypatch.setattr(renpy_module.LogManager, "get", lambda: DummyLogger())

    observed_name_dst: list[str | list[str] | None] = []

    class DummyWriter:
        def apply_items_to_lines(
            self,
            lines: list[str],
            items_to_apply: list[Item],
        ) -> tuple[int, int]:
            observed_name_dst.append(items_to_apply[0].get_name_dst())
            lines[-1] = '    e "patched"'
            return 1, 0

    monkeypatch.setattr(renpy_module, "RenPyWriter", DummyWriter)

    rel_path = "script/a.rpy"
    dummy_data_manager.assets[rel_path] = b'translate chinese start:\n    e "old"'
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "name_src": "Alice",
            "name_dst": "Alicia",
            "file_type": Item.FileType.RENPY,
            "file_path": rel_path,
            "extra_field": {
                "renpy": {
                    "pair": {"target_line": 2},
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "a",
                    },
                }
            },
        }
    )

    handler.write_to_path([item])

    out_file = Path(dummy_data_manager.get_translated_path()) / rel_path
    assert out_file.exists()
    assert observed_name_dst == ["Alicia"]
    assert warning_messages == []


def test_write_to_path_skips_when_original_asset_missing(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = RenPy(config)
    renpy_module = sys.modules[RenPy.__module__]
    monkeypatch.setattr(renpy_module.DataManager, "get", lambda: dummy_data_manager)

    rel_path = "script/missing.rpy"
    item = Item.from_dict(
        {
            "src": "old",
            "dst": "new",
            "file_type": Item.FileType.RENPY,
            "file_path": rel_path,
            "extra_field": {
                "renpy": {
                    "pair": {"target_line": 2},
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "a",
                    },
                }
            },
        }
    )

    handler.write_to_path([item])

    out_file = Path(dummy_data_manager.get_translated_path()) / rel_path
    assert out_file.exists() is False


def test_build_items_for_writeback_mixed_mode_revert_and_uniform(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = RenPy(config)
    renpy_module = sys.modules[RenPy.__module__]

    parsed_marker = {"parsed": True}
    monkeypatch.setattr(renpy_module, "parse_document", lambda lines: parsed_marker)

    class DummyExtractor:
        def __init__(self, items_to_return: list[Item]) -> None:
            self.items_to_return = items_to_return

        def extract(self, doc: dict, rel_path: str) -> list[Item]:
            assert doc is parsed_marker
            assert rel_path == "script/a.rpy"
            return self.items_to_return

    legacy_items = [Item.from_dict({"extra_field": "legacy", "row": 1})]

    reverted = [Item.from_dict({"name_src": "Hero", "name_dst": "勇者"})]
    config.write_translated_name_fields_to_file = False
    result_revert = handler.build_items_for_writeback(
        extractor=DummyExtractor(reverted),
        rel_path="script/a.rpy",
        lines=["translate chinese start:"],
        items=legacy_items,
    )
    assert result_revert[0].get_name_dst() == "Hero"

    unified = [Item.from_dict({"name_src": "Hero", "name_dst": "勇者"})]
    config.write_translated_name_fields_to_file = True

    def fake_uniform_name(items_to_update: list[Item]) -> None:
        for v in items_to_update:
            v.set_name_dst("统一")

    handler.uniform_name = fake_uniform_name
    result_uniform = handler.build_items_for_writeback(
        extractor=DummyExtractor(unified),
        rel_path="script/a.rpy",
        lines=["translate chinese start:"],
        items=legacy_items,
    )
    assert result_uniform[0].get_name_dst() == "统一"
