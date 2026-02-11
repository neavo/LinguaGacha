import importlib
from pathlib import Path
from types import SimpleNamespace
import threading
from typing import Any
from typing import cast
from unittest.mock import ANY
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Data.DataManager import ProjectPrefilterRequest
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Filter.ProjectPrefilter import ProjectPrefilterStats


data_manager_module = importlib.import_module("module.Data.DataManager")


def make_config(
    source_language: str = "EN",
    target_language: str = "ZH",
    mtool_optimizer_enable: bool = False,
) -> Any:
    return SimpleNamespace(
        source_language=source_language,
        target_language=target_language,
        mtool_optimizer_enable=mtool_optimizer_enable,
    )


def patch_engine_status(
    monkeypatch: pytest.MonkeyPatch, status: Base.TaskStatus
) -> None:
    fake_engine = SimpleNamespace(get_status=lambda: status)
    monkeypatch.setattr("module.Engine.Engine.Engine.get", lambda: fake_engine)


@pytest.fixture
def data_manager() -> Any:
    dm = cast(Any, DataManager.__new__(DataManager))
    dm.session = SimpleNamespace(db=object(), lg_path="demo/project.lg")
    dm.state_lock = threading.RLock()

    dm.prefilter_lock = threading.Lock()
    dm.prefilter_cond = threading.Condition(dm.prefilter_lock)
    dm.prefilter_running = False
    dm.prefilter_pending = False
    dm.prefilter_token = 0
    dm.prefilter_active_token = 0
    dm.prefilter_request_seq = 0
    dm.prefilter_last_handled_seq = 0
    dm.prefilter_latest_request = None

    dm.item_service = SimpleNamespace(clear_item_cache=MagicMock())
    dm.batch_service = SimpleNamespace(update_batch=MagicMock())
    dm.emit = MagicMock()

    return dm


