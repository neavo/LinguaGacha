from __future__ import annotations

import json
import os
import signal
from pathlib import Path
from types import SimpleNamespace

import pytest

import base.Base as base_module
import base.VersionManager as version_manager_module
from base.Base import Base
from base.VersionManager import VersionManager


class FakeLogger:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.warning_messages: list[str] = []
        self.warning_exceptions: list[BaseException | None] = []
        self.error_messages: list[str] = []
        self.error_exceptions: list[BaseException | None] = []

    def info(self, msg: str, e: BaseException | None = None) -> None:
        del e
        self.info_messages.append(msg)

    def warning(self, msg: str, e: BaseException | None = None) -> None:
        self.warning_messages.append(msg)
        self.warning_exceptions.append(e)

    def error(self, msg: str, e: BaseException | None = None) -> None:
        self.error_messages.append(msg)
        self.error_exceptions.append(e)


class FakeThread:
    created: list["FakeThread"] = []

    def __init__(self, target, args: tuple[object, ...]) -> None:
        self.target = target
        self.args = args
        self.started = False
        type(self).created.append(self)

    def start(self) -> None:
        self.started = True


class FakeResponse:
    def __init__(self, *, json_data=None, text: str = "", headers=None) -> None:
        self.json_data = json_data
        self.text = text
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self.json_data


class FakeStreamResponse(FakeResponse):
    def __init__(self, *, chunks: list[bytes], headers=None) -> None:
        super().__init__(headers=headers)
        self.chunks = chunks

    def __enter__(self) -> "FakeStreamResponse":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        del exc_type, exc_val, exc_tb

    def iter_bytes(self, chunk_size: int):
        del chunk_size
        yield from self.chunks


