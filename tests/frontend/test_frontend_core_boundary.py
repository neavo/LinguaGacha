import ast
import os
from pathlib import Path
from typing import Callable

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
from PySide6.QtWidgets import QApplication

from api.Bridge.EventTopic import EventTopic
from api.Client.ApiStateStore import ApiStateStore
from base.Base import Base
import frontend.Extra.NameFieldExtractionPage as name_field_extraction_page_module
import frontend.Extra.TSConversionPage as ts_conversion_page_module
from frontend.Extra.NameFieldExtractionPage import NameFieldExtractionPage
from frontend.Extra.TSConversionPage import TSConversionPage
from model.Api.ExtraModels import NameFieldSnapshot
from model.Api.ExtraModels import TsConversionTaskAccepted
from model.Api.ExtraModels import TsConversionOptionsSnapshot
from model.Api.ProjectModels import ProjectSnapshot
from module.Localizer.Localizer import Localizer

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

EXTRA_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Extra/ToolBoxPage.py",
    "frontend/Extra/TSConversionPage.py",
    "frontend/Extra/NameFieldExtractionPage.py",
    "frontend/Extra/LaboratoryPage.py",
)

MODEL_FRONTEND_FILES: tuple[str, ...] = (
    "frontend/Model/ModelPage.py",
    "frontend/Model/ModelBasicSettingPage.py",
    "frontend/Model/ModelTaskSettingPage.py",
    "frontend/Model/ModelAdvancedSettingPage.py",
)

EXTRA_FORBIDDEN_IMPORT_MODULES: tuple[str, ...] = (
    "module.Config",
    "module.Data.DataManager",
    "module.Engine.Engine",
    "module.File.FileManager",
    "module.TextProcessor",
)

EXTRA_FORBIDDEN_IMPORT_TARGETS: tuple[str, ...] = (
    "module.Config",
    "module.Config.Config",
    "module.Data.DataManager",
    "module.Data.DataManager.DataManager",
    "module.Engine.Engine",
    "module.Engine.Engine.Engine",
    "module.File.FileManager",
    "module.File.FileManager.FileManager",
    "module.TextProcessor",
)

EXTRA_FORBIDDEN_CLASS_TARGETS: dict[str, tuple[str, ...]] = {
    "Config": ("module.Config", "module.Config.Config"),
    "DataManager": (
        "module.Data.DataManager",
        "module.Data.DataManager.DataManager",
    ),
    "Engine": ("module.Engine.Engine", "module.Engine.Engine.Engine"),
}

EXTRA_FORBIDDEN_CALL_PATTERNS: dict[str, tuple[str, str]] = {
    "Config().load()": ("Config", "load"),
    "DataManager.get()": ("DataManager", "get"),
    "Engine.get()": ("Engine", "get"),
}

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


class FakeBackgroundThread:
    """测试线程调度时只记录 target，避免在主线程同步执行后台任务。"""

    def __init__(self, target: Callable[[], None], daemon: bool = False) -> None:
        self.target = target
        self.daemon = daemon
        self.started = False

    def start(self) -> None:
        self.started = True


