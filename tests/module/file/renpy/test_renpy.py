from __future__ import annotations

from model.Item import Item

from module.Config import Config

from module.File.RenPy.RenPy import RenPy

import sys

from pathlib import Path

import pytest

from tests.module.file.conftest import DummyDataManager

from module.File.RenPy.RenPyExtractor import RenPyExtractor

from module.File.RenPy.RenPyLexer import sha1_hex


def test_has_ast_extra_field_and_get_item_target_line(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "pair": {"target_line": 12},
                }
            }
        }
    )

    assert handler.has_ast_extra_field(item) is True
    assert handler.get_item_target_line(item) == 12
    assert handler.get_item_target_line(Item.from_dict({"extra_field": "legacy"})) == 0


def test_build_ast_keys_and_parse_translate_header(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "b",
                    },
                }
            }
        }
    )

    assert handler.build_ast_keys(item) == [
        ("chinese", "start", "a"),
        ("chinese", "start", "b"),
    ]
    assert handler.parse_translate_header("translate chinese start:") == (
        "chinese",
        "start",
    )
    assert handler.parse_translate_header("invalid") is None


def test_build_ast_keys_returns_empty_for_invalid_extra_field(config: Config) -> None:
    handler = RenPy(config)

    assert handler.build_ast_keys(Item.from_dict({"extra_field": "legacy"})) == []
    assert handler.build_ast_keys(Item.from_dict({"extra_field": {"renpy": "x"}})) == []
    assert (
        handler.build_ast_keys(
            Item.from_dict({"extra_field": {"renpy": {"block": None}}})
        )
        == []
    )


def test_build_ast_keys_deduplicates_fallback_when_same_as_primary(
    config: Config,
) -> None:
    handler = RenPy(config)
    item = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "a",
                    },
                }
            }
        }
    )

    assert handler.build_ast_keys(item) == [("chinese", "start", "a")]