@pytest.fixture(autouse=True)
def patch_version_runtime(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    fake_bus = SimpleNamespace(
        subscribe=lambda event, handler: None,
        unsubscribe=lambda event, handler: None,
        emit_event=lambda event, data: None,
    )
    logger = FakeLogger()
    localizer = SimpleNamespace(
        task_failed="task_failed",
        app_new_version_waiting_restart="waiting_restart",
        app_new_version_apply_failed="apply_failed",
        app_new_version_toast="发现新版本 {VERSION}",
        app_new_version_success="download_success",
        app_new_version_failure="download_failure",
    )
    monkeypatch.setattr(base_module.EventManager, "get", lambda: fake_bus)
    monkeypatch.setattr(version_manager_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(
        version_manager_module.Localizer,
        "get",
        staticmethod(lambda: localizer),
    )
    VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = None
    FakeThread.created = []
    if hasattr(VersionManager, "__instance__"):
        delattr(VersionManager, "__instance__")

    yield {"logger": logger, "localizer": localizer}

    VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = None
    if hasattr(VersionManager, "__instance__"):
        delattr(VersionManager, "__instance__")


def test_cleanup_update_temp_on_startup_cleans_stale_runtime_artifacts(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_dir = "C:/runtime/update"
    legacy_dir = "C:/app/resource/update"
    fs.create_dir(runtime_dir)
    fs.create_dir(legacy_dir)
    Path(f"{runtime_dir}/stage").mkdir(parents=True, exist_ok=True)
    Path(f"{legacy_dir}/backup").mkdir(parents=True, exist_ok=True)
    Path(f"{runtime_dir}/stage/file.txt").write_text("stage", encoding="utf-8")
    Path(f"{legacy_dir}/backup/file.txt").write_text("backup", encoding="utf-8")
    Path(f"{runtime_dir}/update.runtime.ps1").write_text("runtime", encoding="utf-8")
    Path(f"{legacy_dir}/update.runtime.extra.ps1").write_text(
        "runtime",
        encoding="utf-8",
    )
    expired_package = Path(runtime_dir) / VersionManager.TEMP_PACKAGE_FILE_NAME
    fresh_package = Path(legacy_dir) / VersionManager.TEMP_PACKAGE_FILE_NAME
    expired_package.write_bytes(b"old")
    fresh_package.write_bytes(b"fresh")
    now = 10_000.0
    os.utime(
        expired_package,
        (
            now - VersionManager.TEMP_PACKAGE_EXPIRE_SECONDS - 1,
            now - VersionManager.TEMP_PACKAGE_EXPIRE_SECONDS - 1,
        ),
    )
    os.utime(fresh_package, (now, now))
    monkeypatch.setattr(
        VersionManager,
        "get_update_runtime_search_dirs",
        lambda: (runtime_dir, legacy_dir),
    )
    monkeypatch.setattr(VersionManager, "load_pending_apply_result", lambda: None)
    monkeypatch.setattr(VersionManager, "is_updater_running", lambda: False)
    monkeypatch.setattr(version_manager_module.time, "time", lambda: now)

    VersionManager.cleanup_update_temp_on_startup()

    assert expired_package.exists() is False
    assert fresh_package.exists() is True
    assert Path(f"{runtime_dir}/stage").exists() is False
    assert Path(f"{legacy_dir}/backup").exists() is False
    assert Path(f"{runtime_dir}/update.runtime.ps1").exists() is False
    assert Path(f"{legacy_dir}/update.runtime.extra.ps1").exists() is False


def test_load_pending_apply_result_records_failure_log_and_removes_result_file(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_dir = "C:/runtime/update"
    fs.create_dir(runtime_dir)
    result_path = Path(runtime_dir) / VersionManager.UPDATE_RESULT_FILE_NAME
    result_path.write_text(
        json.dumps(
            {
                "status": "failed",
                "logPath": "C:/runtime/update/custom.log",
            }
        ),
        encoding="utf-8-sig",
    )
    monkeypatch.setattr(
        VersionManager,
        "get_update_runtime_search_dirs",
        lambda: (runtime_dir,),
    )

    VersionManager.load_pending_apply_result()

    assert VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH == os.path.abspath(
        "C:/runtime/update/custom.log"
    )
    assert result_path.exists() is False


def test_is_updater_running_keeps_active_lock_file_and_logs_pid(
    fs,
    monkeypatch: pytest.MonkeyPatch,
    patch_version_runtime: dict[str, object],
) -> None:
    runtime_dir = "C:/runtime/update"
    fs.create_dir(runtime_dir)
    lock_path = Path(runtime_dir) / VersionManager.UPDATE_LOCK_FILE_NAME
    lock_path.write_text(json.dumps({"pid": 321}), encoding="utf-8-sig")
    monkeypatch.setattr(
        VersionManager,
        "get_update_runtime_search_dirs",
        lambda: (runtime_dir,),
    )
    monkeypatch.setattr(VersionManager, "is_process_running", lambda pid: pid == 321)

    result = VersionManager.is_updater_running()

    logger = patch_version_runtime["logger"]
    assert result is True
    assert lock_path.exists() is True
    assert logger.info_messages == [
        "Updater is still running, skip startup cleanup (pid=321)"
    ]


def test_is_updater_running_removes_stale_lock_file(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_dir = "C:/runtime/update"
    fs.create_dir(runtime_dir)
    lock_path = Path(runtime_dir) / VersionManager.UPDATE_LOCK_FILE_NAME
    lock_path.write_text(json.dumps({"pid": 0}), encoding="utf-8-sig")
    monkeypatch.setattr(
        VersionManager,
        "get_update_runtime_search_dirs",
        lambda: (runtime_dir,),
    )

    result = VersionManager.is_updater_running()

    assert result is False
    assert lock_path.exists() is False


def test_emit_pending_apply_failure_if_exists_only_consumes_once() -> None:
    manager = VersionManager()
    captured_calls: list[tuple[Exception | None, str]] = []
    manager.emit_apply_failure = lambda e, log_path: captured_calls.append(
        (e, log_path)
    )
    VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = "C:/runtime/update.log"

    manager.emit_pending_apply_failure_if_exists()
    manager.emit_pending_apply_failure_if_exists()

    assert captured_calls == [(None, "C:/runtime/update.log")]
    assert VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH is None


def test_app_update_extract_ignores_non_request_events_and_non_windows_platform(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    monkeypatch.setattr(version_manager_module.sys, "platform", "linux")
    monkeypatch.setattr(version_manager_module.threading, "Thread", FakeThread)
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True

    manager.app_update_extract(
        Base.Event.APP_UPDATE_APPLY,
        {"sub_event": Base.SubEvent.RUN},
    )
    manager.app_update_extract(
        Base.Event.APP_UPDATE_APPLY,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted == []
    assert FakeThread.created == []


def test_app_update_extract_starts_background_apply_only_once_on_windows_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    started_threads: list[tuple[Base.Event, dict[str, object]]] = []
    started_workers: list[tuple[Base.Event, dict[str, object]]] = []

    class ImmediateThread:
        def __init__(self, target, args: tuple[object, ...]) -> None:
            self.target = target
            self.args = args

        def start(self) -> None:
            started_threads.append(self.args)
            self.target(*self.args)

    monkeypatch.setattr(version_manager_module.sys, "platform", "win32")
    monkeypatch.setattr(version_manager_module.threading, "Thread", ImmediateThread)
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(
        manager,
        "app_update_extract_task",
        lambda event, data: started_workers.append((event, data)),
    )

    manager.app_update_extract(
        Base.Event.APP_UPDATE_APPLY,
        {"sub_event": Base.SubEvent.REQUEST},
    )
    manager.app_update_extract(
        Base.Event.APP_UPDATE_APPLY,
        {"sub_event": Base.SubEvent.REQUEST},
    )

    assert emitted == [
        (
            Base.Event.APP_UPDATE_APPLY,
            {"sub_event": Base.SubEvent.RUN},
        )
    ]
    assert started_threads == [(Base.Event.APP_UPDATE_APPLY, {})]
    assert started_workers == [(Base.Event.APP_UPDATE_APPLY, {})]


@pytest.mark.parametrize(
    ("method_name", "event_name", "target_name"),
    [
        (
            "app_update_check_run",
            Base.Event.APP_UPDATE_CHECK,
            "app_update_check_start_task",
        ),
        (
            "app_update_download_run",
            Base.Event.APP_UPDATE_DOWNLOAD,
            "app_update_download_start_task",
        ),
    ],
)
def test_update_run_helpers_spawn_background_worker_for_request_events(
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    event_name: Base.Event,
    target_name: str,
) -> None:
    manager = VersionManager()
    request_payload = {"sub_event": Base.SubEvent.REQUEST, "token": "demo"}
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    started_threads: list[tuple[Base.Event, dict[str, object]]] = []
    started_workers: list[tuple[Base.Event, dict[str, object]]] = []

    class ImmediateThread:
        def __init__(self, target, args: tuple[object, ...]) -> None:
            self.target = target
            self.args = args

        def start(self) -> None:
            started_threads.append(self.args)
            self.target(*self.args)

    monkeypatch.setattr(version_manager_module.threading, "Thread", ImmediateThread)
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(
        manager,
        target_name,
        lambda event, data: started_workers.append((event, data)),
    )

    getattr(manager, method_name)(event_name, request_payload)

    assert emitted == [(event_name, {"sub_event": Base.SubEvent.RUN})]
    assert started_threads == [(event_name, request_payload)]
    assert started_workers == [(event_name, request_payload)]


def test_find_windows_update_assets_prefers_hash_for_selected_zip() -> None:
    manager = VersionManager()

    zip_url, hash_url = manager.find_windows_update_assets(
        [
            {"name": "LinguaGacha-win.zip", "browser_download_url": "zip-url"},
            {
                "name": "LinguaGacha-win.zip.sha256",
                "browser_download_url": "hash-url",
            },
            {"name": "LinguaGacha-mac.zip", "browser_download_url": "ignore"},
            {"name": "fallback.sha256", "browser_download_url": "other"},
        ]
    )

    assert zip_url == "zip-url"
    assert hash_url == "hash-url"


@pytest.mark.parametrize(
    ("assets", "message"),
    [
        (
            [{"name": "LinguaGacha-win.sha256", "browser_download_url": "hash"}],
            "no windows zip asset",
        ),
        (
            [{"name": "LinguaGacha-win.zip", "browser_download_url": "zip"}],
            "no sha256 asset for windows zip",
        ),
    ],
)
def test_find_windows_update_assets_rejects_incomplete_release_assets(
    assets: list[dict[str, str]],
    message: str,
) -> None:
    manager = VersionManager()

    with pytest.raises(Exception, match=message):
        manager.find_windows_update_assets(assets)


def test_fetch_expected_sha256_returns_lowercase_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        version_manager_module.httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(
            text="SHA256: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789"
        ),
    )

    result = VersionManager().fetch_expected_sha256("https://example.com/hash.sha256")

    assert result == "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"


def test_fetch_expected_sha256_rejects_invalid_hash_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        version_manager_module.httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(text="not-a-hash"),
    )

    with pytest.raises(Exception, match="invalid sha256 file content"):
        VersionManager().fetch_expected_sha256("https://example.com/hash.sha256")


def test_generate_runtime_updater_script_copies_template_file(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    template_dir = "C:/app/resource/update"
    runtime_dir = "C:/runtime/update"
    fs.create_dir(template_dir)
    Path(template_dir, VersionManager.UPDATER_TEMPLATE_FILE_NAME).write_text(
        "Write-Host demo",
        encoding="utf-8-sig",
    )
    monkeypatch.setattr(
        version_manager_module.BasePath,
        "get_update_template_dir",
        staticmethod(lambda: template_dir),
    )
    monkeypatch.setattr(VersionManager, "get_update_runtime_dir", lambda: runtime_dir)

    runtime_script_path = VersionManager().generate_runtime_updater_script()

    assert runtime_script_path == os.path.abspath(
        os.path.join(runtime_dir, VersionManager.UPDATER_RUNTIME_FILE_NAME)
    )
    assert (
        Path(runtime_script_path).read_text(encoding="utf-8-sig") == "Write-Host demo"
    )


def test_start_updater_process_requires_expected_sha256() -> None:
    manager = VersionManager()

    with pytest.raises(Exception, match="expected sha256 is empty"):
        manager.start_updater_process("C:/runtime/update.runtime.ps1")


def test_start_updater_process_invokes_powershell_with_runtime_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager()
    manager.set_expected_sha256("a" * 64)
    popen_calls: list[tuple[list[str], str, int]] = []
    monkeypatch.setattr(
        version_manager_module.BasePath, "get_app_dir", lambda: "C:/app"
    )
    monkeypatch.setattr(VersionManager, "get_update_runtime_dir", lambda: "C:/runtime")
    monkeypatch.setattr(
        manager,
        "find_powershell_executable",
        lambda: "C:/Program Files/PowerShell/7/pwsh.exe",
    )
    monkeypatch.setattr(version_manager_module.os, "getpid", lambda: 456)
    monkeypatch.setattr(
        version_manager_module.subprocess,
        "Popen",
        lambda command, cwd, creationflags: popen_calls.append(
            (command, cwd, creationflags)
        ),
    )

    manager.start_updater_process("C:/runtime/update.runtime.ps1")

    assert popen_calls == [
        (
            [
                "C:/Program Files/PowerShell/7/pwsh.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "C:/runtime/update.runtime.ps1",
                "-AppPid",
                "456",
                "-InstallDir",
                "C:/app",
                "-UpdateDir",
                os.path.abspath("C:/runtime"),
                "-ZipPath",
                os.path.abspath("C:/runtime/app.zip.temp"),
                "-ExpectedSha256",
                "a" * 64,
            ],
            "C:/app",
            0,
        )
    ]


@pytest.mark.parametrize(
    ("which_results", "expected"),
    [
        (
            {
                "pwsh": None,
                "pwsh.exe": "C:/Program Files/PowerShell/7/pwsh.exe",
            },
            "C:/Program Files/PowerShell/7/pwsh.exe",
        ),
        (
            {
                "pwsh": None,
                "pwsh.exe": None,
                "powershell": None,
                "powershell.exe": "C:/Windows/System32/powershell.exe",
            },
            "C:/Windows/System32/powershell.exe",
        ),
        ({}, "powershell.exe"),
    ],
)
def test_find_powershell_executable_prefers_declared_command_order(
    monkeypatch: pytest.MonkeyPatch,
    which_results: dict[str, str | None],
    expected: str,
) -> None:
    monkeypatch.setattr(
        version_manager_module.shutil,
        "which",
        lambda command_name: which_results.get(command_name),
    )

    assert VersionManager.find_powershell_executable() == expected


def test_emit_apply_failure_logs_and_emits_error_events(
    patch_version_runtime: dict[str, object],
) -> None:
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True

    manager.emit_apply_failure(RuntimeError("boom"), "C:/runtime/update.log")

    logger = patch_version_runtime["logger"]
    assert manager.get_status() == VersionManager.Status.FAILED
    assert logger.error_messages == ["task_failed"]
    assert isinstance(logger.error_exceptions[0], RuntimeError)
    assert emitted == [
        (Base.Event.PROGRESS_TOAST, {"sub_event": Base.SubEvent.DONE}),
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "apply_failed\nC:/runtime/update.log",
                "duration": 60 * 1000,
            },
        ),
        (
            Base.Event.APP_UPDATE_APPLY,
            {
                "sub_event": Base.SubEvent.ERROR,
                "log_path": "C:/runtime/update.log",
            },
        ),
    ]


def test_app_update_check_start_task_emits_new_version_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager.get()
    manager.set_version("v1.0.0")
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(
        version_manager_module.httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(json_data={"tag_name": "v1.2.0"}),
    )

    manager.app_update_check_start_task(Base.Event.APP_UPDATE_CHECK, {})

    assert manager.get_status() == VersionManager.Status.NEW_VERSION
    assert emitted == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": "发现新版本 v1.2.0",
                "duration": 60 * 1000,
            },
        ),
        (
            Base.Event.APP_UPDATE_CHECK,
            {"sub_event": Base.SubEvent.DONE, "new_version": True},
        ),
    ]


def test_app_update_check_start_task_reports_no_new_version_without_toast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager.get()
    manager.set_version("v1.2.0")
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(
        version_manager_module.httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(json_data={"tag_name": "v1.2.0"}),
    )

    manager.app_update_check_start_task(Base.Event.APP_UPDATE_CHECK, {})

    assert emitted == [
        (
            Base.Event.APP_UPDATE_CHECK,
            {"sub_event": Base.SubEvent.DONE, "new_version": False},
        )
    ]


def test_app_update_check_start_task_emits_error_when_release_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
    patch_version_runtime: dict[str, object],
) -> None:
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True

    def raise_network_error(*args: object, **kwargs: object) -> FakeResponse:
        del args, kwargs
        raise RuntimeError("network down")

    monkeypatch.setattr(version_manager_module.httpx, "get", raise_network_error)

    manager.app_update_check_start_task(Base.Event.APP_UPDATE_CHECK, {})

    logger = patch_version_runtime["logger"]
    assert logger.warning_messages == ["task_failed"]
    assert isinstance(logger.warning_exceptions[0], RuntimeError)
    assert emitted == [
        (
            Base.Event.APP_UPDATE_CHECK,
            {
                "sub_event": Base.SubEvent.ERROR,
                "message": "task_failed",
            },
        )
    ]