class ExtraBoundaryAstVisitor(ast.NodeVisitor):
    """用 AST 收口 Extra 页面对 Core 的导入与直连调用，避免纯字符串扫描被绕过。"""

    def __init__(self) -> None:
        self.name_bindings: dict[str, str] = {}
        self.violations: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:  # noqa: N802
        for alias in node.names:
            local_name = alias.asname or alias.name.split(".")[-1]
            self.name_bindings[local_name] = alias.name
            if alias.name in EXTRA_FORBIDDEN_IMPORT_MODULES:
                self.violations.append(f"导入 {alias.name}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        module_name = node.module or ""
        for alias in node.names:
            full_name = f"{module_name}.{alias.name}" if module_name else alias.name
            local_name = alias.asname or alias.name
            self.name_bindings[local_name] = full_name
            if is_forbidden_extra_import(module_name, full_name):
                self.violations.append(f"导入 {full_name}")
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        for target in node.targets:
            self.bind_name_target(target, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:  # noqa: N802
        if node.value is not None:
            self.bind_name_target(node.target, node.value)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        for pattern_name, (
            class_name,
            method_name,
        ) in EXTRA_FORBIDDEN_CALL_PATTERNS.items():
            if is_forbidden_extra_call(
                node,
                self.name_bindings,
                class_name,
                method_name,
            ):
                self.violations.append(f"调用 {pattern_name}")
        self.generic_visit(node)

    def bind_name_target(self, target: ast.AST, value: ast.AST) -> None:
        """统一处理名字绑定，覆盖普通赋值与注解赋值两种路径。"""

        resolved_value = resolve_ast_name(value, self.name_bindings)
        if resolved_value is not None and isinstance(target, ast.Name):
            self.name_bindings[target.id] = resolved_value


def resolve_ast_name(
    node: ast.AST,
    name_bindings: dict[str, str],
) -> str | None:
    """把 AST 表达式尽量解析成稳定的点路径，便于识别 alias 与属性链。"""

    if isinstance(node, ast.Name):
        return name_bindings.get(node.id, node.id)
    if isinstance(node, ast.Attribute):
        parent_name = resolve_ast_name(node.value, name_bindings)
        if parent_name is None:
            return None
        return f"{parent_name}.{node.attr}"
    if isinstance(node, ast.Call):
        return resolve_ast_name(node.func, name_bindings)
    return None


def is_forbidden_extra_import(module_name: str, full_name: str) -> bool:
    """识别受限模块的不同导入写法，避免 `from module import Config` 之类漏检。"""

    return (
        module_name in EXTRA_FORBIDDEN_IMPORT_MODULES
        or full_name in EXTRA_FORBIDDEN_IMPORT_TARGETS
    )


def is_forbidden_extra_call(
    node: ast.Call,
    name_bindings: dict[str, str],
    class_name: str,
    method_name: str,
) -> bool:
    """识别 `Config().load()`、`DataManager.get()`、`Engine.get()` 这类直连语义。"""

    if not isinstance(node.func, ast.Attribute):
        return False

    if node.func.attr != method_name:
        return False

    class_targets = EXTRA_FORBIDDEN_CLASS_TARGETS[class_name]
    if method_name == "load" and isinstance(node.func.value, ast.Call):
        constructor_name = resolve_ast_name(node.func.value.func, name_bindings)
        return constructor_name in class_targets

    receiver_name = resolve_ast_name(node.func.value, name_bindings)
    return receiver_name in class_targets


def collect_extra_boundary_violations(file_path: Path) -> list[str]:
    """返回 Extra 页面内违反边界约束的结构化命中结果。"""

    tree = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
    visitor = ExtraBoundaryAstVisitor()
    visitor.visit(tree)
    return visitor.violations


class FakeTsConversionClient:
    """把繁简转换 API 行为显式化，便于断言页面是否真的切到后台线程。"""

    def __init__(
        self,
        *,
        options_snapshot: TsConversionOptionsSnapshot | None = None,
        options_error: Exception | None = None,
        start_error: Exception | None = None,
    ) -> None:
        self.options_snapshot = options_snapshot or TsConversionOptionsSnapshot()
        self.options_error = options_error
        self.start_error = start_error
        self.options_call_count = 0
        self.start_requests: list[dict[str, object]] = []

    def get_ts_conversion_options(self) -> TsConversionOptionsSnapshot:
        self.options_call_count += 1
        if self.options_error is not None:
            raise self.options_error
        return self.options_snapshot

    def start_ts_conversion(self, request: dict[str, object]) -> object:
        self.start_requests.append(request)
        if self.start_error is not None:
            raise self.start_error
        return object()


class FakeNameFieldExtractionClient:
    """把姓名字段保存行为显式化，便于断言页面是否冻结了点击瞬间快照。"""

    def __init__(self) -> None:
        self.save_requests: list[list[dict[str, object]]] = []

    def save_name_fields_to_glossary(
        self,
        items: list[dict[str, object]],
    ) -> NameFieldSnapshot:
        self.save_requests.append([dict(item) for item in items])
        return NameFieldSnapshot.from_dict({"items": items})


class AcceptingMessageBox:
    """统一让确认弹窗返回确认，避免测试被交互阻塞。"""

    def __init__(self, title: str, content: str, parent: object) -> None:
        self.title = title
        self.content = content
        self.parent = parent

    def exec(self) -> int:
        return 1


class UnexpectedMessageBox:
    """当逻辑本应提前拦截时，如果仍弹窗就让测试立刻失败。"""

    def __init__(self, title: str, content: str, parent: object) -> None:
        self.title = title
        self.content = content
        self.parent = parent

    def exec(self) -> int:
        raise AssertionError("不应进入确认弹窗")


@pytest.fixture
def qapp() -> QApplication:
    application = QApplication.instance()
    if application is None:
        application = QApplication([])
    return application


def build_ts_conversion_page(
    qapp: QApplication,
    *,
    extra_api_client: object | None = None,
    api_state_store: ApiStateStore | None = None,
) -> TSConversionPage:
    del qapp
    page = TSConversionPage(
        "ts_conversion_page",
        None,
        extra_api_client=extra_api_client,
        api_state_store=api_state_store,
    )
    page.ui_update_timer.stop()
    return page


def build_name_field_extraction_page(
    qapp: QApplication,
    *,
    extra_api_client: object | None = None,
) -> NameFieldExtractionPage:
    del qapp
    return NameFieldExtractionPage(
        "name_field_extraction_page",
        None,
        extra_api_client=extra_api_client,
    )


def create_fake_thread_factory(
    threads: list[FakeBackgroundThread],
) -> Callable[[Callable[[], None], bool], FakeBackgroundThread]:
    def factory(
        target: Callable[[], None],
        daemon: bool = False,
    ) -> FakeBackgroundThread:
        thread = FakeBackgroundThread(target, daemon)
        threads.append(thread)
        return thread

    return factory


def test_phase_one_frontend_files_do_not_import_core_singletons_directly() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in PHASE_ONE_FRONTEND_FILES:
        file_path = root_dir / relative_path
        content = file_path.read_text(encoding="utf-8")

        for forbidden_import in FRONTEND_CORE_FORBIDDEN_IMPORTS:
            assert forbidden_import not in content, (
                f"{relative_path} 仍然直接依赖受限导入: {forbidden_import}"
            )


def test_model_frontend_files_do_not_import_core_singletons() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    forbidden_imports = (
        "from module.Config import Config",
        "from module.Engine.Engine import Engine",
        "from module.ModelManager import ModelManager",
    )

    for relative_path in MODEL_FRONTEND_FILES:
        content = (root_dir / relative_path).read_text(encoding="utf-8")
        for forbidden_import in forbidden_imports:
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


def test_extra_frontend_files_are_listed_separately() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    assert EXTRA_FRONTEND_FILES
    assert len(set(EXTRA_FRONTEND_FILES)) == len(EXTRA_FRONTEND_FILES)
    assert set(EXTRA_FRONTEND_FILES).isdisjoint(PHASE_ONE_FRONTEND_FILES)
    assert set(EXTRA_FRONTEND_FILES).isdisjoint(PHASE_TWO_QUALITY_FRONTEND_FILES)
    assert set(EXTRA_FRONTEND_FILES).isdisjoint(PHASE_TWO_PROOFREADING_FRONTEND_FILES)

    for relative_path in EXTRA_FRONTEND_FILES:
        file_path = root_dir / relative_path
        assert file_path.exists()
        assert relative_path.startswith("frontend/Extra/")


def test_laboratory_page_uses_extra_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "frontend" / "Extra" / "LaboratoryPage.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.ExtraApiClient import ExtraApiClient" in content
    assert "from module.Config import Config" not in content
    assert "from module.Engine.Engine import Engine" not in content


def test_tool_box_page_keeps_navigation_only_boundary() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "frontend" / "Extra" / "ToolBoxPage.py").read_text(
        encoding="utf-8"
    )

    assert "from module.Config import Config" not in content
    assert "Config().load().save()" not in content
    assert "window.switchTo(window.name_field_extraction_page)" in content
    assert "window.switchTo(window.ts_conversion_page)" in content


def test_ts_conversion_page_uses_extra_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "frontend" / "Extra" / "TSConversionPage.py").read_text(
        encoding="utf-8"
    )

    assert "from api.Client.ExtraApiClient import ExtraApiClient" in content
    assert "from module.Data.DataManager import DataManager" not in content
    assert "from module.File.FileManager import FileManager" not in content
    assert "from module.TextProcessor import TextProcessor" not in content


