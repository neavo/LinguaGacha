from __future__ import annotations

import json

import pytest

from base.Base import Base

from module.Config import Config

from module.File.TRANS.NONE import NONE

from module.File.TRANS.TRANS import TRANS

from pathlib import Path

from module.Data.Core.Item import Item

from tests.module.file.conftest import DummyDataManager


def test_get_processor_routes_by_game_engine(config: Config) -> None:
    handler = TRANS(config)

    assert handler.get_processor({"gameEngine": "kag"}).TEXT_TYPE == Item.TextType.KAG
    assert handler.get_processor({"gameEngine": "wolf"}).TEXT_TYPE == Item.TextType.WOLF
    assert (
        handler.get_processor({"gameEngine": "renpy"}).TEXT_TYPE == Item.TextType.RENPY
    )
    assert (
        handler.get_processor({"gameEngine": "rmmz"}).TEXT_TYPE
        == Item.TextType.RPGMAKER
    )
    assert (
        handler.get_processor({"gameEngine": "unknown"}).TEXT_TYPE == Item.TextType.NONE
    )


def test_read_from_stream_marks_duplicates_when_enabled(
    config: Config,
) -> None:
    handler = TRANS(config)
    config.deduplication_in_trans = True

    payload = {
        "project": {
            "gameEngine": "unknown",
            "files": {
                "script.json": {
                    "tags": [[], []],
                    "data": [["hello", ""], ["hello", ""]],
                    "context": [["ctx1"], ["ctx2"]],
                    "parameters": [[], []],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "sample.trans",
    )

    assert len(items) == 2
    assert items[0].get_status() == Base.ProjectStatus.NONE
    assert items[1].get_status() == Base.ProjectStatus.DUPLICATED
    assert items[0].get_text_type() == Item.TextType.NONE


def test_read_from_stream_does_not_mark_duplicates_when_disabled(
    config: Config,
) -> None:
    handler = TRANS(config)
    config.deduplication_in_trans = False

    payload = {
        "project": {
            "gameEngine": "unknown",
            "files": {
                "script.json": {
                    "tags": [[], []],
                    "data": [["hello", ""], ["hello", ""]],
                    "context": [[], []],
                    "parameters": [[], []],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "sample.trans",
    )

    assert len(items) == 2
    assert items[0].get_status() == Base.ProjectStatus.NONE
    assert items[1].get_status() == Base.ProjectStatus.NONE


def test_read_from_stream_returns_empty_for_invalid_shapes(
    config: Config,
) -> None:
    handler = TRANS(config)

    assert handler.read_from_stream(b"[]", "a.trans") == []

    assert (
        handler.read_from_stream(
            json.dumps({"project": {"files": []}}).encode("utf-8"),
            "a.trans",
        )
        == []
    )


def test_read_from_path_reads_files_and_builds_rel_path(
    config: Config,
    fs,
) -> None:
    del fs
    handler = TRANS(config)
    input_root = Path("/workspace/trans")
    file_a = input_root / "a.trans"
    file_b = input_root / "sub" / "b.trans"
    file_b.parent.mkdir(parents=True, exist_ok=True)
    file_a.write_text(
        json.dumps(
            {
                "project": {
                    "gameEngine": "unknown",
                    "files": {
                        "script/a.json": {
                            "tags": [[]],
                            "data": [["A", ""]],
                            "context": [[]],
                            "parameters": [[]],
                        }
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    file_b.write_text(
        json.dumps(
            {
                "project": {
                    "gameEngine": "unknown",
                    "files": {
                        "script/b.json": {
                            "tags": [[]],
                            "data": [["B", ""]],
                            "context": [[]],
                            "parameters": [[]],
                        }
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    items = handler.read_from_path([str(file_a), str(file_b)], str(input_root))

    observed = sorted(
        (item.get_file_path().replace("\\", "/"), item.get_src()) for item in items
    )
    assert observed == [("a.trans", "A"), ("sub/b.trans", "B")]


def test_read_from_stream_clamps_negative_column_indices(config: Config) -> None:
    handler = TRANS(config)

    # indexOriginal/indexTranslation 出现负数时，不应触发 Python 负索引取值。
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": -1,
            "indexTranslation": -2,
            "files": {
                "script/a.json": {
                    "tags": [[]],
                    "data": [["SRC", "DST"]],
                    "context": [[]],
                    "parameters": [[]],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        "negative.trans",
    )

    assert len(items) == 1
    assert items[0].get_src() == "SRC"
    assert items[0].get_dst() == "DST"


def test_read_from_stream_filters_metadata_and_builds_trans_ref(
    config: Config,
) -> None:
    handler = TRANS(config)
    rel_path = "meta.trans"
    file_key = "script/meta.json"

    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [["keep", 1, None]],
                    "data": [["src", ""]],
                    "context": [["ctx1", None, 2]],
                    "parameters": [[{"ok": True}, None, "bad"]],
                }
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        rel_path,
    )

    assert len(items) == 1
    item = items[0]
    extra = item.get_extra_field()

    assert item.get_tag() == file_key
    assert item.get_file_path() == rel_path
    assert isinstance(extra, dict)
    assert extra["tag"] == ["keep"]
    assert extra["context"] == ["ctx1"]
    assert extra["parameter"] == [{"ok": True}]
    assert extra["trans_ref"] == {"file_key": file_key, "row_index": 0}


def test_read_from_stream_skips_non_dict_file_entries(config: Config) -> None:
    handler = TRANS(config)
    rel_path = "skip_entries.trans"
    file_key = "script/good.json"

    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                "bad_entry": [],
                file_key: {
                    "tags": [[]],
                    "data": [["src", "dst"]],
                    "context": [[]],
                    "parameters": [[]],
                },
            },
        }
    }

    items = handler.read_from_stream(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        rel_path,
    )

    assert len(items) == 1
    assert items[0].get_tag() == file_key
    assert items[0].get_src() == "src"
    assert items[0].get_dst() == "dst"


def test_write_to_path_skips_when_asset_missing_or_invalid_json(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "sample.trans"
    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "tag": "script/a.json",
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )

    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False

    dummy_data_manager.assets[rel_path] = json.dumps(["not", "dict"]).encode("utf-8")
    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False


@pytest.mark.parametrize(
    ("rel_path", "payload"),
    [
        ("invalid_project.trans", {"project": []}),
        ("invalid_files.trans", {"project": {"files": []}}),
    ],
)
def test_write_to_path_skips_when_project_or_files_shape_invalid(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
    rel_path: str,
    payload: dict,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "tag": "script/a.json",
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    handler.write_to_path([item])
    assert (dummy_data_manager.translated_path / rel_path).exists() is False


class DummyProcessor(NONE):
    def post_process(self) -> None:
        return

    def filter(
        self, src: str, path: str, tag: list[str], context: list[str]
    ) -> list[bool]:
        del src
        del path
        del tag
        # 混合分区，确保触发 generate_parameter。
        return [i % 2 == 0 for i, _ in enumerate(context)] if context else [False]


def test_write_to_path_updates_data_and_parameters(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_trans = True
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: DummyProcessor(project),
    )

    rel_path = "sample.trans"
    tag_path = "script/a.json"
    base_payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                tag_path: {
                    "tags": [],
                    "data": [],
                    "context": [],
                    "parameters": [],
                }
            },
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(base_payload).encode("utf-8")

    processed_item = Item.from_dict(
        {
            "src": "src1",
            "dst": "dst1",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": tag_path,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {
                "tag": ["gold"],
                "context": ["c1", "c2"],
                "parameter": [],
            },
        }
    )
    duplicated_item = Item.from_dict(
        {
            "src": "src1",
            "dst": "",
            "status": Base.ProjectStatus.DUPLICATED,
            "tag": tag_path,
            "row": 1,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {
                "tag": ["gold"],
                "context": ["c3", "c4"],
                "parameter": [],
            },
        }
    )
    excluded_item = Item.from_dict(
        {
            "src": "src2",
            "dst": "src2",
            "status": Base.ProjectStatus.EXCLUDED,
            "tag": tag_path,
            "row": 2,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {
                "tag": [],
                "context": ["c5"],
                "parameter": [{"keep": "yes"}],
            },
        }
    )

    handler.write_to_path([processed_item, duplicated_item, excluded_item])

    output_file = dummy_data_manager.translated_path / rel_path
    output = json.loads(output_file.read_text(encoding="utf-8"))
    file_obj = output["project"]["files"][tag_path]

    assert file_obj["data"] == [["src1", "dst1"], ["src1", "dst1"], ["src2", "src2"]]
    assert file_obj["context"] == [["c1", "c2"], ["c3", "c4"], ["c5"]]
    assert file_obj["parameters"][0] == [
        {"contextStr": "c1", "translation": "src1"},
        {"contextStr": "c2", "translation": ""},
    ]
    assert file_obj["parameters"][2] == [{"keep": "yes"}]


def test_write_to_path_cleans_empty_tags_and_parameters(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: DummyProcessor(project),
    )

    rel_path = "clean.trans"
    tag_path = "script/clean.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                tag_path: {
                    "tags": [["old"]],
                    "data": [["old", "old"]],
                    "context": [["ctx"]],
                    "parameters": [[{"old": "1"}]],
                }
            },
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "status": Base.ProjectStatus.PROCESSED_IN_PAST,
            "tag": tag_path,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {
                "tag": [],
                "context": ["ctx"],
                "parameter": [],
            },
        }
    )

    handler.write_to_path([item])

    result = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text(encoding="utf-8")
    )
    file_obj = result["project"]["files"][tag_path]
    assert file_obj["tags"] == [[]]
    assert file_obj["parameters"] == [[]]


class MixedBlockProcessor(NONE):
    def post_process(self) -> None:
        return

    def filter(
        self, src: str, path: str, tag: list[str], context: list[str]
    ) -> list[bool]:
        del src
        del path
        del tag
        # 混合分区，确保触发 partition parameters + gold。
        return [True, False] if len(context) >= 2 else [False]


def test_patch_writer_respects_index_translation_and_preserves_extra_columns(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "index.trans"
    file_key = "script/a.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": 0,
            "indexTranslation": 2,
            "files": {
                file_key: {
                    "tags": [],
                    "data": [["src1", "keep", "old_dst", "tail"]],
                    "context": [[]],
                    "parameters": [None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    assert items[0].get_src() == "src1"
    assert items[0].get_dst() == "old_dst"

    items[0].set_dst("new_dst")
    items[0].set_status(Base.ProjectStatus.PROCESSED)
    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    row = output["project"]["files"][file_key]["data"][0]
    assert row == ["src1", "keep", "new_dst", "tail"]


def test_patch_writer_preserves_sparse_null_parameters_for_untouched_rows(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "sparse.trans"
    file_key = "script/sparse.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "data": [["a", ""], ["b", ""]],
                    "context": [[], []],
                    "parameters": [None, None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 2

    # 仅触达第一行，第二行保持原始 null。
    items[0].set_dst("t")
    items[0].set_status(Base.ProjectStatus.PROCESSED)
    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    params = output["project"]["files"][file_key]["parameters"]
    assert params == [None, None]


def test_legacy_fallback_writes_when_trans_ref_missing(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "legacy.trans"
    file_key = "script/legacy.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": 0,
            "indexTranslation": 2,
            "files": {file_key: {"data": []}},
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": file_key,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )

    handler.write_to_path([item])
    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    row = output["project"]["files"][file_key]["data"][0]
    assert row == ["src", "", "dst"]


def test_processed_in_past_row_can_patch_partition_parameters_without_changing_dst(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: MixedBlockProcessor(project),
    )

    rel_path = "past.trans"
    file_key = "script/past.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src", "old_dst"]],
                    "context": [["c1", "c2"]],
                    "parameters": [None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    assert items[0].get_status() == Base.ProjectStatus.PROCESSED_IN_PAST

    # 即使 dst 被意外改动，写回也不得改动翻译列。
    items[0].set_dst("SHOULD_NOT_WRITE")
    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]

    assert file_obj["data"][0] == ["src", "old_dst"]
    assert file_obj["tags"][0] == ["gold"]
    assert file_obj["parameters"][0] == [
        {"contextStr": "c1", "translation": "src"},
        {"contextStr": "c2", "translation": ""},
    ]


def test_patch_writer_does_not_inject_partition_fields_into_span_parameters(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: MixedBlockProcessor(project),
    )

    rel_path = "span.trans"
    file_key = "script/span.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src", "old_dst"]],
                    "context": [["c1", "c2"]],
                    # span schema: MUST NOT be rewritten into partition fields.
                    "parameters": [[{"start": 1, "end": 2}]],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    assert items[0].get_status() == Base.ProjectStatus.PROCESSED_IN_PAST

    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]

    # mixed filter is present, but span schema forbids partition injection and gold.
    assert file_obj["tags"] == [[]]
    assert file_obj["parameters"] == [[{"start": 1, "end": 2}]]
    assert file_obj["data"] == [["src", "old_dst"]]


def test_patch_writer_writes_duplicated_rows_using_processed_translation_mapping(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_trans = True
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "dedup_patch.trans"
    file_key = "script/dedup_patch.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[], []],
                    "data": [["same", ""], ["same", ""]],
                    "context": [[], []],
                    "parameters": [None, None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 2
    assert items[1].get_status() == Base.ProjectStatus.DUPLICATED

    items[0].set_dst("translated")
    items[0].set_status(Base.ProjectStatus.PROCESSED)

    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    assert output["project"]["files"][file_key]["data"] == [
        ["same", "translated"],
        ["same", "translated"],
    ]


def test_patch_writer_extends_row_when_translation_index_out_of_range(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "extend_patch.trans"
    file_key = "script/extend_patch.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": 0,
            "indexTranslation": 2,
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src"]],
                    "context": [[]],
                    "parameters": [None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1

    items[0].set_dst("dst")
    items[0].set_status(Base.ProjectStatus.PROCESSED)

    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    row = output["project"]["files"][file_key]["data"][0]
    assert row == ["src", "", "dst"]


def test_patch_writer_creates_tags_and_parameters_when_fields_have_wrong_types(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: MixedBlockProcessor(project),
    )

    rel_path = "create_fields.trans"
    file_key = "script/create_fields.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": None,
                    "data": [["src", "old_dst"]],
                    "context": [["c1", "c2"]],
                    "parameters": {},
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    assert items[0].get_status() == Base.ProjectStatus.PROCESSED_IN_PAST

    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]

    assert file_obj["data"] == [["src", "old_dst"]]
    assert file_obj["tags"] == [["gold"]]
    assert file_obj["parameters"] == [
        [
            {"contextStr": "c1", "translation": "src"},
            {"contextStr": "c2", "translation": ""},
        ]
    ]


def test_patch_writer_skips_duplicated_row_when_translation_mapping_missing(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_trans = True
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "dedup_skip.trans"
    file_key = "script/dedup_skip.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[], []],
                    "data": [["same", ""], ["same", ""]],
                    "context": [[], []],
                    "parameters": [None, None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 2
    assert items[1].get_status() == Base.ProjectStatus.DUPLICATED

    # 只给 DUPLICATED 行，不提供 PROCESSED 的翻译映射。
    handler.write_to_path([items[1]])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    assert output["project"]["files"][file_key]["data"] == [
        ["same", ""],
        ["same", ""],
    ]


def test_legacy_fallback_does_not_clear_other_file_entries(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "fallback_scope.trans"
    file_a = "script/a.json"
    file_b = "script/b.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_a: {
                    "tags": [["keep_a"]],
                    "data": [["old_src", "old_dst"]],
                    "context": [["ctx_a"]],
                    "parameters": [[{"keep": 1}]],
                },
                file_b: {
                    "tags": [["keep_b"]],
                    "data": [["b_src", "b_dst"]],
                    "context": [["ctx_b"]],
                    "parameters": [[{"b": 2}]],
                },
            },
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    # 不带 trans_ref，强制走 legacy fallback。
    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": file_a,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {"tag": ["t"], "context": ["c1"], "parameter": []},
        }
    )
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    files = output["project"]["files"]

    assert files[file_a]["data"] == [["src", "dst"]]
    assert files[file_b]["tags"] == [["keep_b"]]
    assert files[file_b]["data"] == [["b_src", "b_dst"]]
    assert files[file_b]["context"] == [["ctx_b"]]
    assert files[file_b]["parameters"] == [[{"b": 2}]]


def test_patch_writer_falls_back_when_trans_ref_points_to_missing_entry(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "invalid_trans_ref.trans"
    file_key = "script/a.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src", ""]],
                    "context": [["orig"]],
                    "parameters": [[]],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    item = items[0]

    # 构造无效 trans_ref：file_key 不存在，迫使 patch writer 走 fallback。
    extra = item.get_extra_field()
    assert isinstance(extra, dict)
    trans_ref = extra.get("trans_ref")
    assert isinstance(trans_ref, dict)

    updated_trans_ref = dict(trans_ref)
    updated_trans_ref["file_key"] = "script/missing.json"

    updated_extra = dict(extra)
    updated_extra["trans_ref"] = updated_trans_ref
    updated_extra["context"] = ["changed"]
    item.set_extra_field(updated_extra)

    item.set_dst("dst")
    item.set_status(Base.ProjectStatus.PROCESSED)
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]

    assert file_obj["data"] == [["src", "dst"]]
    assert file_obj["context"] == [["changed"]]


def test_write_to_path_clamps_negative_column_indices_in_project_metadata(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "negative_index_write.trans"
    file_key = "script/negative_index.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "indexOriginal": -5,
            "indexTranslation": -9,
            "files": {file_key: {"data": []}},
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": file_key,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    row = output["project"]["files"][file_key]["data"][0]
    assert row == ["src", "dst"]


def test_patch_writer_updates_translation_when_deduplication_disabled(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config.deduplication_in_trans = False
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "dedup_off.trans"
    file_key = "script/dedup_off.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src", ""]],
                    "context": [[]],
                    "parameters": [None],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1

    items[0].set_dst("dst")
    items[0].set_status(Base.ProjectStatus.PROCESSED)
    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    assert output["project"]["files"][file_key]["data"] == [["src", "dst"]]


@pytest.mark.parametrize(
    ("case_name", "trans_ref"),
    [
        ("bad_types", {"file_key": 123, "row_index": 0}),
        ("negative_row", {"file_key": "script/a.json", "row_index": -1}),
        ("out_of_range", {"file_key": "script/a.json", "row_index": 999}),
    ],
)
def test_patch_writer_falls_back_when_trans_ref_is_invalid(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
    case_name: str,
    trans_ref: dict,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = f"invalid_trans_ref_{case_name}.trans"
    file_key = "script/a.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [["src", ""]],
                    "context": [["orig"]],
                    "parameters": [[]],
                }
            },
        }
    }
    content = json.dumps(payload).encode("utf-8")
    dummy_data_manager.assets[rel_path] = content

    items = handler.read_from_stream(content, rel_path)
    assert len(items) == 1
    item = items[0]

    extra = item.get_extra_field()
    assert isinstance(extra, dict)
    updated_extra = dict(extra)
    updated_extra["trans_ref"] = trans_ref
    updated_extra["context"] = ["changed"]
    item.set_extra_field(updated_extra)

    item.set_dst("dst")
    item.set_status(Base.ProjectStatus.PROCESSED)
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]
    assert file_obj["data"] == [["src", "dst"]]
    assert file_obj["context"] == [["changed"]]


def test_patch_writer_replaces_non_list_row_and_writes_translation(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "non_list_row.trans"
    file_key = "script/non_list_row.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [[]],
                    "data": [None],
                    "context": [[]],
                    "parameters": [None],
                }
            },
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    item = Item.from_dict(
        {
            "src": "src",
            "dst": "dst",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": file_key,
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {"trans_ref": {"file_key": file_key, "row_index": 0}},
        }
    )
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    row = output["project"]["files"][file_key]["data"][0]
    assert row == ["", "dst"]


def test_legacy_fallback_skips_unknown_file_key_in_items(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "fallback_missing_key.trans"
    existing_key = "script/existing.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                existing_key: {
                    "tags": [[]],
                    "data": [["src", "dst"]],
                    "context": [[]],
                    "parameters": [[]],
                }
            },
        }
    }
    dummy_data_manager.assets[rel_path] = json.dumps(payload).encode("utf-8")

    item = Item.from_dict(
        {
            "src": "x",
            "dst": "y",
            "status": Base.ProjectStatus.PROCESSED,
            "tag": "script/missing.json",
            "row": 0,
            "file_type": Item.FileType.TRANS,
            "file_path": rel_path,
            "extra_field": {"tag": [], "context": [], "parameter": []},
        }
    )
    handler.write_to_path([item])

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    assert (
        output["project"]["files"][existing_key]
        == payload["project"]["files"][existing_key]
    )