def test_pick_best_candidate_prefers_src_and_name(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello", "name_src": "Alice"})
    candidates = [
        Item.from_dict({"src": "Hello", "name_src": "Bob", "dst": "B"}),
        Item.from_dict({"src": "Hello", "name_src": "Alice", "dst": "A"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "A"
    assert len(candidates) == 1


def test_pick_best_candidate_falls_back_to_src_match(config: Config) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello", "name_src": "Alice"})
    candidates = [
        Item.from_dict({"src": "Hello", "name_src": "Bob", "dst": "B"}),
        Item.from_dict({"src": "Other", "name_src": "Alice", "dst": "X"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "B"
    assert len(candidates) == 1


def test_pick_best_candidate_falls_back_to_first_candidate_when_no_match(
    config: Config,
) -> None:
    handler = RenPy(config)
    item = Item.from_dict({"src": "Hello"})
    candidates = [
        Item.from_dict({"src": "Other", "dst": "X"}),
        Item.from_dict({"src": "Another", "dst": "Y"}),
    ]

    picked = handler.pick_best_candidate(item, candidates)

    assert picked.get_dst() == "X"
    assert len(candidates) == 1


def test_uniform_name_and_revert_name(config: Config) -> None:
    handler = RenPy(config)
    items = [
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
        Item.from_dict({"name_src": "hero", "name_dst": "英雄"}),
        Item.from_dict({"name_src": "hero", "name_dst": "勇者"}),
    ]

    handler.uniform_name(items)
    assert [item.get_name_dst() for item in items] == ["勇者", "勇者", "勇者"]

    handler.revert_name(items)
    assert [item.get_name_dst() for item in items] == ["hero", "hero", "hero"]


def test_uniform_name_handles_list_names_and_skips_invalid(config: Config) -> None:
    handler = RenPy(config)
    items = [
        Item.from_dict({"name_src": ["hero", "villain"], "name_dst": ["勇者", "反派"]}),
        Item.from_dict({"name_src": None, "name_dst": "x"}),
        Item.from_dict({"name_src": "hero", "name_dst": None}),
    ]

    handler.uniform_name(items)

    assert items[0].get_name_dst() == ["勇者", "反派"]
    assert items[1].get_name_dst() == "x"
    assert items[2].get_name_dst() == "勇者"


def test_build_ast_keys_supports_fallback_only_and_invalid_lang_label(
    config: Config,
) -> None:
    handler = RenPy(config)
    fallback_only = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": "chinese", "label": "start"},
                    "digest": {
                        "template_raw_sha1": None,
                        "template_raw_rstrip_sha1": "fb",
                    },
                }
            }
        }
    )
    invalid_lang = Item.from_dict(
        {
            "extra_field": {
                "renpy": {
                    "block": {"lang": 1, "label": "start"},
                    "digest": {
                        "template_raw_sha1": "a",
                        "template_raw_rstrip_sha1": "b",
                    },
                }
            }
        }
    )

    assert handler.build_ast_keys(fallback_only) == [("chinese", "start", "fb")]
    assert handler.build_ast_keys(invalid_lang) == []


def test_transfer_ast_translations_skips_existing_item_without_keys(
    config: Config,
) -> None:
    handler = RenPy(config)
    existing = [
        Item.from_dict(
            {
                "extra_field": {
                    "renpy": {
                        "block": {},
                        "digest": {},
                    }
                }
            }
        )
    ]
    new_items = [
        Item.from_dict(
            {
                "src": "hello",
                "dst": "",
                "extra_field": {
                    "renpy": {
                        "block": {"lang": "chinese", "label": "start"},
                        "pair": {"target_line": 10},
                        "digest": {
                            "template_raw_sha1": "a",
                            "template_raw_rstrip_sha1": "a",
                        },
                    }
                },
            }
        )
    ]

    written = handler.transfer_ast_translations(existing, new_items)

    assert written == set()
    assert new_items[0].get_dst() == ""


def test_revert_name_and_uniform_name_skip_non_supported_name_types(
    config: Config,
) -> None:
    handler = RenPy(config)
    items = [
        Item.from_dict({"name_src": None, "name_dst": "keep-none"}),
        Item.from_dict({"name_src": ("hero",), "name_dst": ("keep-tuple",)}),
    ]

    handler.revert_name(items)
    handler.uniform_name(items)

    assert items[0].get_name_dst() == "keep-none"
    assert items[1].get_name_dst() == ("hero",)


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


def make_ast_item(
    *,
    lang: str,
    label: str,
    digest: str,
    target_line: int,
    src: str,
    dst: str,
    name_src: str | None = None,
    name_dst: str | None = None,
) -> Item:
    return Item.from_dict(
        {
            "src": src,
            "dst": dst,
            "name_src": name_src,
            "name_dst": name_dst,
            "extra_field": {
                "renpy": {
                    "block": {"lang": lang, "label": label},
                    "pair": {"target_line": target_line},
                    "digest": {
                        "template_raw_sha1": digest,
                        "template_raw_rstrip_sha1": digest,
                    },
                }
            },
        }
    )


def test_transfer_ast_translations_transfers_dst_and_name(config: Config) -> None:
    handler = RenPy(config)
    digest = "abc"
    existing = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=10,
            src="hello",
            dst="你好",
            name_src="Alice",
            name_dst="艾丽丝",
        )
    ]
    new_items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=99,
            src="hello",
            dst="",
            name_src="Alice",
            name_dst=None,
        )
    ]

    written_lines = handler.transfer_ast_translations(existing, new_items)

    assert new_items[0].get_dst() == "你好"
    assert new_items[0].get_name_dst() == "艾丽丝"
    assert written_lines == {99}


def test_transfer_legacy_translations_respects_skip_target_lines(
    config: Config,
) -> None:
    handler = RenPy(config)
    legacy_raw = '    # e "Hello"'
    legacy_items = [
        Item.from_dict(
            {
                "row": 1,
                "src": "",
                "dst": "",
                "extra_field": "translate chinese start:",
            }
        ),
        Item.from_dict(
            {
                "row": 2,
                "src": "Hello",
                "dst": "你好",
                "name_dst": "艾丽丝",
                "extra_field": legacy_raw,
            }
        ),
    ]
    new_item = make_ast_item(
        lang="chinese",
        label="start",
        digest=sha1_hex(legacy_raw),
        target_line=15,
        src="Hello",
        dst="",
        name_src="Alice",
        name_dst=None,
    )

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines={15}
    )
    assert new_item.get_dst() == ""

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines=None
    )
    assert new_item.get_dst() == "你好"
    assert new_item.get_name_dst() == "艾丽丝"


