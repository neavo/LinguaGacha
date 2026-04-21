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


class StubCliManager:
    def __init__(self, *, is_cli_mode: bool, exit_code: int | None) -> None:
        self.is_cli_mode = is_cli_mode
        self.exit_code = exit_code
        self.run_calls: int = 0

    def run(self) -> bool:
        self.run_calls += 1
        return self.is_cli_mode

    def get_exit_code(self) -> int | None:
        return self.exit_code


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

    monkeypatch.setattr(app_module.ServerBootstrap, "start", lambda: runtime)

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
        raise_keyboard_interrupt,
    )
    monkeypatch.setattr(app_module, "cleanup_runtime", record_cleanup)

    app_module.run_headless_mode(logger=logger)

    assert cleanup_calls == [(runtime, logger)]


@pytest.mark.parametrize(
    ("exit_code", "expected_exit_code"),
    [(None, 0), (7, 7)],
)
def test_main_returns_cli_exit_code_and_cleans_up_runtime(
    monkeypatch: pytest.MonkeyPatch,
    exit_code: int | None,
    expected_exit_code: int,
) -> None:
    logger = RecordingLogger()
    cli_manager = StubCliManager(is_cli_mode=True, exit_code=exit_code)
    cleanup_calls: list[tuple[None, RecordingLogger]] = []

    def record_cleanup(
        *,
        local_api_server_runtime: None,
        logger: RecordingLogger,
    ) -> None:
        cleanup_calls.append((local_api_server_runtime, logger))

    monkeypatch.setattr(app_module, "bootstrap_runtime", lambda: logger)
    monkeypatch.setattr(app_module.CLIManager, "get", lambda: cli_manager)
    monkeypatch.setattr(app_module, "cleanup_runtime", record_cleanup)

    result = app_module.main()

    assert result == expected_exit_code
    assert cli_manager.run_calls == 1
    assert cleanup_calls == [(None, logger)]


def test_main_runs_headless_mode_when_cli_does_not_take_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = RecordingLogger()
    cli_manager = StubCliManager(is_cli_mode=False, exit_code=None)
    headless_loggers: list[RecordingLogger] = []

    monkeypatch.setattr(app_module, "bootstrap_runtime", lambda: logger)
    monkeypatch.setattr(app_module.CLIManager, "get", lambda: cli_manager)
    monkeypatch.setattr(
        app_module,
        "run_headless_mode",
        lambda *, logger: headless_loggers.append(logger),
    )

    result = app_module.main()

    assert result == 0
    assert cli_manager.run_calls == 1
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
