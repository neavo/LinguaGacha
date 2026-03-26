from pathlib import Path

# 这组守卫只约束 frontend 目录，放在 tests/frontend 下可以避免继续污染 tests/api 的语义。
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


QUALITY_RULE_LAYER_FORBIDDEN_IMPORTS: tuple[str, ...] = (
    "from module.QualityRule.QualityRuleIO import QualityRuleIO",
    "from module.QualityRulePathResolver import QualityRulePathResolver",
)


def test_phase_one_frontend_files_do_not_import_core_singletons_directly() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in PHASE_ONE_FRONTEND_FILES:
        file_path = root_dir / relative_path
        content = file_path.read_text(encoding="utf-8")

        for forbidden_import in FRONTEND_CORE_FORBIDDEN_IMPORTS:
            assert forbidden_import not in content, (
                f"{relative_path} 仍然直接依赖受限导入: {forbidden_import}"
            )


def test_phase_two_quality_frontend_files_are_listed_separately() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    assert PHASE_TWO_QUALITY_FRONTEND_FILES
    assert len(set(PHASE_TWO_QUALITY_FRONTEND_FILES)) == len(
        PHASE_TWO_QUALITY_FRONTEND_FILES
    )
    assert set(PHASE_TWO_QUALITY_FRONTEND_FILES).isdisjoint(PHASE_ONE_FRONTEND_FILES)

    for relative_path in PHASE_TWO_QUALITY_FRONTEND_FILES:
        file_path = root_dir / relative_path
        assert file_path.exists()
        assert relative_path.startswith("frontend/Quality/")


def test_quality_pages_use_quality_rule_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    custom_prompt_file_name = "CustomPrompt" + "Page.py"
    window_content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(
        encoding="utf-8"
    )
    glossary_content = (
        root_dir / "frontend" / "Quality" / "GlossaryPage.py"
    ).read_text(encoding="utf-8")
    text_preserve_content = (
        root_dir / "frontend" / "Quality" / "TextPreservePage.py"
    ).read_text(encoding="utf-8")
    text_replacement_content = (
        root_dir / "frontend" / "Quality" / "TextReplacementPage.py"
    ).read_text(encoding="utf-8")
    custom_prompt_content = (
        root_dir / "frontend" / "Quality" / custom_prompt_file_name
    ).read_text(encoding="utf-8")
    quality_rule_page_base_content = (
        root_dir / "frontend" / "Quality" / "QualityRulePageBase.py"
    ).read_text(encoding="utf-8")
    preset_manager_content = (
        root_dir / "frontend" / "Quality" / "QualityRulePresetManager.py"
    ).read_text(encoding="utf-8")

    assert "quality_rule_api_client" in window_content
    assert "proofreading_api_client" in window_content
    assert "from module.Data.DataManager import DataManager" not in glossary_content
    assert (
        "from module.Data.DataManager import DataManager" not in text_preserve_content
    )
    assert (
        "from module.Data.DataManager import DataManager"
        not in text_replacement_content
    )
    assert (
        "from module.Data.DataManager import DataManager" not in custom_prompt_content
    )
    assert QUALITY_RULE_LAYER_FORBIDDEN_IMPORTS[0] not in quality_rule_page_base_content
    assert QUALITY_RULE_LAYER_FORBIDDEN_IMPORTS[1] not in preset_manager_content


def test_phase_two_proofreading_frontend_files_are_listed_separately() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    assert PHASE_TWO_PROOFREADING_FRONTEND_FILES
    assert len(set(PHASE_TWO_PROOFREADING_FRONTEND_FILES)) == len(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )
    assert set(PHASE_TWO_PROOFREADING_FRONTEND_FILES).isdisjoint(
        PHASE_ONE_FRONTEND_FILES
    )

    for relative_path in PHASE_TWO_PROOFREADING_FRONTEND_FILES:
        file_path = root_dir / relative_path
        assert file_path.exists()
        assert relative_path.startswith("frontend/Proofreading/")

    assert set(PHASE_TWO_QUALITY_FRONTEND_FILES).isdisjoint(
        PHASE_TWO_PROOFREADING_FRONTEND_FILES
    )


def test_phase_two_proofreading_helper_files_do_not_import_core_singletons_directly() -> (
    None
):
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in PROOFREADING_HELPER_FILES:
        file_path = root_dir / relative_path
        content = file_path.read_text(encoding="utf-8")
        for forbidden_import in PROOFREADING_HELPER_FORBIDDEN_IMPORTS:
            assert forbidden_import not in content, (
                f"{relative_path} 仍然直接依赖受限导入: {forbidden_import}"
            )


def test_proofreading_page_and_filter_dialog_consume_api_models() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    proofreading_file_name = "Proofreading" + "Page.py"
    page_content = (
        root_dir / "frontend" / "Proofreading" / proofreading_file_name
    ).read_text(encoding="utf-8")
    dialog_content = (
        root_dir / "frontend" / "Proofreading" / "FilterDialog.py"
    ).read_text(encoding="utf-8")
    edit_panel_content = (
        root_dir / "frontend" / "Proofreading" / "ProofreadingEditPanel.py"
    ).read_text(encoding="utf-8")
    labels_content = (
        root_dir / "frontend" / "Proofreading" / "ProofreadingLabels.py"
    ).read_text(encoding="utf-8")
    delegate_content = (
        root_dir / "frontend" / "Proofreading" / "ProofreadingStatusDelegate.py"
    ).read_text(encoding="utf-8")

    assert "from api.Client.ProofreadingApiClient import ProofreadingApiClient" in (
        page_content
    )
    assert "from api.Client.ApiStateStore import ApiStateStore" in page_content
    assert "from model.Api.ProofreadingModels import ProofreadingSnapshot" in (
        page_content
    )
    assert "from model.Api.ProofreadingModels import ProofreadingMutationResult" in (
        page_content
    )
    assert "from model.Api.ProofreadingModels import ProofreadingSearchResult" in (
        page_content
    )
    assert "from module.Data.DataManager import DataManager" not in page_content
    assert "from module.Config import Config" not in page_content
    assert "from module.ResultChecker import ResultChecker" not in page_content
    assert "from module.Engine.Engine import Engine" not in page_content
    assert "from model.Item import Item" not in page_content
    assert (
        "from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain"
        not in page_content
    )
    assert "self.warning_map" not in page_content
    assert "self.failed_terms_by_item_key" not in page_content
    assert "self.result_checker" not in page_content

    assert (
        "from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot"
        in (dialog_content)
    )
    assert "from model.Api.ProofreadingModels import ProofreadingItemView" in (
        dialog_content
    )
    assert "from module.Data.DataManager import DataManager" not in dialog_content
    assert "from module.ResultChecker import ResultChecker" not in dialog_content
    assert "self.warning_map" not in dialog_content
    assert "self.failed_terms_by_item_key" not in dialog_content
    assert "self.result_checker" not in dialog_content
    assert "from module.ResultChecker import WarningType" not in edit_panel_content
    assert "from module.ResultChecker import WarningType" not in labels_content
    assert "from module.ResultChecker import WarningType" not in delegate_content
