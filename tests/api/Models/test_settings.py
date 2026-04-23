from api.Models.Settings import AppSettingsSnapshot
from api.Models.Settings import RecentProjectEntry


def test_recent_project_entry_from_dict_uses_safe_defaults() -> None:
    entry = RecentProjectEntry.from_dict(None)

    assert entry.path == ""
    assert entry.name == ""


def test_app_settings_snapshot_from_dict_normalizes_recent_projects() -> None:
    snapshot = AppSettingsSnapshot.from_dict(
        {
            "app_language": "ZH",
            "target_language": "EN",
            "recent_projects": [{"path": "demo.lg", "name": "Demo"}],
        }
    )

    assert snapshot.app_language == "ZH"
    assert snapshot.target_language == "EN"
    assert snapshot.recent_projects == (
        RecentProjectEntry(path="demo.lg", name="Demo"),
    )


def test_app_settings_snapshot_to_dict_restores_recent_projects() -> None:
    snapshot = AppSettingsSnapshot.from_dict(
        {
            "project_save_mode": "FIXED",
            "project_fixed_path": "E:/Demo",
            "recent_projects": [{"path": "demo.lg", "name": "Demo"}],
        }
    )

    assert snapshot.to_dict()["recent_projects"] == [
        {"path": "demo.lg", "name": "Demo"}
    ]


def test_app_settings_snapshot_handles_mtool_optimizer_field() -> None:
    snapshot = AppSettingsSnapshot.from_dict(
        {
            "mtool_optimizer_enable": True,
        }
    )

    assert snapshot.mtool_optimizer_enable is True
    assert snapshot.to_dict()["mtool_optimizer_enable"] is True


def test_app_settings_snapshot_ignores_invalid_recent_projects_payload() -> None:
    snapshot = AppSettingsSnapshot.from_dict(
        {
            "app_language": "EN",
            "recent_projects": ("demo.lg",),
        }
    )

    assert snapshot.app_language == "EN"
    assert snapshot.recent_projects == ()
    assert snapshot.to_dict()["recent_projects"] == []
