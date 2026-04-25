from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import app as app_module


class RecordingLogger:
    def __init__(self) -> None:
        self.info_messages: list[str] = []
        self.print_messages: list[str] = []
        self.shutdown_calls: int = 0

    def info(self, message: str) -> None:
        self.info_messages.append(message)

    def print(self, message: str) -> None:
        self.print_messages.append(message)

    def shutdown(self) -> None:
        self.shutdown_calls += 1


class RecordingServerRuntime:
    def __init__(self) -> None:
        self.shutdown_calls: int = 0

    def shutdown(self) -> None:
        self.shutdown_calls += 1


class RecordingDataManager:
    def __init__(self, *, loaded: bool) -> None:
        self.loaded = loaded
        self.unload_calls: int = 0

    def is_loaded(self) -> bool:
        return self.loaded

    def unload_project(self) -> None:
        self.unload_calls += 1


class RecordingEngine:
    def __init__(self) -> None:
        self.run_calls: int = 0

    def run(self) -> None:
        self.run_calls += 1


class RecordingVersionManager:
    def __init__(self) -> None:
        self.versions: list[str] = []

    def set_version(self, version: str) -> None:
        self.versions.append(version)


class FakeLifecycleRequestHandler:
    def __init__(self, *, token: str) -> None:
        self.headers = {
            app_module.CoreLifecycleAppService.SHUTDOWN_TOKEN_HEADER: token,
        }


@pytest.mark.parametrize(
    ("has_runtime", "project_loaded"),
    [(True, True), (False, False)],
)
def test_cleanup_runtime_releases_only_existing_resources(
    monkeypatch: pytest.MonkeyPatch,
    has_runtime: bool,
    project_loaded: bool,
) -> None:
    logger = RecordingLogger()
    runtime = RecordingServerRuntime() if has_runtime else None
    data_manager = RecordingDataManager(loaded=project_loaded)

    monkeypatch.setattr(app_module.DataManager, "get", lambda: data_manager)

    app_module.cleanup_runtime(
        local_api_server_runtime=runtime,
        logger=logger,
    )

    runtime_shutdown_calls = 0 if runtime is None else runtime.shutdown_calls
    assert runtime_shutdown_calls == int(has_runtime)
    assert data_manager.unload_calls == int(project_loaded)
    assert logger.shutdown_calls == 1


def test_run_headless_mode_cleans_up_after_keyboard_interrupt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = RecordingLogger()
    runtime = RecordingServerRuntime()
    cleanup_calls: list[tuple[RecordingServerRuntime, RecordingLogger]] = []

    monkeypatch.setattr(
        app_module.ServerBootstrap,
        "start",
        lambda **kwargs: runtime,
    )

    def raise_keyboard_interrupt() -> None:
        raise KeyboardInterrupt()

    def record_cleanup(
        *,
        local_api_server_runtime: RecordingServerRuntime,
        logger: RecordingLogger,
    ) -> None:
        cleanup_calls.append((local_api_server_runtime, logger))

    monkeypatch.setattr(
        app_module,
        "wait_for_headless_shutdown",
        lambda event: raise_keyboard_interrupt(),
    )
    monkeypatch.setattr(
        app_module,
        "install_shutdown_signal_handlers",
        lambda shutdown_event: None,
    )
    monkeypatch.setattr(
        app_module,
        "start_parent_process_watchdog",
        lambda *, shutdown_event, logger: None,
    )
    monkeypatch.setattr(app_module, "cleanup_runtime", record_cleanup)

    app_module.run_headless_mode(logger=logger)

    assert cleanup_calls == [(runtime, logger)]


def test_run_headless_mode_registers_lifecycle_shutdown_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = RecordingLogger()
    runtime = RecordingServerRuntime()
    captured_services: list[app_module.CoreLifecycleAppService] = []

    monkeypatch.setenv(app_module.CORE_INSTANCE_TOKEN_ENV_NAME, "core-token")
    monkeypatch.setattr(
        app_module.ServerBootstrap,
        "start",
        lambda **kwargs: (
            captured_services.append(kwargs["core_lifecycle_app_service"]) or runtime
        ),
    )
    monkeypatch.setattr(
        app_module,
        "install_shutdown_signal_handlers",
        lambda shutdown_event: None,
    )
    monkeypatch.setattr(
        app_module,
        "start_parent_process_watchdog",
        lambda *, shutdown_event, logger: None,
    )
    monkeypatch.setattr(
        app_module,
        "cleanup_runtime",
        lambda *, local_api_server_runtime, logger: None,
    )

    def request_shutdown(shutdown_event) -> None:
        captured_services[0].shutdown(
            {},
            FakeLifecycleRequestHandler(token="core-token"),
        )
        assert shutdown_event.wait(timeout=1)

    monkeypatch.setattr(app_module, "wait_for_headless_shutdown", request_shutdown)
    monkeypatch.setattr(
        app_module,
        "request_shutdown_after_response",
        lambda shutdown_event: shutdown_event.set(),
    )

    app_module.run_headless_mode(logger=logger)

    assert len(captured_services) == 1


