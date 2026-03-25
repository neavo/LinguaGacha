FRONTEND_CORE_FORBIDDEN_IMPORTS: tuple[str, ...] = (
    "from module.Data.DataManager import DataManager",
    "from module.Engine.Engine import Engine",
    "from base.EventManager import EventManager",
    "from module.Config import Config",
)

PHASE_ONE_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/AppFluentWindow.py",
    "frontend/ProjectPage.py",
    "frontend/Translation/TranslationPage.py",
    "frontend/Analysis/AnalysisPage.py",
    "frontend/Workbench/WorkbenchPage.py",
    "frontend/AppSettingsPage.py",
    "frontend/Setting/BasicSettingsPage.py",
    "frontend/Setting/ExpertSettingsPage.py",
)

PHASE_TWO_QUALITY_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Quality/CustomPromptPage.py",
    "frontend/Quality/GlossaryEditPanel.py",
    "frontend/Quality/GlossaryPage.py",
    "frontend/Quality/QualityRuleEditPanelBase.py",
    "frontend/Quality/QualityRuleIconHelper.py",
    "frontend/Quality/QualityRulePageBase.py",
    "frontend/Quality/QualityRulePresetManager.py",
    "frontend/Quality/TextPreserveEditPanel.py",
    "frontend/Quality/TextPreservePage.py",
    "frontend/Quality/TextReplacementEditPanel.py",
    "frontend/Quality/TextReplacementPage.py",
)

PHASE_TWO_PROOFREADING_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Proofreading/FilterDialog.py",
    "frontend/Proofreading/ProofreadingDomain.py",
    "frontend/Proofreading/ProofreadingEditPanel.py",
    "frontend/Proofreading/ProofreadingLabels.py",
    "frontend/Proofreading/ProofreadingLoadService.py",
    "frontend/Proofreading/ProofreadingPage.py",
    "frontend/Proofreading/ProofreadingStatusDelegate.py",
    "frontend/Proofreading/ProofreadingTableModel.py",
    "frontend/Proofreading/ProofreadingTableWidget.py",
)

PROOFREADING_HELPER_FORBIDDEN_IMPORTS: tuple[str, ...] = (
    "from module.Data.DataManager import DataManager",
    "from module.Config import Config",
    "from module.ResultChecker import ResultChecker",
)

PROOFREADING_HELPER_FILES: tuple[str, ...] = (
    "frontend/Proofreading/ProofreadingLoadService.py",
    "frontend/Proofreading/ProofreadingDomain.py",
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