def test_schedule_project_prefilter_returns_when_not_loaded(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    data_manager.session.db = None

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.__class__.instances.append(self)

        def start(self) -> None:
            pass

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    data_manager.schedule_project_prefilter(make_config(), reason="unit_test")

    assert data_manager.prefilter_running is False
    assert data_manager.prefilter_pending is False
    assert data_manager.prefilter_latest_request is None
    assert FakeThread.instances == []
    data_manager.emit.assert_not_called()


def test_schedule_project_prefilter_returns_when_engine_is_busy(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.TRANSLATING)

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.__class__.instances.append(self)

        def start(self) -> None:
            pass

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    data_manager.schedule_project_prefilter(make_config(), reason="engine_busy")

    assert data_manager.prefilter_running is False
    assert data_manager.prefilter_pending is False
    assert data_manager.prefilter_latest_request is None
    assert FakeThread.instances == []
    data_manager.emit.assert_not_called()


def test_schedule_project_prefilter_starts_worker_when_idle(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.IDLE)

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(
            self,
            *,
            target: Any,
            args: tuple[int, ...],
            daemon: bool,
        ) -> None:
            self.target = target
            self.args = args
            self.daemon = daemon
            self.started = False
            self.__class__.instances.append(self)

        def start(self) -> None:
            self.started = True

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    data_manager.schedule_project_prefilter(make_config(), reason="idle_start")

    assert data_manager.prefilter_running is True
    assert data_manager.prefilter_pending is True
    assert data_manager.prefilter_active_token == 1
    request = data_manager.prefilter_latest_request
    assert isinstance(request, ProjectPrefilterRequest)
    assert request.token == 1
    assert request.seq == 1
    assert request.reason == "idle_start"

    assert len(FakeThread.instances) == 1
    assert FakeThread.instances[0].args == (1,)
    assert FakeThread.instances[0].daemon is True
    assert FakeThread.instances[0].started is True

    data_manager.emit.assert_called_once()
    event, payload = data_manager.emit.call_args.args
    assert event == Base.Event.PROJECT_PREFILTER_RUN
    assert payload["reason"] == "idle_start"
    assert payload["token"] == 1
    assert payload["lg_path"] == "demo/project.lg"


def test_schedule_project_prefilter_merges_request_when_running(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.IDLE)
    data_manager.prefilter_running = True
    data_manager.prefilter_active_token = 9
    data_manager.prefilter_request_seq = 4

    class FakeThread:
        instances: list["FakeThread"] = []

        def __init__(self, **kwargs: Any) -> None:
            del kwargs
            self.__class__.instances.append(self)

        def start(self) -> None:
            pass

    monkeypatch.setattr(data_manager_module.threading, "Thread", FakeThread)

    data_manager.schedule_project_prefilter(make_config(), reason="merge")

    assert data_manager.prefilter_running is True
    assert data_manager.prefilter_pending is True
    request = data_manager.prefilter_latest_request
    assert isinstance(request, ProjectPrefilterRequest)
    assert request.token == 9
    assert request.seq == 5
    assert request.reason == "merge"
    assert FakeThread.instances == []
    data_manager.emit.assert_not_called()


def test_run_project_prefilter_merges_and_waits_when_running(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.IDLE)
    data_manager.prefilter_running = True
    data_manager.prefilter_active_token = 5

    wait_for_called = {"value": False}

    def fake_wait_for(predicate: Any) -> bool:
        data_manager.prefilter_running = False
        wait_for_called["value"] = True
        return bool(predicate())

    monkeypatch.setattr(data_manager.prefilter_cond, "wait_for", fake_wait_for)
    data_manager.project_prefilter_worker = MagicMock()

    data_manager.run_project_prefilter(make_config(), reason="running")

    assert wait_for_called["value"] is True
    request = data_manager.prefilter_latest_request
    assert isinstance(request, ProjectPrefilterRequest)
    assert request.token == 5
    assert request.reason == "running"
    assert data_manager.prefilter_pending is True
    data_manager.project_prefilter_worker.assert_not_called()
    data_manager.emit.assert_not_called()


def test_run_project_prefilter_returns_when_not_loaded(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.IDLE)
    data_manager.session.db = None
    data_manager.project_prefilter_worker = MagicMock()

    data_manager.run_project_prefilter(make_config(), reason="not_loaded")

    assert data_manager.prefilter_running is False
    data_manager.project_prefilter_worker.assert_not_called()
    data_manager.emit.assert_not_called()


def test_run_project_prefilter_returns_when_engine_busy(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.TRANSLATING)
    data_manager.project_prefilter_worker = MagicMock()

    data_manager.run_project_prefilter(make_config(), reason="engine_busy")

    assert data_manager.prefilter_running is False
    data_manager.project_prefilter_worker.assert_not_called()
    data_manager.emit.assert_not_called()


def test_run_project_prefilter_starts_sync_worker_when_idle(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    patch_engine_status(monkeypatch, Base.TaskStatus.IDLE)
    data_manager.project_prefilter_worker = MagicMock()

    data_manager.run_project_prefilter(make_config(), reason="sync_start")

    assert data_manager.prefilter_running is True
    assert data_manager.prefilter_pending is True
    request = data_manager.prefilter_latest_request
    assert isinstance(request, ProjectPrefilterRequest)
    assert request.token == 1
    assert request.reason == "sync_start"
    data_manager.project_prefilter_worker.assert_called_once_with(1)

    data_manager.emit.assert_called_once()
    event, payload = data_manager.emit.call_args.args
    assert event == Base.Event.PROJECT_PREFILTER_RUN
    assert payload["reason"] == "sync_start"


def test_apply_project_prefilter_once_returns_none_when_project_switched(
    data_manager: Any,
) -> None:
    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/old.lg",
        reason="switch",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )

    result = data_manager.apply_project_prefilter_once(request)

    assert result is None


def test_apply_project_prefilter_once_returns_none_when_not_loaded(
    data_manager: Any,
) -> None:
    data_manager.session.db = None
    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/project.lg",
        reason="not_loaded",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )

    assert data_manager.apply_project_prefilter_once(request) is None