def test_load_parent_pid_rejects_missing_or_invalid_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(app_module.PARENT_PID_ENV_NAME, raising=False)
    assert app_module.load_parent_pid() is None

    monkeypatch.setenv(app_module.PARENT_PID_ENV_NAME, "not-a-pid")
    assert app_module.load_parent_pid() is None

    monkeypatch.setenv(app_module.PARENT_PID_ENV_NAME, "-1")
    assert app_module.load_parent_pid() is None


def test_load_parent_pid_returns_positive_integer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(app_module.PARENT_PID_ENV_NAME, "4321")

    assert app_module.load_parent_pid() == 4321


def test_main_ignores_legacy_cli_args_and_runs_headless_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = RecordingLogger()
    headless_loggers: list[RecordingLogger] = []

    monkeypatch.setattr(app_module, "bootstrap_runtime", lambda: logger)
    monkeypatch.setattr(
        app_module,
        "run_headless_mode",
        lambda *, logger: headless_loggers.append(logger),
    )

    result = app_module.main(["app.py", "--cli", "--project=demo.lg"])

    assert result == 0
    assert headless_loggers == [logger]


def test_main_runs_headless_mode_without_legacy_cli_args(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = RecordingLogger()
    headless_loggers: list[RecordingLogger] = []

    monkeypatch.setattr(app_module, "bootstrap_runtime", lambda: logger)
    monkeypatch.setattr(
        app_module,
        "run_headless_mode",
        lambda *, logger: headless_loggers.append(logger),
    )

    result = app_module.main(["app.py"])

    assert result == 0
    assert headless_loggers == [logger]


def test_bootstrap_runtime_loads_version_and_initializes_runtime(
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_dir = Path(app_module.os.path.abspath(app_module.os.sep)) / "linguagacha-app"
    version_path = app_dir / app_module.APP_VERSION_FILE_NAME
    logger = RecordingLogger()
    engine = RecordingEngine()
    version_manager = RecordingVersionManager()
    cleanup_calls: list[str] = []
    migration_calls: list[str] = []
    language_calls: list[str] = []
    changed_dirs: list[str] = []

    fs.create_dir(str(app_dir))
    version_path.write_text("v9.9.9\n", encoding="utf-8")

    class StubConfig:
        def load(self) -> SimpleNamespace:
            return SimpleNamespace(app_language="en")

    monkeypatch.setattr(app_module.sys, "frozen", False, raising=False)
    monkeypatch.setattr(app_module.sys, "path", list(app_module.sys.path))
    monkeypatch.setattr(
        app_module.sys,
        "excepthook",
        lambda exc_type, exc_value, exc_traceback: None,
    )
    monkeypatch.setattr(
        app_module.sys,
        "unraisablehook",
        lambda unraisable: None,
    )
    monkeypatch.setattr(app_module.threading, "excepthook", lambda args: None)
    monkeypatch.setattr(
        app_module.BasePath,
        "resolve_app_dir",
        lambda: str(app_dir),
    )
    monkeypatch.setattr(
        app_module.os,
        "chdir",
        lambda directory: changed_dirs.append(directory),
    )
    monkeypatch.setattr(
        app_module,
        "disable_windows_quick_edit_mode",
        lambda: None,
    )
    monkeypatch.setattr(
        app_module.VersionManager,
        "cleanup_update_temp_on_startup",
        lambda: cleanup_calls.append("cleanup"),
    )
    monkeypatch.setattr(
        app_module.UserDataMigrationService,
        "run_startup_migrations",
        lambda: migration_calls.append("migrated"),
    )
    monkeypatch.setattr(app_module, "Config", StubConfig)
    monkeypatch.setattr(
        app_module.Localizer,
        "set_app_language",
        lambda language: language_calls.append(language),
    )
    monkeypatch.setattr(app_module.LogManager, "get", lambda: logger)
    monkeypatch.setattr(app_module.Engine, "get", lambda: engine)
    monkeypatch.setattr(
        app_module.VersionManager,
        "get",
        lambda: version_manager,
    )

    result = app_module.bootstrap_runtime()

    assert result is logger
    assert cleanup_calls == ["cleanup"]
    assert migration_calls == ["migrated"]
    assert language_calls == ["en"]
    assert changed_dirs == [str(app_dir)]
    assert app_module.BasePath.get_app_dir() == str(app_dir)
    assert str(app_dir) in app_module.sys.path
    assert engine.run_calls == 1
    assert version_manager.versions == ["v9.9.9"]
    assert logger.info_messages == [f"{app_module.Base.APP_NAME} v9.9.9"]
    assert logger.print_messages == [""]
    assert app_module.sys.excepthook is app_module.excepthook
    assert app_module.sys.unraisablehook is app_module.unraisable_hook
    assert app_module.threading.excepthook is app_module.thread_excepthook
