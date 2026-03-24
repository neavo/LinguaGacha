from model.Api.ProjectModels import ProjectPreview
from model.Api.ProjectModels import ProjectSnapshot


def test_project_snapshot_from_dict_uses_safe_defaults() -> None:
    snapshot = ProjectSnapshot.from_dict(None)

    assert snapshot.path == ""
    assert snapshot.loaded is False


def test_project_snapshot_from_dict_normalizes_loaded_flag() -> None:
    snapshot = ProjectSnapshot.from_dict({"path": "demo.lg", "loaded": 1})

    assert snapshot.path == "demo.lg"
    assert snapshot.loaded is True


def test_project_preview_from_dict_keeps_extra_fields() -> None:
    preview = ProjectPreview.from_dict(
        {
            "path": "demo.lg",
            "name": "Demo",
            "source_language": "JA",
            "item_count": 12,
        }
    )

    assert preview.path == "demo.lg"
    assert preview.name == "Demo"
    assert preview.payload["item_count"] == 12
