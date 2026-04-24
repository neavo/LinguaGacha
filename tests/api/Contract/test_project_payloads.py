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

    assert payload == {
        "path": "demo/project.lg",
        "name": "Demo",
        "source_language": "JA",
        "target_language": "ZH",
        "file_count": 4,
        "created_at": "",
        "updated_at": "",
        "total_items": 12,
        "translated_items": 3,
        "progress": 0.25,
    }


def test_project_preview_payload_defaults_missing_summary_to_empty_preview() -> None:
    payload = ProjectPreviewPayload.from_dict(None).to_dict()

    assert payload == {
        "path": "",
        "name": "",
        "source_language": "",
        "target_language": "",
        "file_count": 0,
        "created_at": "",
        "updated_at": "",
        "total_items": 0,
        "translated_items": 0,
        "progress": 0.0,
    }
