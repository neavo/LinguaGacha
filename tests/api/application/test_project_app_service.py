def test_load_project_returns_loaded_snapshot(
    project_app_service,
    lg_path: str,
) -> None:
    result = project_app_service.load_project({"path": lg_path})

    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True


def test_get_project_snapshot_returns_serializable_state(
    project_app_service,
) -> None:
    result = project_app_service.get_project_snapshot({})

    assert "loaded" in result["project"]
