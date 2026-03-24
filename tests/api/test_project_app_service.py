def test_load_project_returns_loaded_snapshot(
    project_app_service,
    lg_path: str,
) -> None:
    result = project_app_service.load_project({"path": lg_path})

    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True