def test_app_fluent_window_injects_extra_page_clients() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (root_dir / "frontend" / "AppFluentWindow.py").read_text(encoding="utf-8")

    assert "self.extra_api_client = app_client_context.extra_api_client" in content
    assert 'ToolBoxPage("tool_box_page", self)' in content
    assert 'LaboratoryPage(\n                "laboratory_page",' in content
    assert "extra_api_client=self.extra_api_client" in content
    assert "task_api_client=self.task_api_client" in content
    assert (
        "self.name_field_extraction_page = NameFieldExtractionPage(\n"
        '            "name_field_extraction_page", self, '
        "extra_api_client=self.extra_api_client" in content
    )
    assert (
        'self.ts_conversion_page = TSConversionPage(\n            "ts_conversion_page",'
        in content
    )
    assert "api_state_store=self.api_state_store" in content


def test_name_field_extraction_page_uses_extra_api_client() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    content = (
        root_dir / "frontend" / "Extra" / "NameFieldExtractionPage.py"
    ).read_text(encoding="utf-8")

    assert "from api.Client.ExtraApiClient import ExtraApiClient" in content
    assert "from module.Data.DataManager import DataManager" not in content
    assert "from module.Engine.Engine import Engine" not in content
    assert "from module.Config import Config" not in content


def test_extra_pages_accept_explicit_clients_in_constructor() -> None:
    root_dir = Path(__file__).resolve().parents[2]
    ts_content = (root_dir / "frontend" / "Extra" / "TSConversionPage.py").read_text(
        encoding="utf-8"
    )
    name_field_content = (
        root_dir / "frontend" / "Extra" / "NameFieldExtractionPage.py"
    ).read_text(encoding="utf-8")
    laboratory_content = (
        root_dir / "frontend" / "Extra" / "LaboratoryPage.py"
    ).read_text(encoding="utf-8")

    assert "extra_api_client: ExtraApiClient | None = None" in ts_content
    assert "api_state_store: ApiStateStore | None = None" in ts_content
    assert "extra_api_client: ExtraApiClient | None = None" in name_field_content
    assert "extra_api_client: ExtraApiClient | None = None" in laboratory_content
    assert "task_api_client: TaskApiClient | None = None" in laboratory_content


