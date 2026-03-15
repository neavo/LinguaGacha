from __future__ import annotations

import json

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.TRANS.NONE import NONE
from module.File.TRANS.TRANS import TRANS
from tests.module.file.conftest import DummyDataManager


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
