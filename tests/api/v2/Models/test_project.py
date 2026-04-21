from api.v2.Models.Project import ProjectPreview
from api.v2.Models.Project import ProjectSnapshot


def test_project_snapshot_from_dict_uses_safe_defaults() -> None:
    snapshot = ProjectSnapshot.from_dict(None)

    assert snapshot.path == ""
    assert snapshot.loaded is False


def test_project_snapshot_from_dict_normalizes_loaded_flag() -> None:
    snapshot = ProjectSnapshot.from_dict({"path": "demo.lg", "loaded": 1})

    assert snapshot.path == "demo.lg"
    assert snapshot.loaded is True
    assert snapshot.to_dict() == {
        "path": "demo.lg",
        "loaded": True,
    }


def test_project_preview_from_dict_models_summary_fields() -> None:
    preview = ProjectPreview.from_dict(
        {
            "path": "demo.lg",
            "name": "Demo",
            "source_language": "JA",
            "target_language": "ZH",
            "file_count": 4,
            "total_items": 12,
            "translated_items": 5,
            "progress": 0.25,
        }
    )

    assert preview.path == "demo.lg"
    assert preview.name == "Demo"
    assert preview.source_language == "JA"
    assert preview.target_language == "ZH"
    assert preview.file_count == 4
    assert preview.total_items == 12
    assert preview.translated_items == 5
    assert preview.progress == 0.25


def test_project_preview_to_dict_returns_explicit_modeled_fields() -> None:
    preview = ProjectPreview.from_dict(
        {
            "path": "demo.lg",
            "name": "Demo",
            "source_language": "JA",
            "target_language": "ZH",
            "file_count": 4,
            "created_at": "2026-03-24T12:00:00",
            "updated_at": "2026-03-24T12:30:00",
            "total_items": 12,
            "translated_items": 5,
            "progress": 0.25,
            "legacy_extra": "ignored",
        }
    )

    assert preview.to_dict() == {
        "path": "demo.lg",
        "name": "Demo",
        "source_language": "JA",
        "target_language": "ZH",
        "file_count": 4,
        "created_at": "2026-03-24T12:00:00",
        "updated_at": "2026-03-24T12:30:00",
        "total_items": 12,
        "translated_items": 5,
        "progress": 0.25,
    }


def test_project_preview_from_dict_marks_missing_progress_as_absent() -> None:
    preview = ProjectPreview.from_dict({"name": "Draft"})

    assert preview.name == "Draft"
    assert preview.progress == 0.0
    assert preview.has_progress is False