def test_extra_frontend_files_do_not_import_core_singletons_directly() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    for relative_path in EXTRA_FRONTEND_FILES:
        file_path = root_dir / relative_path
        violations = collect_extra_boundary_violations(file_path)

        assert violations == [], f"{relative_path} 仍然存在 Core 直连语义: {violations}"


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


def test_ts_conversion_page_loads_options_in_background(qapp: QApplication) -> None:
    # 准备
    threads: list[FakeBackgroundThread] = []
    client = FakeTsConversionClient(
        options_snapshot=TsConversionOptionsSnapshot(
            default_direction=TSConversionPage.DEFAULT_DIRECTION_TO_SIMPLIFIED,
            preserve_text_enabled=False,
            convert_name_enabled=False,
        )
    )
    original_thread = ts_conversion_page_module.threading.Thread
    ts_conversion_page_module.threading.Thread = create_fake_thread_factory(threads)

    try:
        # 执行
        page = build_ts_conversion_page(qapp, extra_api_client=client)

        # 断言
        assert client.options_call_count == 0
        assert len(threads) == 1
        assert page.direction_combo.currentIndex() == 1
        assert page.preserve_switch.isChecked() is True
        assert page.target_name_switch.isChecked() is True

        threads[0].target()

        assert client.options_call_count == 1
        assert page.direction_combo.currentIndex() == 0
        assert page.preserve_switch.isChecked() is False
        assert page.target_name_switch.isChecked() is False
    finally:
        ts_conversion_page_module.threading.Thread = original_thread


