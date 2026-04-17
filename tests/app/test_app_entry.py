from types import SimpleNamespace

import app as app_module


def test_run_headless_mode_starts_server_waits_then_cleans_up(monkeypatch) -> None:
    lifecycle: list[str] = []
    runtime = SimpleNamespace(
        base_url="http://127.0.0.1:9123",
        shutdown=lambda: lifecycle.append("shutdown"),
    )

    monkeypatch.setattr(
        app_module.ServerBootstrap,
        "start",
        staticmethod(lambda: runtime),
    )
    monkeypatch.setattr(
        app_module,
        "wait_for_headless_shutdown",
        lambda: lifecycle.append("wait"),
    )
    monkeypatch.setattr(
        app_module,
        "cleanup_runtime",
        lambda *, local_api_server_runtime, logger: (
            lifecycle.append("cleanup"),
            local_api_server_runtime.shutdown(),
        ),
    )

    app_module.run_headless_mode(logger=SimpleNamespace(shutdown=lambda: None))

    assert lifecycle == ["wait", "cleanup", "shutdown"]


def test_cleanup_runtime_shuts_down_server_unloads_project_and_logger(
    monkeypatch,
) -> None:
    shutdown_calls: list[str] = []
    logger_calls: list[str] = []
    runtime = SimpleNamespace(shutdown=lambda: shutdown_calls.append("runtime"))
    fake_data_manager = SimpleNamespace(
        is_loaded=lambda: True,
        unload_project=lambda: shutdown_calls.append("project"),
    )
    monkeypatch.setattr(app_module.DataManager, "get", lambda: fake_data_manager)

    logger = SimpleNamespace(shutdown=lambda: logger_calls.append("logger"))

    app_module.cleanup_runtime(
        local_api_server_runtime=runtime,
        logger=logger,
    )

    assert shutdown_calls == ["runtime", "project"]
    assert logger_calls == ["logger"]
