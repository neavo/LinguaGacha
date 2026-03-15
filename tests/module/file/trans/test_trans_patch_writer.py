from __future__ import annotations

import json

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.TRANS.NONE import NONE
from module.File.TRANS.TRANS import TRANS
from tests.module.file.conftest import DummyDataManager


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


class EmptyBlockProcessor(NONE):
    def post_process(self) -> None:
        return

    def filter(
        self, src: str, path: str, tag: list[str], context: list[str]
    ) -> list[bool]:
        del src
        del path
        del tag
        del context
        # 覆盖空 block 分支（由调用方兜底为 [False]）。
        return []


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


def test_patch_writer_removes_gold_when_not_mixed_and_filter_returns_empty_block(
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
        lambda self, project: EmptyBlockProcessor(project),
    )

    rel_path = "remove_gold.trans"
    file_key = "script/remove_gold.json"
    payload = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: {
                    "tags": [["gold"]],
                    "data": [["src", "old_dst"]],
                    "context": [["ctx"]],
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

    handler.write_to_path(items)

    output = json.loads(
        (dummy_data_manager.translated_path / rel_path).read_text("utf-8")
    )
    file_obj = output["project"]["files"][file_key]

    assert file_obj["data"] == [["src", "old_dst"]]
    assert file_obj["tags"] == [[]]
    assert file_obj["parameters"] == [None]


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


def test_patch_writer_skips_when_entry_data_becomes_invalid_after_validation(
    config: Config,
    dummy_data_manager: DummyDataManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.DataManager.get", lambda: dummy_data_manager
    )

    rel_path = "flaky_data.trans"
    file_key = "script/flaky.json"

    class FlakyEntry(dict):
        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self.data_get_calls = 0

        def get(self, key, default=None):
            if key == "data":
                self.data_get_calls += 1
                if self.data_get_calls >= 2:
                    return None
            return super().get(key, default)

    json_data = {
        "project": {
            "gameEngine": "dummy",
            "files": {
                file_key: FlakyEntry(
                    {
                        "tags": [[]],
                        "data": [["src", ""]],
                        "context": [[]],
                        "parameters": [None],
                    }
                )
            },
        }
    }

    # data 校验阶段读取正常，patch 阶段读取变为 None，确保触发 patch writer 的 defensive continue。
    monkeypatch.setattr(
        "module.File.TRANS.TRANS.JSONTool.loads", lambda content: json_data
    )
    dummy_data_manager.assets[rel_path] = b"ignored"

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
    assert output["project"]["files"][file_key]["data"] == [["src", ""]]