def test_ts_conversion_page_keeps_default_options_when_background_load_fails(
    qapp: QApplication,
) -> None:
    # 准备
    threads: list[FakeBackgroundThread] = []
    client = FakeTsConversionClient(options_error=RuntimeError("load failed"))
    original_thread = ts_conversion_page_module.threading.Thread
    ts_conversion_page_module.threading.Thread = create_fake_thread_factory(threads)

    try:
        # 执行
        page = build_ts_conversion_page(qapp, extra_api_client=client)
        threads[0].target()

        # 断言
        assert client.options_call_count == 1
        assert page.direction_combo.currentIndex() == 1
        assert page.preserve_switch.isChecked() is True
        assert page.target_name_switch.isChecked() is True
    finally:
        ts_conversion_page_module.threading.Thread = original_thread


def test_ts_conversion_page_start_conversion_uses_background_thread_and_reports_error_toast(
    qapp: QApplication,
) -> None:
    # 准备
    threads: list[FakeBackgroundThread] = []
    store = ApiStateStore()
    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )
    client = FakeTsConversionClient(start_error=RuntimeError("start failed"))
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    original_thread = ts_conversion_page_module.threading.Thread
    original_message_box = ts_conversion_page_module.MessageBox
    ts_conversion_page_module.threading.Thread = create_fake_thread_factory(threads)
    ts_conversion_page_module.MessageBox = AcceptingMessageBox

    try:
        page = build_ts_conversion_page(
            qapp,
            extra_api_client=client,
            api_state_store=store,
        )
        threads.clear()

        def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
            emitted_events.append((event, data))
            return True

        page.emit = capture_emit  # type: ignore[method-assign]

        # 执行
        page.start_conversion()

        # 断言
        assert client.start_requests == []
        assert len(threads) == 1

        threads[0].target()

        assert len(client.start_requests) == 1
        assert emitted_events == [
            (
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
        ]
    finally:
        ts_conversion_page_module.threading.Thread = original_thread
        ts_conversion_page_module.MessageBox = original_message_box


def test_ts_conversion_page_does_not_clear_active_task_before_first_snapshot(
    qapp: QApplication,
) -> None:
    # 准备
    store = ApiStateStore()
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    page = build_ts_conversion_page(qapp, api_state_store=store)

    def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
        emitted_events.append((event, data))
        return True

    page.emit = capture_emit  # type: ignore[method-assign]

    # 执行
    page.handle_start_result(
        TsConversionTaskAccepted(accepted=True, task_id="extra_ts_conversion")
    )

    # 断言
    assert page.active_task_id == "extra_ts_conversion"
    assert page.progress_toast_visible is True
    assert emitted_events == [
        (
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().ts_conversion_action_preparing,
                "indeterminate": True,
            },
        )
    ]
    assert page.awaiting_active_task_state is True


def test_ts_conversion_page_restart_with_same_task_id_ignores_stale_finished_snapshot(
    qapp: QApplication,
) -> None:
    # 准备
    store = ApiStateStore()
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    page = build_ts_conversion_page(qapp, api_state_store=store)
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_FINISHED.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "FINISHED",
            "message": "done",
            "current": 10,
            "total": 10,
        },
    )

    def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
        emitted_events.append((event, data))
        return True

    page.emit = capture_emit  # type: ignore[method-assign]

    # 执行
    page.handle_start_result(
        TsConversionTaskAccepted(accepted=True, task_id="extra_ts_conversion")
    )

    # 断言
    assert page.active_task_id == "extra_ts_conversion"
    assert page.awaiting_active_task_state is True
    assert page.progress_toast_visible is True
    assert store.get_extra_task_state("extra_ts_conversion") is None
    assert emitted_events == [
        (
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().ts_conversion_action_preparing,
                "indeterminate": True,
            },
        )
    ]


