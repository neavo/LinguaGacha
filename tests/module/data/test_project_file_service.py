from __future__ import annotations

import contextlib
import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pyfakefs.fake_filesystem import FakeFilesystem

from module.Data.Core.Item import Item
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Project.ProjectFileService import ProjectFileService


def build_service() -> tuple[ProjectFileService, ProjectSession]:
    session = ProjectSession()
    session.db = SimpleNamespace(
        update_asset_sort_orders=MagicMock(),
        get_all_asset_paths=MagicMock(return_value=[]),
        connection=MagicMock(
            return_value=contextlib.nullcontext(SimpleNamespace(commit=MagicMock()))
        ),
    )
    session.lg_path = "demo/project.lg"
    service = ProjectFileService(session, {".txt"})
    return service, session


def install_stub_file_manager(
    monkeypatch: pytest.MonkeyPatch,
    *,
    items: list[Item],
) -> None:
    """把文件解析边界替换成稳定的桩，避免测试依赖真实格式解析。"""

    file_manager_module = importlib.import_module("module.File.FileManager")

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del rel_path
            del content
            return items

    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)


def create_virtual_file(
    fs: FakeFilesystem,
    file_path: str,
    content: bytes = b"data",
) -> None:
    """在 pyfakefs 里创建输入文件，统一掉重复的准备步骤。"""
    fs.create_file(file_path, contents=content, create_missing_dirs=True)


def test_parse_file_preview_rejects_unsupported_extension() -> None:
    service, _session = build_service()

    with pytest.raises(ValueError, match="unsupported|格式|format"):
        service.parse_file_preview("a.md")


def test_parse_file_preview_returns_normalized_items_and_target_rel_path(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _session = build_service()
    install_stub_file_manager(
        monkeypatch,
        items=[
            Item.from_dict(
                {
                    "src": "a",
                    "dst": "A",
                    "name_src": "Alice",
                    "name_dst": "爱丽丝",
                    "extra_field": {"speaker": "narrator"},
                    "tag": "line",
                    "row": 3,
                    "file_path": "a.txt",
                    "file_type": Item.FileType.TXT,
                    "text_type": Item.TextType.MD,
                    "status": "PROCESSED",
                    "retry_count": 2,
                }
            )
        ],
    )
    create_virtual_file(fs, "C:/workspace/a.txt")

    result = service.parse_file_preview("C:/workspace/a.txt")

    assert result["target_rel_path"] == "a.txt"
    assert result["file_type"] == Item.FileType.TXT.value
    assert result["parsed_items"] == [
        {
            "src": "a",
            "dst": "A",
            "name_src": "Alice",
            "name_dst": "爱丽丝",
            "extra_field": {"speaker": "narrator"},
            "tag": "line",
            "row": 3,
            "file_type": Item.FileType.TXT.value,
            "file_path": "a.txt",
            "text_type": Item.TextType.MD.value,
            "status": "PROCESSED",
            "retry_count": 2,
        }
    ]


def test_parse_file_preview_keeps_parent_folder_when_replacing_file(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _session = build_service()
    install_stub_file_manager(
        monkeypatch,
        items=[
            Item.from_dict(
                {
                    "src": "line-1",
                    "file_path": "chapter\\b.txt",
                    "file_type": Item.FileType.TXT,
                }
            )
        ],
    )
    create_virtual_file(fs, "C:/workspace/b.txt")

    result = service.parse_file_preview(
        "C:/workspace/b.txt",
        current_rel_path="chapter/a.txt",
    )

    assert result["target_rel_path"] == "chapter\\b.txt"
    assert result["parsed_items"][0]["file_path"] == "chapter\\b.txt"


def test_reorder_files_updates_asset_sort_orders() -> None:
    service, session = build_service()
    session.db.get_all_asset_paths = MagicMock(
        return_value=["script/a.txt", "script/b.txt"]
    )
    connection_ctx = session.db.connection.return_value
    with connection_ctx as conn:
        expected_conn = conn

    service.reorder_files(["script/b.txt", "script/a.txt"])

    session.db.update_asset_sort_orders.assert_called_once_with(
        ["script/b.txt", "script/a.txt"],
        conn=expected_conn,
    )
    expected_conn.commit.assert_called_once()


def test_reorder_files_rejects_missing_or_extra_paths() -> None:
    service, session = build_service()
    session.db.get_all_asset_paths = MagicMock(
        return_value=["script/a.txt", "script/b.txt"]
    )

    with pytest.raises(ValueError, match="顺序无效"):
        service.reorder_files(["script/a.txt"])


def test_normalize_batch_rel_paths_keeps_order_and_deduplicates_case_insensitively() -> (
    None
):
    service, _session = build_service()

    assert service.normalize_batch_rel_paths(
        ["a.txt", " A.txt ", "b.txt", "", "B.TXT"]
    ) == ["a.txt", "b.txt"]


def test_normalize_batch_rel_paths_rejects_empty_input() -> None:
    service, _session = build_service()

    with pytest.raises(ValueError, match="路径无效"):
        service.normalize_batch_rel_paths(["", "   "])


def test_pick_file_type_prefers_first_non_none_value() -> None:
    service, _session = build_service()

    assert (
        service.pick_file_type(
            [
                {"file_type": Item.FileType.NONE},
                {"file_type": ""},
                {"file_type": Item.FileType.TXT},
                {"file_type": "MD"},
            ]
        )
        == Item.FileType.TXT.value
    )


def test_build_replace_target_rel_path_keeps_parent_folder() -> None:
    service, _session = build_service()

    assert service.build_replace_target_rel_path("chapter/a.txt", "C:/drop/b.txt") == (
        "chapter\\b.txt"
    )
    assert service.build_replace_target_rel_path("a.txt", "") == "a.txt"


def test_get_loaded_db_raises_when_project_not_loaded() -> None:
    service, session = build_service()
    session.db = None

    with pytest.raises(RuntimeError, match="工程未加载"):
        service.get_loaded_db()


def test_try_begin_file_operation_blocks_until_finish() -> None:
    service, _session = build_service()

    assert service.try_begin_file_operation() is True
    assert service.is_file_op_running() is True
    assert service.try_begin_file_operation() is False

    service.finish_file_operation()

    assert service.is_file_op_running() is False
    assert service.try_begin_file_operation() is True


def test_ensure_replace_target_path_not_conflict_ignores_self_but_rejects_other_duplicate() -> (
    None
):
    service, _session = build_service()

    service.ensure_replace_target_path_not_conflict(
        ["folder/a.txt", "folder/c.txt"],
        "folder/a.txt",
        "folder/A.txt",
    )

    with pytest.raises(ValueError, match="exist|exists|已存在|冲突|名称"):
        service.ensure_replace_target_path_not_conflict(
            ["folder/a.txt", "folder/b.txt"],
            "folder/a.txt",
            "folder/B.txt",
        )
