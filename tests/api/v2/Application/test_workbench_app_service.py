import pytest


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


def test_add_file_propagates_manager_value_error(workbench_app_service) -> None:
    class FailingWorkbenchManager:
        def add_file(self, path: str) -> None:
            raise ValueError(f"duplicate: {path}")

    service = type(workbench_app_service)(FailingWorkbenchManager())

    with pytest.raises(ValueError, match="duplicate: script/b.txt"):
        service.add_file({"path": "script/b.txt"})
