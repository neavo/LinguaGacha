from pathlib import Path

from tests.api.boundary_contracts import FRONTEND_CORE_FORBIDDEN_IMPORTS
from tests.api.boundary_contracts import PHASE_ONE_FRONTEND_FILES
from tests.api.boundary_contracts import PHASE_TWO_PROOFREADING_FRONTEND_FILES
from tests.api.boundary_contracts import PHASE_TWO_QUALITY_FRONTEND_FILES
from tests.api.boundary_contracts import PROOFREADING_HELPER_FILES
from tests.api.boundary_contracts import PROOFREADING_HELPER_FORBIDDEN_IMPORTS


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
        root_dir / "frontend" / "Quality" / "CustomPromptPage.py"
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
    page_content = (
        root_dir / "frontend" / "Proofreading" / "ProofreadingPage.py"
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
