from collections.abc import Callable

from api.Server.Routes.TaskRoutes import TaskRoutes


class RouteRecorder:
    """记录任务路由注册结果，避免把 handler 闭包结构误当成契约。"""

    def __init__(self) -> None:
        self.routes: list[tuple[str, str]] = []

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.routes.append((method, path))


def test_task_routes_paths_match_expected_contract() -> None:
    actual_paths = (
        TaskRoutes.START_TRANSLATION_PATH,
        TaskRoutes.STOP_TRANSLATION_PATH,
        TaskRoutes.RESET_TRANSLATION_ALL_PATH,
        TaskRoutes.RESET_TRANSLATION_FAILED_PATH,
        TaskRoutes.START_ANALYSIS_PATH,
        TaskRoutes.STOP_ANALYSIS_PATH,
        TaskRoutes.RESET_ANALYSIS_ALL_PATH,
        TaskRoutes.RESET_ANALYSIS_FAILED_PATH,
        TaskRoutes.IMPORT_ANALYSIS_GLOSSARY_PATH,
        TaskRoutes.SNAPSHOT_PATH,
        TaskRoutes.EXPORT_TRANSLATION_PATH,
    )

    assert actual_paths == (
        "/api/tasks/start-translation",
        "/api/tasks/stop-translation",
        "/api/tasks/reset-translation-all",
        "/api/tasks/reset-translation-failed",
        "/api/tasks/start-analysis",
        "/api/tasks/stop-analysis",
        "/api/tasks/reset-analysis-all",
        "/api/tasks/reset-analysis-failed",
        "/api/tasks/import-analysis-glossary",
        "/api/tasks/snapshot",
        "/api/tasks/export-translation",
    )


def test_task_routes_register_expected_http_contract() -> None:
    recorder = RouteRecorder()

    TaskRoutes.register(recorder, object())

    assert recorder.routes == [
        ("POST", TaskRoutes.START_TRANSLATION_PATH),
        ("POST", TaskRoutes.STOP_TRANSLATION_PATH),
        ("POST", TaskRoutes.RESET_TRANSLATION_ALL_PATH),
        ("POST", TaskRoutes.RESET_TRANSLATION_FAILED_PATH),
        ("POST", TaskRoutes.START_ANALYSIS_PATH),
        ("POST", TaskRoutes.STOP_ANALYSIS_PATH),
        ("POST", TaskRoutes.RESET_ANALYSIS_ALL_PATH),
        ("POST", TaskRoutes.RESET_ANALYSIS_FAILED_PATH),
        ("POST", TaskRoutes.IMPORT_ANALYSIS_GLOSSARY_PATH),
        ("POST", TaskRoutes.SNAPSHOT_PATH),
        ("POST", TaskRoutes.EXPORT_TRANSLATION_PATH),
    ]
