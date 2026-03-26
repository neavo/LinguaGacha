# 服务端路由契约常量放在最近作用域，避免把纯服务端约束继续挂在 tests/api 根目录。
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
