from __future__ import annotations

import json

import pytest

from base.Base import Base
from module.Config import Config
from module.File.TRANS.KAG import KAG
from module.File.TRANS.NONE import NONE
from module.File.TRANS.RENPY import RENPY
from module.File.TRANS.RPGMAKER import RPGMAKER
from module.File.TRANS.TRANS import TRANS
from module.File.TRANS.WOLF import WOLF


def test_get_processor_routes_by_game_engine(config: Config) -> None:
    handler = TRANS(config)

    assert isinstance(handler.get_processor({"gameEngine": "kag"}), KAG)
    assert isinstance(handler.get_processor({"gameEngine": "wolf"}), WOLF)
    assert isinstance(handler.get_processor({"gameEngine": "renpy"}), RENPY)
    assert isinstance(handler.get_processor({"gameEngine": "rmmz"}), RPGMAKER)
    assert isinstance(handler.get_processor({"gameEngine": "unknown"}), NONE)


def test_read_from_stream_marks_duplicates_when_enabled(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    config.deduplication_in_trans = True

    class DummyProcessor(NONE):
        def pre_process(self) -> None:
            return

        def check(self, path: str, data: list[str], tag: list[str], context: list[str]):
            del path
            del context
            src = data[0] if data else ""
            dst = data[1] if len(data) > 1 else src
            return src, dst, tag, Base.ProjectStatus.NONE, False

    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: DummyProcessor(project),
    )

    payload = {
        "project": {
            "gameEngine": "dummy",
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
    assert items[0].get_text_type() == NONE.TEXT_TYPE


def test_read_from_stream_does_not_mark_duplicates_when_disabled(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handler = TRANS(config)
    config.deduplication_in_trans = False

    class DummyProcessor(NONE):
        def pre_process(self) -> None:
            return

        def check(self, path: str, data: list[str], tag: list[str], context: list[str]):
            del path
            del context
            src = data[0] if data else ""
            dst = data[1] if len(data) > 1 else src
            return src, dst, tag, Base.ProjectStatus.NONE, False

    monkeypatch.setattr(
        "module.File.TRANS.TRANS.TRANS.get_processor",
        lambda self, project: DummyProcessor(project),
    )

    payload = {
        "project": {
            "gameEngine": "dummy",
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
