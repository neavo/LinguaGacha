import importlib
import threading
from types import SimpleNamespace
from typing import Any
from typing import cast
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Data.DataManager import DataManager


data_manager_module = importlib.import_module("module.Data.DataManager")


def build_manager_for_snapshot(
    asset_paths: list[str], item_dicts: list[dict[str, Any]]
) -> Any:
    dm = cast(Any, DataManager.__new__(DataManager))
    dm.asset_service = SimpleNamespace(
        get_all_asset_paths=MagicMock(return_value=asset_paths)
    )
    dm.item_service = SimpleNamespace(
        get_all_item_dicts=MagicMock(return_value=item_dicts)
    )
    return dm


def test_build_workbench_snapshot_counts_and_types() -> None:
    dm = build_manager_for_snapshot(
        ["a.txt", "b.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            },
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.NONE,
                "file_type": "TXT",
            },
        ],
    )

    snapshot = dm.build_workbench_snapshot()

    assert snapshot.file_count == 2
    assert snapshot.total_items == 2
    assert snapshot.translated == 1
    assert snapshot.untranslated == 1
    assert [e.rel_path for e in snapshot.entries] == ["a.txt", "b.txt"]
    assert snapshot.entries[0].item_count == 2
    assert snapshot.entries[0].file_type == Item.FileType.TXT
    assert snapshot.entries[1].item_count == 0


def test_build_workbench_snapshot_handles_large_dataset() -> None:
    asset_paths = [f"f{i}.txt" for i in range(1000)]
    item_dicts = [
        {
            "file_path": rel,
            "status": Base.ProjectStatus.PROCESSED,
            "file_type": "TXT",
        }
        for rel in asset_paths
    ]
    dm = build_manager_for_snapshot(asset_paths, item_dicts)

    snapshot = dm.build_workbench_snapshot()

    assert snapshot.file_count == 1000
    assert snapshot.total_items == 1000
    assert snapshot.translated == 1000
    assert snapshot.untranslated == 0
    assert len(snapshot.entries) == 1000


def test_build_workbench_snapshot_handles_invalid_file_type_and_skips_uncounted_statuses() -> (
    None
):
    dm = build_manager_for_snapshot(
        ["a.txt", "b.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "BAD",
            },
            {
                "file_path": "b.txt",
                "status": Base.ProjectStatus.EXCLUDED,
                "file_type": "TXT",
            },
            {
                "file_path": "",
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            },
            {
                "file_path": None,
                "status": Base.ProjectStatus.PROCESSED,
                "file_type": "TXT",
            },
        ],
    )

    snapshot = dm.build_workbench_snapshot()

    assert snapshot.total_items == 1
    assert snapshot.translated == 1
    assert snapshot.entries[0].file_type == Item.FileType.NONE
    assert snapshot.entries[1].item_count == 0


class ImmediateThread:
    def __init__(self, *, target: Any, daemon: bool) -> None:
        self.target = target
        self.daemon = daemon

    def start(self) -> None:
        self.target()


def build_manager_for_schedule() -> Any:
    dm = cast(Any, DataManager.__new__(DataManager))
    dm.file_op_lock = threading.Lock()
    dm.file_op_running = False
    dm.emit = MagicMock()
    return dm


def test_schedule_add_file_unlocks_and_hides_toast_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.add_file = MagicMock(side_effect=RuntimeError("boom"))

    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_add_file("/tmp/a.txt")

    assert dm.file_op_running is False
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.PROGRESS_TOAST_SHOW in events
    assert Base.Event.PROGRESS_TOAST_HIDE in events
    assert Base.Event.TOAST in events


def test_schedule_add_file_rejects_when_operation_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.file_op_running = True

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.__class__.instances.append(self)

        def start(self) -> None:
            pass

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    dm.schedule_add_file("/tmp/a.txt")

    assert FakeThread.instances == []
    dm.emit.assert_called_once()
    event, payload = dm.emit.call_args.args
    assert event == Base.Event.TOAST
    assert payload["type"] == Base.ToastType.WARNING