def test_ts_conversion_page_blocks_repeat_start_while_waiting_for_first_snapshot(
    qapp: QApplication,
) -> None:
    # 准备
    store = ApiStateStore()
    store.hydrate_project(
        ProjectSnapshot.from_dict({"loaded": True, "path": "demo.lg"})
    )
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    page = build_ts_conversion_page(qapp, api_state_store=store)
    page.handle_start_result(
        TsConversionTaskAccepted(accepted=True, task_id="extra_ts_conversion")
    )
    original_message_box = ts_conversion_page_module.MessageBox
    ts_conversion_page_module.MessageBox = UnexpectedMessageBox

    try:

        def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
            emitted_events.append((event, data))
            return True

        page.emit = capture_emit  # type: ignore[method-assign]

        # 执行
        page.start_conversion()

        # 断言
        assert page.awaiting_active_task_state is True
        assert emitted_events == [
            (
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
        ]
    finally:
        ts_conversion_page_module.MessageBox = original_message_box


def test_ts_conversion_page_clears_missing_active_task_after_real_snapshot_seen(
    qapp: QApplication,
) -> None:
    # 准备
    store = ApiStateStore()
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    page = build_ts_conversion_page(qapp, api_state_store=store)
    page.active_task_id = "extra_ts_conversion"
    page.progress_toast_visible = True
    store.apply_event(
        EventTopic.EXTRA_TS_CONVERSION_PROGRESS.value,
        {
            "task_id": "extra_ts_conversion",
            "phase": "RUNNING",
            "message": "running",
            "current": 1,
            "total": 10,
        },
    )

    def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
        emitted_events.append((event, data))
        return True

    page.emit = capture_emit  # type: ignore[method-assign]

    # 执行
    page.update_progress_from_state_store()
    store.reset_project()
    page.update_progress_from_state_store()

    # 断言
    assert page.active_task_id == ""
    assert page.progress_toast_visible is False
    assert emitted_events == [
        (
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "message": Localizer.get()
                .ts_conversion_action_progress.replace("{CURRENT}", "1")
                .replace("{TOTAL}", "10"),
                "indeterminate": False,
                "current": 1,
                "total": 10,
            },
        ),
        (
            Base.Event.PROGRESS_TOAST,
            {"sub_event": Base.SubEvent.ERROR},
        ),
    ]


def test_name_field_extraction_page_save_uses_click_moment_snapshot(
    qapp: QApplication,
) -> None:
    # 准备
    threads: list[FakeBackgroundThread] = []
    client = FakeNameFieldExtractionClient()
    original_thread = name_field_extraction_page_module.threading.Thread
    name_field_extraction_page_module.threading.Thread = create_fake_thread_factory(
        threads
    )

    try:
        page = build_name_field_extraction_page(qapp, extra_api_client=client)
        page.items = [
            {
                "src": "勇者",
                "dst": "Hero",
                "context": "勇者が来た",
                "status": "翻译完成",
            }
        ]

        # 执行
        page.save_to_glossary()
        page.items[0]["dst"] = "Changed After Click"
        threads[0].target()

        # 断言
        assert client.save_requests == [
            [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ]
        ]
    finally:
        name_field_extraction_page_module.threading.Thread = original_thread


def test_name_field_extraction_page_blocks_repeat_save_while_request_running(
    qapp: QApplication,
) -> None:
    # 准备
    threads: list[FakeBackgroundThread] = []
    client = FakeNameFieldExtractionClient()
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []
    original_thread = name_field_extraction_page_module.threading.Thread
    name_field_extraction_page_module.threading.Thread = create_fake_thread_factory(
        threads
    )

    try:
        page = build_name_field_extraction_page(qapp, extra_api_client=client)
        page.items = [
            {
                "src": "勇者",
                "dst": "Hero",
                "context": "勇者が来た",
                "status": "翻译完成",
            }
        ]

        def capture_emit(event: Base.Event, data: dict[str, object]) -> bool:
            emitted_events.append((event, data))
            return True

        page.emit = capture_emit  # type: ignore[method-assign]

        # 执行
        page.save_to_glossary()
        page.save_to_glossary()

        # 断言
        assert len(threads) == 1
        assert client.save_requests == []
        assert emitted_events == [
            (
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
        ]
    finally:
        name_field_extraction_page_module.threading.Thread = original_thread
