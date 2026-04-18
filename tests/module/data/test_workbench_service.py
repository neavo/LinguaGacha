from __future__ import annotations

from base.Base import Base
from model.Item import Item
from module.Data.Project.WorkbenchService import WorkbenchService


def test_build_workbench_snapshot_counts_and_types() -> None:
    service = WorkbenchService()

    snapshot = service.build_snapshot(
        ["a.txt", "b.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            },
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.NONE,
                "file_type": "TXT",
            },
        ],
    )

    assert snapshot.file_count == 2
    assert snapshot.total_items == 2
    assert snapshot.translated == 1
    assert snapshot.error_count == 0
    assert snapshot.untranslated == 1
    assert snapshot.entries[0].item_count == 2
    assert snapshot.entries[0].file_type == Item.FileType.TXT
    assert snapshot.entries[1].item_count == 0


def test_build_workbench_snapshot_ignores_structural_status() -> None:
    service = WorkbenchService()

    snapshot = service.build_snapshot(
        ["a.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.EXCLUDED,
                "file_type": "TXT",
            },
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.PROCESSED_IN_PAST,
                "file_type": "TXT",
            },
        ],
    )

    assert snapshot.total_items == 1
    assert snapshot.translated == 1
    assert snapshot.translated_in_past == 1
    assert snapshot.error_count == 0
    assert snapshot.untranslated == 0


def test_build_workbench_snapshot_normalizes_invalid_status_and_file_type() -> None:
    service = WorkbenchService()

    snapshot = service.build_snapshot(
        ["a.txt"],
        [
            {
                "file_path": "a.txt",
                "status": "broken-status",
                "file_type": "broken-type",
            }
        ],
    )

    assert snapshot.total_items == 1
    assert snapshot.error_count == 0
    assert snapshot.untranslated == 1
    assert snapshot.entries[0].file_type == Item.FileType.NONE


def test_build_workbench_snapshot_counts_error_items_separately() -> None:
    service = WorkbenchService()

    snapshot = service.build_snapshot(
        ["a.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.ERROR,
                "file_type": "TXT",
            }
        ],
    )

    assert snapshot.total_items == 1
    assert snapshot.translated == 0
    assert snapshot.error_count == 1
    assert snapshot.untranslated == 0


def test_build_workbench_entry_patch_returns_requested_entries_only() -> None:
    service = WorkbenchService()
    snapshot = service.build_snapshot(
        ["a.txt", "b.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            },
            {
                "file_path": "b.txt",
                "status": Base.ProjectStatus.NONE,
                "file_type": "TXT",
            },
        ],
    )

    patch_entries = service.build_entry_patch(snapshot, ["b.txt"])

    assert len(patch_entries) == 1
    assert patch_entries[0].rel_path == "b.txt"