def test_build_items_for_writeback_returns_items_directly_when_all_ast(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = RenPy(config)
    items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest="abc",
            target_line=1,
            src="x",
            dst="y",
        )
    ]

    monkeypatch.setattr(
        "module.File.RenPy.RenPy.parse_document",
        lambda lines: (_ for _ in ()).throw(AssertionError("should not be called")),
    )

    result = handler.build_items_for_writeback(
        extractor=RenPyExtractor(),
        rel_path="a.rpy",
        lines=["translate chinese start:"],
        items=items,
    )

    assert result is items


def test_transfer_legacy_translations_skips_non_string_extra_and_empty_src(
    config: Config,
) -> None:
    handler = RenPy(config)
    legacy_items = [
        Item.from_dict({"row": 1, "extra_field": "translate chinese start:"}),
        Item.from_dict({"row": 2, "extra_field": {"not": "str"}}),
        Item.from_dict({"row": 3, "src": "", "extra_field": '    # e "Hello"'}),
    ]
    new_item = make_ast_item(
        lang="chinese",
        label="start",
        digest="missing",
        target_line=10,
        src="Hello",
        dst="",
        name_src=None,
        name_dst=None,
    )

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines=None
    )
    assert new_item.get_dst() == ""


def test_transfer_legacy_translations_no_candidates_keeps_dst(
    config: Config,
) -> None:
    handler = RenPy(config)
    legacy_raw = '    # e "Hello"'
    legacy_items = [
        Item.from_dict({"row": 1, "extra_field": "translate chinese start:"}),
        Item.from_dict(
            {
                "row": 2,
                "src": "Hello",
                "dst": "你好",
                "extra_field": legacy_raw,
            }
        ),
    ]
    new_item = make_ast_item(
        lang="chinese",
        label="start",
        digest="different",
        target_line=10,
        src="Hello",
        dst="",
        name_src=None,
        name_dst=None,
    )

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines=None
    )
    assert new_item.get_dst() == ""


def test_transfer_legacy_translations_does_not_set_name_when_candidate_name_missing(
    config: Config,
) -> None:
    handler = RenPy(config)
    legacy_raw = '    # e "Hello"'
    legacy_items = [
        Item.from_dict({"row": 1, "extra_field": "translate chinese start:"}),
        Item.from_dict(
            {
                "row": 2,
                "src": "Hello",
                "dst": "你好",
                "name_dst": None,
                "extra_field": legacy_raw,
            }
        ),
    ]
    new_item = make_ast_item(
        lang="chinese",
        label="start",
        digest=sha1_hex(legacy_raw),
        target_line=10,
        src="Hello",
        dst="",
        name_src="Alice",
        name_dst=None,
    )

    handler.transfer_legacy_translations(
        legacy_items, [new_item], skip_target_lines=None
    )
    assert new_item.get_dst() == "你好"
    assert new_item.get_name_dst() is None


def test_transfer_ast_translations_no_candidates_keeps_dst_and_written_lines_empty(
    config: Config,
) -> None:
    handler = RenPy(config)
    existing = [Item.from_dict({"extra_field": "legacy"})]
    new_items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest="abc",
            target_line=10,
            src="hello",
            dst="",
        )
    ]

    written = handler.transfer_ast_translations(existing, new_items)
    assert new_items[0].get_dst() == ""
    assert written == set()


def test_transfer_ast_translations_does_not_add_written_line_when_target_line_zero(
    config: Config,
) -> None:
    handler = RenPy(config)
    digest = "abc"
    existing = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=10,
            src="hello",
            dst="你好",
            name_src="Alice",
            name_dst=None,
        )
    ]
    new_items = [
        make_ast_item(
            lang="chinese",
            label="start",
            digest=digest,
            target_line=0,
            src="hello",
            dst="",
            name_src="Alice",
            name_dst=None,
        )
    ]

    written = handler.transfer_ast_translations(existing, new_items)
    assert new_items[0].get_dst() == "你好"
    assert new_items[0].get_name_dst() is None
    assert written == set()
