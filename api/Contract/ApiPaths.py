class SettingsApiPaths:
    """公开设置 API 路径常量；服务端实现不再由 Python Core 承载。"""

    SNAPSHOT_PATH: str = "/api/settings/app"
    UPDATE_PATH: str = "/api/settings/update"
    ADD_RECENT_PROJECT_PATH: str = "/api/settings/recent-projects/add"
    REMOVE_RECENT_PROJECT_PATH: str = "/api/settings/recent-projects/remove"


class ModelApiPaths:
    """公开模型 API 路径常量，供 TS Gateway 与 Python 客户端共享契约。"""

    SNAPSHOT_PATH: str = "/api/models/snapshot"
    UPDATE_PATH: str = "/api/models/update"
    ACTIVATE_PATH: str = "/api/models/activate"
    ADD_PATH: str = "/api/models/add"
    DELETE_PATH: str = "/api/models/delete"
    RESET_PRESET_PATH: str = "/api/models/reset-preset"
    REORDER_PATH: str = "/api/models/reorder"
    LIST_AVAILABLE_PATH: str = "/api/models/list-available"
    TEST_PATH: str = "/api/models/test"


class QualityApiPaths:
    """公开质量规则 API 路径常量；页面读写由 Electron main 实现。"""

    UPDATE_META_PATH: str = "/api/quality/rules/update-meta"
    SAVE_ENTRIES_PATH: str = "/api/quality/rules/save-entries"
    IMPORT_RULES_PATH: str = "/api/quality/rules/import"
    EXPORT_RULES_PATH: str = "/api/quality/rules/export"
    RULE_PRESETS_PATH: str = "/api/quality/rules/presets"
    RULE_PRESET_READ_PATH: str = "/api/quality/rules/presets/read"
    RULE_PRESET_SAVE_PATH: str = "/api/quality/rules/presets/save"
    RULE_PRESET_RENAME_PATH: str = "/api/quality/rules/presets/rename"
    RULE_PRESET_DELETE_PATH: str = "/api/quality/rules/presets/delete"
    PROMPT_TEMPLATE_PATH: str = "/api/quality/prompts/template"
    PROMPT_SAVE_PATH: str = "/api/quality/prompts/save"
    PROMPT_IMPORT_PATH: str = "/api/quality/prompts/import"
    PROMPT_EXPORT_PATH: str = "/api/quality/prompts/export"
    PROMPT_PRESETS_PATH: str = "/api/quality/prompts/presets"
    PROMPT_PRESET_READ_PATH: str = "/api/quality/prompts/presets/read"
    PROMPT_PRESET_SAVE_PATH: str = "/api/quality/prompts/presets/save"
    PROMPT_PRESET_RENAME_PATH: str = "/api/quality/prompts/presets/rename"
    PROMPT_PRESET_DELETE_PATH: str = "/api/quality/prompts/presets/delete"
