from __future__ import annotations

import contextlib
import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from model.Item import Item
from module.Data.ProjectFileService import ProjectFileService
from module.Data.ProjectSession import ProjectSession


def build_service() -> tuple[ProjectFileService, ProjectSession]:
    session = ProjectSession()
    session.db = SimpleNamespace(
        add_asset=MagicMock(),
        insert_items=MagicMock(),
        get_items_by_file_path=MagicMock(return_value=[]),
        update_batch=MagicMock(),
        delete_items_by_file_path=MagicMock(),
        delete_asset=MagicMock(),
        update_asset=MagicMock(),
        update_asset_path=MagicMock(),
        asset_path_exists=MagicMock(return_value=False),
        get_all_asset_paths=MagicMock(return_value=[]),
        connection=MagicMock(
            return_value=contextlib.nullcontext(SimpleNamespace(commit=MagicMock()))
        ),
    )
    session.lg_path = "demo/project.lg"
    item_service = SimpleNamespace(clear_item_cache=MagicMock())
    service = ProjectFileService(
        session,
        item_service,
        MagicMock(),
        lambda: {".txt"},
    )
    return service, session


def test_add_file_rejects_unsupported_extension() -> None:
    service, _session = build_service()

    import pytest

    with pytest.raises(ValueError, match="unsupported|格式|format"):
        service.add_file("a.md")


def test_reset_file_clears_translation_fields() -> None:
    service, session = build_service()
    session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "X",
                "name_dst": "N",
                "status": Base.ProjectStatus.PROCESSED,
                "retry_count": 3,
            }
        ]
    )

    result = service.reset_file("a.txt")

    assert result.rel_path == "a.txt"
    updated = session.db.update_batch.call_args.kwargs["items"]
    assert updated[0]["dst"] == ""
    assert updated[0]["status"] == Base.ProjectStatus.NONE


def test_delete_file_removes_asset_and_items() -> None:
    service, session = build_service()

    result = service.delete_file("a.txt")

    assert result.rel_path == "a.txt"
    session.db.delete_items_by_file_path.assert_called_once()
    session.db.delete_asset.assert_called_once()


def test_update_file_returns_mutation_stats(tmp_path, monkeypatch) -> None:
    service, session = build_service()
    session.db.asset_path_exists = MagicMock(return_value=True)
    session.db.get_items_by_file_path = MagicMock(
        return_value=[
            {
                "id": 1,
                "src": "a",
                "dst": "旧译文",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            }
        ]
    )
    file_manager_module = importlib.import_module("module.File.FileManager")

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            return [
                Item.from_dict({"src": "a", "file_path": rel_path, "file_type": "TXT"})
            ]

    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)

    file_path = tmp_path / "a.txt"
    file_path.write_bytes(b"data")
    result = service.update_file("a.txt", str(file_path))

    assert result.matched == 1
    assert result.total == 1