def test_apply_project_prefilter_once_updates_batch_and_meta(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    class FakeLocalizer:
        toast_processing = "processing"

    monkeypatch.setattr(
        data_manager_module.Localizer, "get", staticmethod(lambda: FakeLocalizer)
    )

    items = [Item(id=1, src="A"), Item(id=2, src="B")]
    data_manager.get_all_items = lambda: items

    expected_result = ProjectPrefilterResult(
        stats=ProjectPrefilterStats(
            rule_skipped=0, language_skipped=0, mtool_skipped=0
        ),
        prefilter_config={
            "source_language": "EN",
            "target_language": "ZH",
            "mtool_optimizer_enable": False,
        },
    )
    project_prefilter_apply = MagicMock(return_value=expected_result)
    monkeypatch.setattr(
        data_manager_module.ProjectPrefilter, "apply", project_prefilter_apply
    )

    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/project.lg",
        reason="apply",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )

    result = data_manager.apply_project_prefilter_once(request)

    assert result == expected_result
    data_manager.item_service.clear_item_cache.assert_called_once()
    project_prefilter_apply.assert_called_once()
    data_manager.batch_service.update_batch.assert_called_once()

    call_kwargs = data_manager.batch_service.update_batch.call_args.kwargs
    assert call_kwargs["meta"] == {
        "prefilter_config": expected_result.prefilter_config,
        "source_language": "EN",
        "target_language": "ZH",
    }
    assert [item_dict["id"] for item_dict in call_kwargs["items"]] == [1, 2]

    show_event, show_payload = data_manager.emit.call_args_list[0].args
    assert show_event == Base.Event.PROGRESS_TOAST_SHOW
    assert show_payload["current"] == 0
    assert show_payload["total"] == 4
    assert show_payload["indeterminate"] is False


def test_apply_project_prefilter_once_emits_progress_update_via_callback(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    class FakeLocalizer:
        toast_processing = "processing"

    monkeypatch.setattr(
        data_manager_module.Localizer, "get", staticmethod(lambda: FakeLocalizer)
    )

    data_manager.get_all_items = lambda: [Item(id=1, src="A")]

    expected_result = ProjectPrefilterResult(
        stats=ProjectPrefilterStats(
            rule_skipped=0, language_skipped=0, mtool_skipped=0
        ),
        prefilter_config={
            "source_language": "EN",
            "target_language": "ZH",
            "mtool_optimizer_enable": False,
        },
    )

    def fake_apply(*, progress_cb: Any, **kwargs: Any) -> ProjectPrefilterResult:
        del kwargs
        progress_cb(1, 2)
        return expected_result

    monkeypatch.setattr(data_manager_module.ProjectPrefilter, "apply", fake_apply)

    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/project.lg",
        reason="apply_cb",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )

    result = data_manager.apply_project_prefilter_once(request)

    assert result == expected_result
    events = [call.args[0] for call in data_manager.emit.call_args_list]
    assert Base.Event.PROGRESS_TOAST_SHOW in events
    assert Base.Event.PROGRESS_TOAST_UPDATE in events


def test_apply_project_prefilter_once_drops_result_when_project_changes_before_write(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    class FakeLocalizer:
        toast_processing = "processing"

    monkeypatch.setattr(
        data_manager_module.Localizer, "get", staticmethod(lambda: FakeLocalizer)
    )

    data_manager.get_all_items = lambda: [Item(id=1, src="A")]

    def fake_apply(**kwargs: Any) -> ProjectPrefilterResult:
        del kwargs
        data_manager.session.lg_path = "demo/new_project.lg"
        return ProjectPrefilterResult(
            stats=ProjectPrefilterStats(
                rule_skipped=0,
                language_skipped=0,
                mtool_skipped=0,
            ),
            prefilter_config={
                "source_language": "EN",
                "target_language": "ZH",
                "mtool_optimizer_enable": False,
            },
        )

    monkeypatch.setattr(data_manager_module.ProjectPrefilter, "apply", fake_apply)

    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/project.lg",
        reason="switch_before_write",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )

    result = data_manager.apply_project_prefilter_once(request)

    assert result is None
    data_manager.batch_service.update_batch.assert_not_called()


