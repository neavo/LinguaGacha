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


def test_phase_one_frontend_files_do_not_import_core_singletons_directly() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in PHASE_ONE_FRONTEND_FILES:
        file_path = root_dir / relative_path
        content = file_path.read_text(encoding="utf-8")

        for forbidden_import in FORBIDDEN_IMPORTS:
            assert forbidden_import not in content, (
                f"{relative_path} 仍然直接依赖受限导入: {forbidden_import}"
            )
