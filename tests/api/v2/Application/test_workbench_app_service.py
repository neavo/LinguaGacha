def test_build_workbench_snapshot_returns_serializable_payload(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    fake_workbench_manager.file_op_running = True
    result = workbench_app_service.get_snapshot({})

    snapshot = result["snapshot"]

    assert snapshot["error_count"] == 0
    assert snapshot["file_op_running"] is True
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


def test_replace_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.replace_file(
        {"rel_path": "script/a.txt", "path": "C:/next/a.txt"}
    )

    assert result["accepted"] is True
    assert fake_workbench_manager.replace_calls == [("script/a.txt", "C:/next/a.txt")]


def test_reorder_files_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.reorder_files(
        {"ordered_rel_paths": ["script/b.txt", "script/a.txt"]}
    )

    assert result["accepted"] is True
    assert fake_workbench_manager.reorder_calls == [["script/b.txt", "script/a.txt"]]


def test_reset_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.reset_file({"rel_path": "script/a.txt"})

    assert result["accepted"] is True
    assert fake_workbench_manager.reset_calls == ["script/a.txt"]


def test_delete_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.delete_file({"rel_path": "script/a.txt"})

    assert result["accepted"] is True
    assert fake_workbench_manager.delete_calls == ["script/a.txt"]


def test_delete_file_batch_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.delete_file_batch(
        {"rel_paths": ["script/a.txt", "script/b.txt"]}
    )

    assert result["accepted"] is True
    assert fake_workbench_manager.delete_batch_calls == [
        ["script/a.txt", "script/b.txt"]
    ]


def test_get_file_patch_returns_summary_order_and_entries(
    workbench_app_service,
) -> None:
    result = workbench_app_service.get_file_patch(
        {
            "rel_paths": ["script/a.txt"],
            "removed_rel_paths": ["script/old.txt"],
            "include_order": True,
        }
    )

    patch = result["patch"]
    assert patch["summary"]["file_count"] == 1
    assert patch["ordered_rel_paths"] == ["script/a.txt"]
    assert patch["removed_rel_paths"] == ["script/old.txt"]
    assert patch["entries"][0]["rel_path"] == "script/a.txt"


def test_get_file_patch_omits_order_and_filters_blank_removed_paths(
    workbench_app_service,
) -> None:
    result = workbench_app_service.get_file_patch(
        {
            "rel_paths": ["script/a.txt"],
            "removed_rel_paths": ["", "script/old.txt"],
            "include_order": False,
        }
    )

    assert result["patch"]["ordered_rel_paths"] == []
    assert result["patch"]["removed_rel_paths"] == ["script/old.txt"]