def test_schedule_add_file_emits_warning_toast_on_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.add_file = MagicMock(side_effect=ValueError("bad"))
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_add_file("/tmp/a.txt")

    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_add_file_success_runs_prefilter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.add_file = MagicMock()
    dm.run_project_prefilter = MagicMock()

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_add_file("/tmp/a.txt")

    dm.add_file.assert_called_once_with("/tmp/a.txt")
    dm.run_project_prefilter.assert_called_once_with(config, reason="file_op")
    assert dm.file_op_running is False
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.PROGRESS_TOAST_SHOW in events
    assert Base.Event.PROGRESS_TOAST_HIDE in events


def test_schedule_update_file_runs_and_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.update_file = MagicMock(return_value={"ok": True})
    dm.run_project_prefilter = MagicMock()
    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_update_file("a.txt", "/tmp/new.txt")

    dm.update_file.assert_called_once_with("a.txt", "/tmp/new.txt")
    dm.run_project_prefilter.assert_called_once_with(config, reason="file_op")
    assert dm.file_op_running is False
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.PROGRESS_TOAST_SHOW in events
    assert Base.Event.PROGRESS_TOAST_HIDE in events


def test_schedule_reset_file_emits_warning_toast_on_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.reset_file = MagicMock(side_effect=ValueError("bad"))
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_reset_file("a.txt")

    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_delete_file_emits_error_toast_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.delete_file = MagicMock(side_effect=RuntimeError("boom"))

    logger = SimpleNamespace(error=MagicMock())
    monkeypatch.setattr(data_manager_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_delete_file("a.txt")

    logger.error.assert_called_once()
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_update_reset_delete_reject_when_operation_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.file_op_running = True

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.__class__.instances.append(self)

        def start(self) -> None:
            pass

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    dm.schedule_update_file("a.txt", "/tmp/new.txt")
    dm.schedule_reset_file("a.txt")
    dm.schedule_delete_file("a.txt")

    assert FakeThread.instances == []
    assert dm.emit.call_count == 3


def test_schedule_update_file_emits_warning_toast_on_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.update_file = MagicMock(side_effect=ValueError("bad"))
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_update_file("a.txt", "/tmp/new.txt")

    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_update_file_emits_error_toast_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.update_file = MagicMock(side_effect=RuntimeError("boom"))

    logger = SimpleNamespace(error=MagicMock())
    monkeypatch.setattr(data_manager_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_update_file("a.txt", "/tmp/new.txt")

    logger.error.assert_called_once()
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_reset_file_success_runs_prefilter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.reset_file = MagicMock()
    dm.run_project_prefilter = MagicMock()

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_reset_file("a.txt")

    dm.reset_file.assert_called_once_with("a.txt")
    dm.run_project_prefilter.assert_called_once_with(config, reason="file_op")
    assert dm.file_op_running is False


def test_schedule_reset_file_emits_error_toast_on_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.reset_file = MagicMock(side_effect=RuntimeError("boom"))

    logger = SimpleNamespace(error=MagicMock())
    monkeypatch.setattr(data_manager_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_reset_file("a.txt")

    logger.error.assert_called_once()
    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_schedule_delete_file_success_runs_prefilter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.delete_file = MagicMock()
    dm.run_project_prefilter = MagicMock()

    config = SimpleNamespace()
    monkeypatch.setattr(
        data_manager_module, "Config", lambda: SimpleNamespace(load=lambda: config)
    )
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_delete_file("a.txt")

    dm.delete_file.assert_called_once_with("a.txt")
    dm.run_project_prefilter.assert_called_once_with(config, reason="file_op")
    assert dm.file_op_running is False


def test_schedule_delete_file_emits_warning_toast_on_value_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dm = build_manager_for_schedule()
    dm.delete_file = MagicMock(side_effect=ValueError("bad"))
    monkeypatch.setattr(data_manager_module.threading, "Thread", ImmediateThread)

    dm.schedule_delete_file("a.txt")

    events = [call.args[0] for call in dm.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert dm.file_op_running is False


def test_build_workbench_snapshot_treats_none_file_type_as_unset() -> None:
    dm = build_manager_for_snapshot(
        ["a.txt"],
        [
            {
                "file_path": "a.txt",
                "status": Base.ProjectStatus.NONE,
                "file_type": Item.FileType.NONE,
            }
        ],
    )

    snapshot = dm.build_workbench_snapshot()

    assert snapshot.total_items == 1
    assert snapshot.entries[0].item_count == 1
    assert snapshot.entries[0].file_type == Item.FileType.NONE
