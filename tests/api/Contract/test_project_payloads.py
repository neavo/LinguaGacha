from api.Contract.ProjectPayloads import ProjectPreviewPayload
from api.Contract.ProjectPayloads import ProjectSnapshotPayload


def test_project_snapshot_payload_keeps_loaded_state() -> None:
    payload = ProjectSnapshotPayload(path="demo/project.lg", loaded=True).to_dict()

    assert payload == {
        "path": "demo/project.lg",
        "loaded": True,
    }


def test_project_preview_payload_normalizes_optional_summary_fields() -> None:
    payload = ProjectPreviewPayload.from_dict(
        {
            "path": "demo/project.lg",
            "name": "Demo",
            "source_language": "JA",
            "target_language": "ZH",
            "file_count": 4,
            "total_items": 12,
            "translated_items": 3,
            "progress": 0.25,
        }
    ).to_dict()

    assert payload["path"] == "demo/project.lg"
    assert payload["file_count"] == 4
    assert payload["translated_items"] == 3
    assert payload["progress"] == 0.25
