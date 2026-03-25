import re
from pathlib import Path

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Client.AppClientContext import AppClientContext

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

PHASE_TWO_SPEC_ROUTE_PATHS: tuple[str, ...] = (
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
    "/api/proofreading/snapshot",
    "/api/proofreading/filter",
    "/api/proofreading/search",
    "/api/proofreading/save-item",
    "/api/proofreading/save-all",
    "/api/proofreading/replace-all",
    "/api/proofreading/recheck-item",
    "/api/proofreading/retranslate-items",
)


def test_app_client_context_groups_ui_clients() -> None:
    context = AppClientContext(
        project_api_client=ProjectApiClient.__new__(ProjectApiClient),
        task_api_client=TaskApiClient.__new__(TaskApiClient),
        workbench_api_client=WorkbenchApiClient.__new__(WorkbenchApiClient),
        settings_api_client=SettingsApiClient.__new__(SettingsApiClient),
        quality_rule_api_client=QualityRuleApiClient.__new__(QualityRuleApiClient),
        proofreading_api_client=ProofreadingApiClient.__new__(ProofreadingApiClient),
        api_state_store=ApiStateStore(),
    )

    assert isinstance(context.api_state_store, ApiStateStore)
    assert isinstance(context.quality_rule_api_client, QualityRuleApiClient)
    assert isinstance(context.proofreading_api_client, ProofreadingApiClient)


def test_api_application_layer_does_not_import_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    application_dir = root_dir / "api" / "Application"

    for file_path in application_dir.glob("*.py"):
        content = file_path.read_text(encoding="utf-8")
        assert "from api.Client" not in content
        assert "import api.Client" not in content


def test_ui_bootstrap_imports_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    app_content = (root_dir / "app.py").read_text(encoding="utf-8")
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.AppClientContext import AppClientContext" in app_content
    assert "from api.Client.AppClientContext import AppClientContext" in window_content
    assert "from api.Application.AppContext import AppContext" not in app_content
    assert "from api.Application.AppContext import AppContext" not in window_content
    assert "quality_rule_api_client=QualityRuleApiClient(api_client)" in app_content
    assert "proofreading_api_client=ProofreadingApiClient(api_client)" in app_content
    assert (
        "self.quality_rule_api_client = app_client_context.quality_rule_api_client"
        in window_content
    )
    assert (
        "self.proofreading_api_client = app_client_context.proofreading_api_client"
        in window_content
    )
    assert re.search(
        r"self\.proofreading_page = ProofreadingPage\(\s*"
        r"\"proofreading_page\",\s*"
        r"self\.proofreading_api_client,\s*"
        r"self\.api_state_store,\s*"
        r"self,\s*\)",
        window_content,
        re.MULTILINE,
    )


def test_frontend_core_design_doc_uses_app_client_context() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (
        root_dir
        / "docs"
        / "superpowers"
        / "specs"
        / "2026-03-24-frontend-core-separation-design.md"
    ).read_text(encoding="utf-8")

    assert "AppClientContext.py" in spec_content
    assert "AppContext.py" not in spec_content


def test_phase_two_frontend_boundary_lists_are_declared_in_single_source() -> None:
    assert PHASE_TWO_QUALITY_FRONTEND_FILES
    assert PHASE_TWO_PROOFREADING_FRONTEND_FILES
    assert len(set(PHASE_ONE_FRONTEND_FILES)) == len(PHASE_ONE_FRONTEND_FILES)
    assert len(set(PHASE_TWO_QUALITY_FRONTEND_FILES)) == len(
        PHASE_TWO_QUALITY_FRONTEND_FILES
    )
    assert len(set(PHASE_TWO_PROOFREADING_FRONTEND_FILES)) == len(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PHASE_ONE_FRONTEND_FILES).isdisjoint(PHASE_TWO_QUALITY_FRONTEND_FILES)
    assert set(PHASE_ONE_FRONTEND_FILES).isdisjoint(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PHASE_TWO_QUALITY_FRONTEND_FILES).isdisjoint(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PROOFREADING_HELPER_FILES).issubset(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )


def test_api_spec_documents_phase_two_routes_topics_and_errors() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    spec_content = (root_dir / "api" / "SPEC.md").read_text(encoding="utf-8")

    for route_path in PHASE_TWO_SPEC_ROUTE_PATHS:
        assert route_path in spec_content

    assert "proofreading.snapshot_invalidated" in spec_content
    assert "REVISION_CONFLICT" in spec_content
    assert '{"snapshot": {...}}' in spec_content
    assert '{"search_result": {...}}' in spec_content
    assert '{"result": {...}}' in spec_content
    assert '{"prompt": {...}}' in spec_content