def test_app_update_download_start_task_uses_manual_flow_outside_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opened_urls: list[str] = []
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(version_manager_module.sys, "platform", "darwin")
    monkeypatch.setattr(
        version_manager_module.webbrowser,
        "open",
        lambda url: opened_urls.append(url),
    )

    manager.app_update_download_start_task(Base.Event.APP_UPDATE_DOWNLOAD, {})

    assert opened_urls == [VersionManager.get_release_url()]
    assert emitted == [
        (
            Base.Event.APP_UPDATE_DOWNLOAD,
            {"sub_event": Base.SubEvent.DONE, "manual": True},
        )
    ]


def test_app_update_download_start_task_windows_writes_package_and_emits_progress(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_dir = "C:/runtime/update"
    fs.create_dir(runtime_dir)
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(version_manager_module.sys, "platform", "win32")
    monkeypatch.setattr(VersionManager, "get_update_runtime_dir", lambda: runtime_dir)
    monkeypatch.setattr(
        version_manager_module.httpx,
        "get",
        lambda *args, **kwargs: FakeResponse(
            json_data={
                "assets": [
                    {
                        "name": "LinguaGacha-win.zip",
                        "browser_download_url": "https://example.com/app.zip",
                    },
                    {
                        "name": "LinguaGacha-win.zip.sha256",
                        "browser_download_url": "https://example.com/app.sha256",
                    },
                ]
            }
        ),
    )
    monkeypatch.setattr(
        manager,
        "fetch_expected_sha256",
        lambda hash_asset_url: "b" * 64,
    )
    monkeypatch.setattr(
        version_manager_module.httpx,
        "stream",
        lambda *args, **kwargs: FakeStreamResponse(
            chunks=[b"abc", b"def"],
            headers={"Content-Length": "6"},
        ),
    )

    manager.app_update_download_start_task(Base.Event.APP_UPDATE_DOWNLOAD, {})

    package_path = Path(runtime_dir) / VersionManager.TEMP_PACKAGE_FILE_NAME
    assert manager.get_status() == VersionManager.Status.DOWNLOADED
    assert manager.get_expected_sha256() == "b" * 64
    assert package_path.read_bytes() == b"abcdef"
    assert emitted == [
        (
            Base.Event.APP_UPDATE_DOWNLOAD,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "total_size": 6,
                "downloaded_size": 3,
            },
        ),
        (
            Base.Event.APP_UPDATE_DOWNLOAD,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "total_size": 6,
                "downloaded_size": 6,
            },
        ),
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": "download_success",
                "duration": 60 * 1000,
            },
        ),
        (
            Base.Event.APP_UPDATE_DOWNLOAD,
            {"sub_event": Base.SubEvent.DONE, "manual": False},
        ),
    ]


