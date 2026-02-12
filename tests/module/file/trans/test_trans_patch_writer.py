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
