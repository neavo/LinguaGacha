from model.Api.WorkbenchModels import WorkbenchFileEntry
from model.Api.WorkbenchModels import WorkbenchSnapshot


def test_workbench_file_entry_from_dict_uses_safe_defaults() -> None:
    entry = WorkbenchFileEntry.from_dict(None)

    assert entry.rel_path == ""
    assert entry.item_count == 0
    assert entry.file_type == ""


def test_workbench_snapshot_from_dict_converts_entries_to_tuple() -> None:
    snapshot = WorkbenchSnapshot.from_dict(
        {
            "file_count": 1,
            "total_items": 3,
            "translated": 1,
            "translated_in_past": 2,
            "untranslated": 0,
            "file_op_running": True,
            "entries": [
                {
                    "rel_path": "script/a.txt",
                    "item_count": 3,
                    "file_type": "TXT",
                }
            ],
        }
    )

    assert snapshot.file_count == 1
    assert snapshot.file_op_running is True
    assert snapshot.entries == (
        WorkbenchFileEntry(
            rel_path="script/a.txt",
            item_count=3,
            file_type="TXT",
        ),
    )
