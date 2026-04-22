from api.v2.Contract.WorkbenchPayloads import WorkbenchFileEntryPayload
from api.v2.Contract.WorkbenchPayloads import WorkbenchFilePatchPayload
from api.v2.Contract.WorkbenchPayloads import WorkbenchSummaryPayload


def build_summary() -> WorkbenchSummaryPayload:
    return WorkbenchSummaryPayload(
        file_count=1,
        total_items=3,
        translated=1,
        translated_in_past=1,
        error_count=0,
        file_op_running=False,
    )


def test_workbench_file_patch_payload_keeps_patch_lists() -> None:
    payload = WorkbenchFilePatchPayload(
        summary=build_summary(),
        ordered_rel_paths=("script/a.txt",),
        removed_rel_paths=("script/b.txt",),
        entries=(
            WorkbenchFileEntryPayload(
                rel_path="script/a.txt",
                item_count=3,
                file_type="TXT",
            ),
        ),
    ).to_dict()

    assert payload["summary"]["file_count"] == 1
    assert "untranslated" not in payload["summary"]
    assert payload["ordered_rel_paths"] == ["script/a.txt"]
    assert payload["removed_rel_paths"] == ["script/b.txt"]
