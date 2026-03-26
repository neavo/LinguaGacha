def test_build_workbench_snapshot_returns_serializable_payload(
    workbench_app_service,
) -> None:
    result = workbench_app_service.get_snapshot({})

    snapshot = result["snapshot"]

    assert "entries" in snapshot
    assert isinstance(snapshot["entries"], list)
    assert snapshot["entries"][0]["rel_path"] == "script/a.txt"
    assert snapshot["entries"][0]["file_type"] == "TXT"


def test_add_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.add_file({"path": "script/b.txt"})

    assert result["accepted"] is True
    assert fake_workbench_manager.add_calls == ["script/b.txt"]