def test_app_update_download_start_task_windows_failure_resets_status_and_emits_error(
    monkeypatch: pytest.MonkeyPatch,
    patch_version_runtime: dict[str, object],
) -> None:
    manager = VersionManager()
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(version_manager_module.sys, "platform", "win32")

    def raise_network_error(*args: object, **kwargs: object) -> FakeResponse:
        del args, kwargs
        raise RuntimeError("download failed")

    monkeypatch.setattr(version_manager_module.httpx, "get", raise_network_error)

    manager.app_update_download_start_task(Base.Event.APP_UPDATE_DOWNLOAD, {})

    logger = patch_version_runtime["logger"]
    assert manager.get_status() == VersionManager.Status.NEW_VERSION
    assert logger.error_messages == ["task_failed"]
    assert isinstance(logger.error_exceptions[0], RuntimeError)
    assert emitted == [
        (
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": "download_failure",
                "duration": 60 * 1000,
            },
        ),
        (
            Base.Event.APP_UPDATE_DOWNLOAD,
            {"sub_event": Base.SubEvent.ERROR},
        ),
    ]


def test_app_update_extract_task_generates_runtime_script_and_terminates_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = VersionManager()
    manager.set_status(VersionManager.Status.DOWNLOADED)
    emitted: list[tuple[Base.Event, dict[str, object]]] = []
    started_scripts: list[str] = []
    killed: list[tuple[int, int]] = []
    manager.emit = lambda event, payload: emitted.append((event, payload)) or True
    monkeypatch.setattr(
        manager,
        "generate_runtime_updater_script",
        lambda: "C:/runtime/update.runtime.ps1",
    )
    monkeypatch.setattr(
        manager,
        "start_updater_process",
        lambda runtime_script_path: started_scripts.append(runtime_script_path),
    )
    monkeypatch.setattr(version_manager_module.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(version_manager_module.os, "getpid", lambda: 789)
    monkeypatch.setattr(
        version_manager_module.os,
        "kill",
        lambda pid, sig: killed.append((pid, sig)),
    )

    manager.app_update_extract_task(Base.Event.APP_UPDATE_APPLY, {})

    assert manager.get_status() == VersionManager.Status.APPLYING
    assert emitted == [
        (
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "message": "waiting_restart",
            },
        )
    ]
    assert started_scripts == ["C:/runtime/update.runtime.ps1"]
    assert killed == [(789, signal.SIGTERM)]
    assert manager.extracting is False
