from collections.abc import Callable


class RouteRecorder:
    """记录路由注册结果，避免把闭包实现细节误当成公开契约。"""

    def __init__(self) -> None:
        self.json_routes: list[tuple[str, str]] = []
        self.stream_routes: list[str] = []

    def add_json_route(
        self,
        method: str,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.json_routes.append((method, path))

    def add_stream_route(
        self,
        path: str,
        handler: Callable[..., object],
    ) -> None:
        del handler
        self.stream_routes.append(path)


# 服务端路由契约常量放在最近作用域，避免把纯服务端约束继续挂在 tests/api 根目录。
MODEL_ROUTE_PATHS: tuple[str, ...] = (
    "/api/models/snapshot",
    "/api/models/update",
    "/api/models/activate",
    "/api/models/add",
    "/api/models/delete",
    "/api/models/reset-preset",
    "/api/models/reorder",
    "/api/models/list-available",
    "/api/models/test",
)

PROJECT_ROUTE_PATHS: tuple[str, ...] = (
    "/api/project/load",
    "/api/project/create",
    "/api/project/snapshot",
    "/api/project/unload",
    "/api/project/extensions",
    "/api/project/source-files",
    "/api/project/preview",
)

PHASE_TWO_QUALITY_ROUTE_PATHS: tuple[str, ...] = (
    "/api/quality/rules/snapshot",
    "/api/quality/rules/update-meta",
    "/api/quality/rules/save-entries",
    "/api/quality/rules/import",
    "/api/quality/rules/export",
    "/api/quality/rules/presets",
    "/api/quality/rules/presets/read",
    "/api/quality/rules/presets/save",
    "/api/quality/rules/presets/rename",
    "/api/quality/rules/presets/delete",
    "/api/quality/rules/query-proofreading",
    "/api/quality/rules/statistics",
    "/api/quality/prompts/snapshot",
    "/api/quality/prompts/template",
    "/api/quality/prompts/save",
    "/api/quality/prompts/import",
    "/api/quality/prompts/export",
    "/api/quality/prompts/presets",
    "/api/quality/prompts/presets/read",
    "/api/quality/prompts/presets/save",
    "/api/quality/prompts/presets/rename",
    "/api/quality/prompts/presets/delete",
)

PHASE_TWO_PROOFREADING_ROUTE_PATHS: tuple[str, ...] = (
    "/api/proofreading/snapshot",
    "/api/proofreading/file-patch",
    "/api/proofreading/entry-patch",
    "/api/proofreading/filter",
    "/api/proofreading/search",
    "/api/proofreading/save-item",
    "/api/proofreading/save-all",
    "/api/proofreading/replace-all",
    "/api/proofreading/recheck-item",
    "/api/proofreading/retranslate-items",
)

PHASE_TWO_SPEC_ROUTE_PATHS: tuple[str, ...] = (
    *PHASE_TWO_QUALITY_ROUTE_PATHS,
    *PHASE_TWO_PROOFREADING_ROUTE_PATHS,
)

SETTINGS_ROUTE_PATHS: tuple[str, ...] = (
    "/api/settings/app",
    "/api/settings/update",
    "/api/settings/recent-projects/add",
    "/api/settings/recent-projects/remove",
)

TASK_ROUTE_PATHS: tuple[str, ...] = (
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

WORKBENCH_ROUTE_PATHS: tuple[str, ...] = (
    "/api/workbench/snapshot",
    "/api/workbench/add-file",
    "/api/workbench/replace-file",
    "/api/workbench/replace-file-batch",
    "/api/workbench/reset-file",
    "/api/workbench/reset-file-batch",
    "/api/workbench/delete-file",
    "/api/workbench/delete-file-batch",
    "/api/workbench/reorder-files",
    "/api/workbench/file-patch",
    "/api/workbench/extensions",
)

PHASE_THREE_EXTRA_ROUTE_PATHS: tuple[str, ...] = (
    "/api/extra/ts-conversion/options",
    "/api/extra/ts-conversion/start",
    "/api/extra/name-fields/snapshot",
    "/api/extra/name-fields/extract",
    "/api/extra/name-fields/translate",
    "/api/extra/name-fields/save-to-glossary",
)

PHASE_THREE_EXTRA_TOPIC_NAMES: tuple[str, ...] = (
    "extra.ts_conversion_progress",
    "extra.ts_conversion_finished",
)

EVENT_STREAM_PATH: str = "/api/events/stream"
