from __future__ import annotations

import contextlib
import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pyfakefs.fake_filesystem import FakeFilesystem

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Project.ProjectFileService import ProjectFileService
from module.Data.Core.ProjectSession import ProjectSession


def build_service() -> tuple[ProjectFileService, ProjectSession]:
    session = ProjectSession()
    captured_batch: dict[str, object] = {}
    inserted_items_batches: list[list[dict[str, object]]] = []

    def record_update_batch(
        *,
        items: list[dict[str, object]] | None = None,
        rules: dict[object, object] | None = None,
        meta: dict[str, object] | None = None,
    ) -> None:
        captured_batch["items"] = items or []
        captured_batch["rules"] = rules
        captured_batch["meta"] = meta

    def record_insert_items(
        items: list[dict[str, object]],
        conn: object | None = None,
    ) -> list[int]:
        del conn
        inserted_items_batches.append([dict(item) for item in items])
        return list(range(1, len(items) + 1))

    session.db = SimpleNamespace(
        add_asset=MagicMock(),
        insert_items=MagicMock(side_effect=record_insert_items),
        get_items_by_file_path=MagicMock(return_value=[]),
        update_batch=MagicMock(side_effect=record_update_batch),
        delete_items_by_file_path=MagicMock(),
        delete_asset=MagicMock(),
        update_asset=MagicMock(),
        update_asset_path=MagicMock(),
        update_asset_sort_orders=MagicMock(),
        asset_path_exists=MagicMock(return_value=False),
        get_all_asset_paths=MagicMock(return_value=[]),
        connection=MagicMock(
            return_value=contextlib.nullcontext(SimpleNamespace(commit=MagicMock()))
        ),
    )
    session.lg_path = "demo/project.lg"
    session.captured_batch = captured_batch
    session.inserted_items_batches = inserted_items_batches
    item_service = SimpleNamespace(clear_item_cache=MagicMock())
    analysis_service = SimpleNamespace(clear_analysis_progress=MagicMock())
    service = ProjectFileService(
        session,
        item_service,
        analysis_service,
        {".txt"},
    )
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


def test_add_file_rejects_unsupported_extension() -> None:
    service, _session = build_service()

    with pytest.raises(ValueError, match="unsupported|格式|format"):
        service.add_file("a.md")