def test_project_prefilter_worker_processes_one_request_and_emits_done(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    class FakeLocalizer:
        toast_processing = "processing"
        engine_task_rule_filter = "rule {COUNT}"
        engine_task_language_filter = "lang {COUNT}"
        translator_mtool_optimizer_pre_log = "mtool {COUNT}"

    monkeypatch.setattr(
        data_manager_module.Localizer, "get", staticmethod(lambda: FakeLocalizer)
    )

    logger = SimpleNamespace(info=MagicMock(), print=MagicMock(), error=MagicMock())
    monkeypatch.setattr(data_manager_module.LogManager, "get", lambda: logger)

    request = ProjectPrefilterRequest(
        token=7,
        seq=3,
        lg_path="demo/project.lg",
        reason="worker",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )
    data_manager.prefilter_running = True
    data_manager.prefilter_active_token = 7
    data_manager.prefilter_pending = True
    data_manager.prefilter_latest_request = request

    expected_result = ProjectPrefilterResult(
        stats=ProjectPrefilterStats(
            rule_skipped=1, language_skipped=2, mtool_skipped=3
        ),
        prefilter_config={},
    )
    data_manager.apply_project_prefilter_once = MagicMock(return_value=expected_result)

    data_manager.project_prefilter_worker(7)

    data_manager.apply_project_prefilter_once.assert_called_once_with(request)
    assert data_manager.prefilter_running is False
    assert data_manager.prefilter_active_token == 0
    assert data_manager.prefilter_last_handled_seq == 3

    events = [call.args[0] for call in data_manager.emit.call_args_list]
    assert Base.Event.PROGRESS_TOAST_SHOW in events
    assert Base.Event.PROGRESS_TOAST_HIDE in events
    assert Base.Event.PROJECT_PREFILTER_UPDATED in events
    assert Base.Event.PROJECT_PREFILTER_DONE in events


def test_project_prefilter_worker_emits_error_toast_on_exception(
    monkeypatch: pytest.MonkeyPatch, data_manager: Any
) -> None:
    class FakeLocalizer:
        toast_processing = "processing"
        task_failed = "failed"

    monkeypatch.setattr(
        data_manager_module.Localizer, "get", staticmethod(lambda: FakeLocalizer)
    )
    logger = SimpleNamespace(info=MagicMock(), print=MagicMock(), error=MagicMock())
    monkeypatch.setattr(data_manager_module.LogManager, "get", lambda: logger)

    request = ProjectPrefilterRequest(
        token=1,
        seq=1,
        lg_path="demo/project.lg",
        reason="boom",
        source_language="EN",
        target_language="ZH",
        mtool_optimizer_enable=False,
    )
    data_manager.prefilter_running = True
    data_manager.prefilter_active_token = 1
    data_manager.prefilter_pending = True
    data_manager.prefilter_latest_request = request

    data_manager.apply_project_prefilter_once = MagicMock(side_effect=RuntimeError("x"))

    data_manager.project_prefilter_worker(1)

    events = [call.args[0] for call in data_manager.emit.call_args_list]
    assert Base.Event.TOAST in events
    assert Base.Event.PROGRESS_TOAST_HIDE in events
    assert Base.Event.PROJECT_PREFILTER_DONE in events
    assert Base.Event.PROJECT_PREFILTER_UPDATED not in events


def build_manager_for_lifecycle() -> Any:
    dm = cast(Any, DataManager.__new__(DataManager))
    dm.session = SimpleNamespace(
        db=None,
        lg_path=None,
        state_lock=threading.RLock(),
        meta_cache={},
        rule_cache={},
        rule_text_cache={},
        item_cache=None,
        item_cache_index={},
        asset_decompress_cache={},
        clear_all_caches=MagicMock(),
    )
    dm.state_lock = dm.session.state_lock
    dm.meta_service = SimpleNamespace(refresh_cache_from_db=MagicMock())
    dm.item_service = SimpleNamespace(clear_item_cache=MagicMock())
    dm.asset_service = SimpleNamespace(clear_decompress_cache=MagicMock())
    dm.batch_service = SimpleNamespace(update_batch=MagicMock())
    dm.translation_item_service = SimpleNamespace(get_items_for_translation=MagicMock())
    dm.project_service = SimpleNamespace(
        SUPPORTED_EXTENSIONS={".txt"},
        collect_source_files=MagicMock(return_value=["a.txt"]),
        get_project_preview=MagicMock(return_value={"name": "demo"}),
    )
    dm.emit = MagicMock()
    return dm


def test_load_project_sets_session_and_clears_caches(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    lg_path = Path("/workspace/data_manager/project.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(set_meta=MagicMock(), close=MagicMock())
    monkeypatch.setattr(data_manager_module, "LGDatabase", lambda path: fake_db)

    def refresh_meta() -> None:
        dm.session.meta_cache = {}

    dm.meta_service.refresh_cache_from_db = refresh_meta

    dm.load_project(str(lg_path))

    assert dm.session.db is fake_db
    assert dm.session.lg_path == str(lg_path)
    fake_db.set_meta.assert_any_call("updated_at", ANY)
    fake_db.set_meta.assert_any_call("text_preserve_mode", "smart")
    dm.item_service.clear_item_cache.assert_called_once()
    dm.asset_service.clear_decompress_cache.assert_called_once()
    dm.emit.assert_called_once()


def test_load_project_unloads_existing_project_first(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    dm.session.db = object()
    dm.session.lg_path = "old.lg"
    dm.unload_project = MagicMock()

    lg_path = Path("/workspace/data_manager/existing/project.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(set_meta=MagicMock(), close=MagicMock())
    monkeypatch.setattr(data_manager_module, "LGDatabase", lambda path: fake_db)
    dm.meta_service.refresh_cache_from_db = lambda: setattr(
        dm.session, "meta_cache", {}
    )

    dm.load_project(str(lg_path))

    dm.unload_project.assert_called_once()


def test_load_project_raises_when_project_file_missing(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    missing_path = "/workspace/data_manager/missing.lg"
    monkeypatch.setattr(data_manager_module, "LGDatabase", MagicMock())

    with pytest.raises(FileNotFoundError, match="工程文件不存在"):
        dm.load_project(missing_path)

    assert data_manager_module.LGDatabase.call_count == 0


def test_load_project_migrates_text_preserve_mode_to_custom_when_legacy_enable_true(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    lg_path = Path("/workspace/data_manager/custom/project.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(set_meta=MagicMock(), close=MagicMock())
    monkeypatch.setattr(data_manager_module, "LGDatabase", lambda path: fake_db)

    def refresh_meta() -> None:
        dm.session.meta_cache = {"text_preserve_enable": True}

    dm.meta_service.refresh_cache_from_db = refresh_meta

    dm.load_project(str(lg_path))

    fake_db.set_meta.assert_any_call("text_preserve_mode", "custom")
    assert dm.session.meta_cache.get("text_preserve_mode") == "custom"


def test_load_project_migrates_text_preserve_mode_when_mode_string_invalid(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    lg_path = Path("/workspace/data_manager/invalid_mode/project.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(set_meta=MagicMock(), close=MagicMock())
    monkeypatch.setattr(data_manager_module, "LGDatabase", lambda path: fake_db)

    def refresh_meta() -> None:
        dm.session.meta_cache = {"text_preserve_mode": "BAD"}

    dm.meta_service.refresh_cache_from_db = refresh_meta

    dm.load_project(str(lg_path))

    fake_db.set_meta.assert_any_call("text_preserve_mode", "smart")
    assert dm.session.meta_cache.get("text_preserve_mode") == "smart"


def test_load_project_does_not_migrate_text_preserve_mode_when_mode_is_valid(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    dm = build_manager_for_lifecycle()
    lg_path = Path("/workspace/data_manager/valid_mode/project.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(set_meta=MagicMock(), close=MagicMock())
    monkeypatch.setattr(data_manager_module, "LGDatabase", lambda path: fake_db)

    def refresh_meta() -> None:
        dm.session.meta_cache = {"text_preserve_mode": "off"}

    dm.meta_service.refresh_cache_from_db = refresh_meta

    dm.load_project(str(lg_path))

    assert all(
        call.args[0] != "text_preserve_mode" for call in fake_db.set_meta.call_args_list
    )
    assert dm.session.meta_cache.get("text_preserve_mode") == "off"


def test_unload_project_closes_db_and_emits_event() -> None:
    dm = build_manager_for_lifecycle()
    fake_db = SimpleNamespace(close=MagicMock())
    dm.session.db = fake_db
    dm.session.lg_path = "demo.lg"

    dm.unload_project()

    fake_db.close.assert_called_once()
    assert dm.session.db is None
    assert dm.session.lg_path is None
    dm.session.clear_all_caches.assert_called_once()
    dm.emit.assert_called_once_with(Base.Event.PROJECT_UNLOADED, {"path": "demo.lg"})


def test_unload_project_does_not_emit_when_no_old_path() -> None:
    dm = build_manager_for_lifecycle()
    dm.session.db = None
    dm.session.lg_path = None

    dm.unload_project()

    dm.emit.assert_not_called()
    dm.session.clear_all_caches.assert_called_once()


def test_data_access_proxy_methods_delegate_to_services() -> None:
    dm = build_manager_for_lifecycle()

    dm.translation_item_service.get_items_for_translation.return_value = [Item(src="A")]
    items = dm.get_items_for_translation(make_config(), Base.TranslationMode.NEW)
    assert len(items) == 1

    assert dm.get_supported_extensions() == {".txt"}
    assert dm.collect_source_files("src") == ["a.txt"]
    assert dm.get_project_preview("demo.lg") == {"name": "demo"}
