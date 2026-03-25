from pathlib import Path


FORBIDDEN_IMPORTS: tuple[str, ...] = (
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


def test_phase_one_frontend_files_do_not_import_core_singletons_directly() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in PHASE_ONE_FRONTEND_FILES:
        file_path = root_dir / relative_path
        content = file_path.read_text(encoding="utf-8")

        for forbidden_import in FORBIDDEN_IMPORTS:
            assert forbidden_import not in content, (
                f"{relative_path} 仍然直接依赖受限导入: {forbidden_import}"
            )


def test_phase_two_quality_frontend_files_are_listed_separately() -> None:
    # 这一阶段先固定文件分组清单，等后续任务真正迁移完旧 Core 依赖后，再把
    # 内容级禁用导入断言收紧到这些分组里，避免当前 Task 1 先卡住后续任务。
    assert PHASE_TWO_QUALITY_FRONTEND_FILES == (
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


def test_phase_two_proofreading_frontend_files_are_listed_separately() -> None:
    # 这一阶段只固定 Proofreading 的文件分组边界，不提前要求它们全部无 Core 导入。
    assert PHASE_TWO_PROOFREADING_FRONTEND_FILES == (
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