def test_add_file_imports_asset_and_items_and_clears_caches(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, session = build_service()
    install_stub_file_manager(
        monkeypatch,
        items=[
            Item.from_dict(
                {"src": "a", "file_path": "a.txt", "file_type": Item.FileType.TXT}
            )
        ],
    )
    create_virtual_file(fs, "C:/workspace/a.txt")

    result = service.add_file("C:/workspace/a.txt")

    assert result.rel_path == "a.txt"
    assert result.new == 1
    assert result.total == 1
    session.db.add_asset.assert_called_once()
    session.db.insert_items.assert_called_once()
    inserted_items = session.inserted_items_batches[0]
    assert len(inserted_items) == 1
    assert inserted_items[0]["src"] == "a"
    assert inserted_items[0]["file_path"] == "a.txt"
    assert inserted_items[0]["file_type"] == Item.FileType.TXT
    service.item_service.clear_item_cache.assert_called_once()
    service.analysis_service.clear_analysis_progress.assert_called_once()


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
    updated = session.captured_batch["items"]
    assert updated[0]["dst"] == ""
    assert updated[0]["status"] == Base.ProjectStatus.NONE
    service.item_service.clear_item_cache.assert_called_once()
    service.analysis_service.clear_analysis_progress.assert_called_once()


def test_delete_file_removes_asset_and_items() -> None:
    service, session = build_service()
    session.asset_decompress_cache["a.txt"] = b"cached"

    result = service.delete_file("a.txt")

    assert result.rel_path == "a.txt"
    session.db.delete_items_by_file_path.assert_called_once()
    session.db.delete_asset.assert_called_once()
    assert "a.txt" not in session.asset_decompress_cache
    service.item_service.clear_item_cache.assert_called_once()
    service.analysis_service.clear_analysis_progress.assert_called_once()


def test_delete_file_batch_removes_all_assets_and_items() -> None:
    service, session = build_service()
    session.asset_decompress_cache["a.txt"] = b"cached-a"
    session.asset_decompress_cache["b.txt"] = b"cached-b"

    result = service.delete_file_batch(["a.txt", "b.txt"])

    assert result.removed_rel_paths == ("a.txt", "b.txt")
    assert session.db.delete_items_by_file_path.call_count == 2
    assert session.db.delete_asset.call_count == 2
    assert "a.txt" not in session.asset_decompress_cache
    assert "b.txt" not in session.asset_decompress_cache


def test_reset_file_batch_updates_all_target_items() -> None:
    service, session = build_service()
    session.db.get_items_by_file_path = MagicMock(
        side_effect=[
            [{"id": 1, "dst": "A", "status": Base.ProjectStatus.PROCESSED}],
            [{"id": 2, "dst": "B", "status": Base.ProjectStatus.ERROR}],
        ]
    )

    result = service.reset_file_batch(["a.txt", "b.txt"])

    assert result.rel_paths == ("a.txt", "b.txt")
    updated = session.captured_batch["items"]
    assert len(updated) == 2
    assert all(item["dst"] == "" for item in updated)


def test_reorder_files_updates_asset_sort_orders() -> None:
    service, session = build_service()
    session.db.get_all_asset_paths = MagicMock(
        return_value=["script/a.txt", "script/b.txt"]
    )
    connection_ctx = session.db.connection.return_value
    with connection_ctx as conn:
        expected_conn = conn

    result = service.reorder_files(["script/b.txt", "script/a.txt"])

    session.db.update_asset_sort_orders.assert_called_once_with(
        ["script/b.txt", "script/a.txt"],
        conn=expected_conn,
    )
    expected_conn.commit.assert_called_once()
    assert result.order_changed is True


def test_reorder_files_rejects_missing_or_extra_paths() -> None:
    service, session = build_service()
    session.db.get_all_asset_paths = MagicMock(
        return_value=["script/a.txt", "script/b.txt"]
    )

    with pytest.raises(ValueError, match="顺序无效"):
        service.reorder_files(["script/a.txt"])


def test_replace_file_returns_mutation_stats(fs, monkeypatch) -> None:
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
    session.asset_decompress_cache["a.txt"] = b"cached"
    install_stub_file_manager(
        monkeypatch,
        items=[Item.from_dict({"src": "a", "file_path": "a.txt", "file_type": "TXT"})],
    )

    file_path = "C:/workspace/a.txt"
    create_virtual_file(fs, file_path)
    result = service.replace_file("a.txt", file_path)

    assert result.matched == 1
    assert result.total == 1
    assert result.old_rel_path is None
    assert "a.txt" not in session.asset_decompress_cache
    service.item_service.clear_item_cache.assert_called_once()
    service.analysis_service.clear_analysis_progress.assert_called_once()


def test_replace_file_rejects_format_mismatch(fs, monkeypatch) -> None:
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
    install_stub_file_manager(
        monkeypatch,
        items=[Item.from_dict({"src": "a", "file_path": "a.txt", "file_type": "MD"})],
    )

    file_path = "C:/workspace/a.txt"
    create_virtual_file(fs, file_path)

    with pytest.raises(ValueError, match="mismatch|格式|replace"):
        service.replace_file("a.txt", file_path)


def test_replace_file_renames_asset_and_clears_old_and_new_cache_entries(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    session.db.get_all_asset_paths = MagicMock(return_value=["chapter/a.txt"])
    session.asset_decompress_cache["chapter/a.txt"] = b"old"
    session.asset_decompress_cache["chapter\\b.txt"] = b"new"
    install_stub_file_manager(
        monkeypatch,
        items=[
            Item.from_dict(
                {
                    "src": "a",
                    "file_path": "chapter\\b.txt",
                    "file_type": "TXT",
                }
            )
        ],
    )

    file_path = "C:/workspace/b.txt"
    create_virtual_file(fs, file_path)
    result = service.replace_file("chapter/a.txt", file_path)

    assert result.rel_path == "chapter\\b.txt"
    assert result.old_rel_path == "chapter/a.txt"
    session.db.update_asset_path.assert_called_once()
    assert "chapter/a.txt" not in session.asset_decompress_cache
    assert "chapter\\b.txt" not in session.asset_decompress_cache


def test_replace_file_batch_updates_multiple_files_in_single_result(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, session = build_service()
    session.db.asset_path_exists = MagicMock(return_value=True)
    session.db.get_all_asset_paths = MagicMock(return_value=["a.txt", "b.txt"])
    session.db.get_items_by_file_path = MagicMock(
        side_effect=[
            [
                {
                    "id": 1,
                    "src": "a",
                    "dst": "旧译文A",
                    "status": Base.ProjectStatus.PROCESSED,
                    "file_type": "TXT",
                }
            ],
            [
                {
                    "id": 2,
                    "src": "b",
                    "dst": "旧译文B",
                    "status": Base.ProjectStatus.PROCESSED,
                    "file_type": "TXT",
                }
            ],
        ]
    )
    file_manager_module = importlib.import_module("module.File.FileManager")

    class StubFileManager:
        def __init__(self, _config: object) -> None:
            pass

        def parse_asset(self, rel_path: str, content: bytes) -> list[Item]:
            del content
            stem = rel_path.rsplit(".", 1)[0]
            return [
                Item.from_dict({"src": stem, "file_path": rel_path, "file_type": "TXT"})
            ]

    monkeypatch.setattr(file_manager_module, "FileManager", StubFileManager)
    create_virtual_file(fs, "C:/workspace/a.txt")
    create_virtual_file(fs, "C:/workspace/b.txt")

    result = service.replace_file_batch(
        [("a.txt", "C:/workspace/a.txt"), ("b.txt", "C:/workspace/b.txt")]
    )

    assert result.rel_paths == ("a.txt", "b.txt")
    assert result.matched == 2
    assert result.total == 2
    assert session.db.update_asset.call_count == 2
    assert session.db.delete_items_by_file_path.call_count == 2


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


def test_inherit_completed_translations_prefers_most_common_dst_and_keeps_structural_status() -> (
    None
):
    service, _session = build_service()
    old_items = [
        {
            "src": "line-1",
            "dst": "旧译文A",
            "name_dst": "角色A",
            "retry_count": 3,
            "status": Base.ProjectStatus.PROCESSED,
        },
        {
            "src": "line-1",
            "dst": "旧译文A",
            "name_dst": "角色B",
            "retry_count": 1,
            "status": Base.ProjectStatus.PROCESSED,
        },
        {
            "src": "line-1",
            "dst": "旧译文B",
            "name_dst": "角色C",
            "retry_count": 9,
            "status": Base.ProjectStatus.PROCESSED,
        },
    ]
    new_items = [
        {
            "src": "line-1",
            "dst": "",
            "name_dst": None,
            "retry_count": 0,
            "status": Base.ProjectStatus.NONE,
        },
        {
            "src": "line-1",
            "dst": "",
            "name_dst": None,
            "retry_count": 0,
            "status": Base.ProjectStatus.EXCLUDED,
        },
        {"src": "line-2", "dst": "", "status": Base.ProjectStatus.NONE},
    ]

    matched = service.inherit_completed_translations(old_items, new_items)

    assert matched == 2
    assert new_items[0]["dst"] == "旧译文A"
    assert new_items[0]["name_dst"] == "角色A"
    assert new_items[0]["retry_count"] == 3
    assert new_items[0]["status"] == Base.ProjectStatus.PROCESSED
    assert new_items[1]["dst"] == "旧译文A"
    assert new_items[1]["status"] == Base.ProjectStatus.EXCLUDED
