import re
import threading
from typing import Callable

from PyQt5.QtCore import QSize
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtGui import QShowEvent
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from frontend.Proofreading.FilterDialog import FilterDialog
from frontend.Proofreading.PaginationBar import PaginationBar
from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain
from frontend.Proofreading.ProofreadingDomain import ProofreadingFilterOptions
from frontend.Proofreading.ProofreadingEditPanel import ProofreadingEditPanel
from frontend.Proofreading.ProofreadingLoadService import ProofreadingLoadKind
from frontend.Proofreading.ProofreadingLoadService import ProofreadingLoadResult
from frontend.Proofreading.ProofreadingLoadService import ProofreadingLoadService
from frontend.Proofreading.ProofreadingTableWidget import ProofreadingTableWidget
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard

# ==================== 图标常量 ====================

ICON_ACTION_EXPORT: BaseIcon = BaseIcon.FILE_INPUT  # 命令栏：导出译文
ICON_ACTION_SEARCH: BaseIcon = BaseIcon.SEARCH  # 命令栏：打开搜索栏
ICON_ACTION_FILTER: BaseIcon = BaseIcon.FUNNEL  # 命令栏：打开筛选面板


class ProofreadingPage(QWidget, Base):
    """校对任务主页面"""

    # 布局常量
    FONT_SIZE = 12
    ICON_SIZE = 16

    # 防抖时间（毫秒）
    AUTO_RELOAD_DELAY_MS: int = 120
    QUALITY_RULE_REFRESH_DELAY_MS: int = 200

    # 质量规则类型
    QUALITY_RULE_TYPES: set[str] = {
        DataManager.RuleType.GLOSSARY.value,
        DataManager.RuleType.PRE_REPLACEMENT.value,
        DataManager.RuleType.POST_REPLACEMENT.value,
        DataManager.RuleType.TEXT_PRESERVE.value,
    }

    # 质量规则元数据键
    QUALITY_META_KEYS: set[str] = {
        "glossary_enable",
        "pre_translation_replacement_enable",
        "post_translation_replacement_enable",
        "text_preserve_mode",
    }

    # 信号定义
    items_loaded = pyqtSignal(int, object)  # (token, payload)
    filter_done = pyqtSignal(int, list)  # (data_version, filtered_items)
    translate_done = pyqtSignal(object, bool)  # 翻译完成信号
    save_done = pyqtSignal(bool)  # 保存完成信号
    export_done = pyqtSignal(bool, str)  # 导出完成信号 (success, error_msg)
    item_saved = pyqtSignal(object, bool)  # 单条保存完成信号
    item_rechecked = pyqtSignal(object, list)  # (item, warnings)
    progress_updated = pyqtSignal(
        str, int, int
    )  # 进度更新信号 (content, current, total)
    progress_finished = pyqtSignal()  # 进度完成信号
    quality_rules_refreshed = pyqtSignal(object, dict)  # (checker, warning_map)

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 成员变量
        self.main_window = window
        self.items_all: list[Item] = []  # 全量数据（含结构行）
        self.items: list[Item] = []  # 可校对数据
        self.filtered_items: list[Item] = []  # 筛选后数据
        self.warning_map: dict[int, list[WarningType]] = {}  # 警告映射表
        self.result_checker: ResultChecker | None = None  # 结果检查器
        self.is_readonly: bool = False  # 只读模式标志
        self.config: Config | None = None  # 配置
        self.filter_options: ProofreadingFilterOptions = ProofreadingFilterOptions()
        self.search_keyword: str = ""  # 当前搜索关键词
        self.search_is_regex: bool = False  # 是否正则搜索
        self.search_filter_mode: bool = False  # 是否筛选模式
        self.search_match_indices: list[int] = []  # 匹配项在 filtered_items 中的索引
        self.search_current_match: int = (
            -1
        )  # 当前匹配项索引（在 search_match_indices 中的位置）
        self.pending_selected_item: Item | None = None
        self.current_item: Item | None = None
        self.current_row_in_page: int = -1
        self.current_page_start_index: int = 0
        self.current_page: int = 1
        self.block_selection_change: bool = False
        self.block_page_change: bool = False
        self.pending_action: Callable[[], None] | None = None
        self.pending_revert: Callable[[], None] | None = None
        self.pending_export: bool = False

        # 自动载入/同步调度
        self.data_stale: bool = True
        self.reload_pending: bool = False
        self.is_loading: bool = False
        self.reload_token: int = 0
        self.loading_token: int = 0
        self.data_version: int = 0
        self.toast_cycle: int = 0
        self.no_cache_toast_cycle: int = -1
        self.no_review_items_toast_cycle: int = -1
        self.reload_timer: QTimer = QTimer(self)
        self.reload_timer.setSingleShot(True)
        self.reload_timer.timeout.connect(self.try_reload)
        self.quality_rule_refresh_token: int = 0
        self.quality_rule_refresh_timer: QTimer = QTimer(self)
        self.quality_rule_refresh_timer.setSingleShot(True)
        self.quality_rule_refresh_timer.timeout.connect(self.refresh_quality_rules)
        self.pending_quality_rule_refresh: bool = False

        self.ui_font_px = self.FONT_SIZE
        self.ui_icon_px = self.ICON_SIZE

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 初始化 UI 布局
        self.add_widget_body(self.root, window)
        self.add_widget_foot(self.root, window)

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_UPDATE, self.on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_engine_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.on_engine_status_changed
        )
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_reset)
        self.subscribe(Base.Event.TRANSLATION_RESET_FAILED, self.on_translation_reset)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)
        self.subscribe(Base.Event.PROJECT_FILE_UPDATE, self.on_project_file_update)
        self.subscribe(Base.Event.QUALITY_RULE_UPDATE, self.on_quality_rule_update)
        self.subscribe(
            Base.Event.PROJECT_PREFILTER_UPDATED, self.on_project_prefilter_updated
        )

        # 连接信号
        self.items_loaded.connect(self.on_items_loaded_ui)
        self.filter_done.connect(self.on_filter_done_ui)
        self.translate_done.connect(self.on_translate_done_ui)
        self.save_done.connect(self.on_save_done_ui)
        self.export_done.connect(self.on_export_done_ui)
        self.item_saved.connect(self.on_item_saved_ui)
        self.item_rechecked.connect(self.on_item_rechecked_ui)
        self.progress_updated.connect(self.on_progress_updated_ui)
        self.progress_finished.connect(self.on_progress_finished_ui)
        self.quality_rules_refreshed.connect(self.on_quality_rules_refreshed_ui)

    def on_quality_rule_update(self, event: Base.Event, event_data: dict) -> None:
        del event
        # 只对影响校对判定的规则变更触发重算，避免无效刷新
        if not self.is_quality_rule_update_relevant(event_data):
            return
        if not self.isVisible():
            # 页面不可见时避免触发筛选导致全局进度 toast。
            self.pending_quality_rule_refresh = True
            return
        if not self.items:
            return
        self.schedule_quality_rule_refresh()

    def on_project_prefilter_updated(self, event: Base.Event, event_data: dict) -> None:
        del event
        del event_data
        self.mark_data_stale(new_cycle=True)
        self.schedule_reload("prefilter_updated")

    def on_project_file_update(self, event: Base.Event, event_data: dict) -> None:
        """工程文件变更（工作台增删改重命名）后同步校对页数据。"""
        del event
        # WorkbenchPage 会复用该事件推送 snapshot 刷新，这类事件不代表真实文件变更；
        # 校对页只在增/删/改/重命名时标记 stale。
        if isinstance(event_data, dict) and "snapshot" in event_data:
            return

        rel_path = event_data.get("rel_path") if isinstance(event_data, dict) else None
        if not isinstance(rel_path, str) or not rel_path:
            return
        # 文件内容/路径变更会影响 items 快照与筛选范围；即便页面不可见也要标记 stale，
        # 这样用户切回校对页时 showEvent 才会触发自动 reload。
        self.mark_data_stale(new_cycle=True)
        self.schedule_reload("project_file_update")

    def is_quality_rule_update_relevant(self, event_data: dict) -> bool:
        if not event_data:
            return True
        rule_types: list[str] = event_data.get("rule_types", [])
        meta_keys: list[str] = event_data.get("meta_keys", [])
        if any(rule_type in self.QUALITY_RULE_TYPES for rule_type in rule_types):
            return True
        return any(meta_key in self.QUALITY_META_KEYS for meta_key in meta_keys)

    def schedule_quality_rule_refresh(self) -> None:
        # 合并短时间内的多次规则变更，避免重复全量检查
        self.quality_rule_refresh_timer.start(self.QUALITY_RULE_REFRESH_DELAY_MS)

    def refresh_quality_rules(self) -> None:
        self.quality_rule_refresh_token += 1
        current_token: int = self.quality_rule_refresh_token
        config = self.config or Config().load()
        items_snapshot = list(self.items)

        def task() -> None:
            try:
                checker = ResultChecker(config)
                warning_map = checker.check_items(items_snapshot)
                if current_token != self.quality_rule_refresh_token:
                    return
                self.quality_rules_refreshed.emit(checker, warning_map)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)

        threading.Thread(target=task, daemon=True).start()

    def on_quality_rules_refreshed_ui(
        self, checker: ResultChecker, warning_map: dict[int, list[WarningType]]
    ) -> None:
        self.result_checker = checker
        self.warning_map = warning_map
        self.edit_panel.set_result_checker(self.result_checker)
        # 重新应用筛选/刷新当前页 UI，确保状态图标与高亮同步到最新规则。
        self.apply_filter()

    # ========== 主体：表格 ==========
    def add_widget_body(self, parent: QVBoxLayout, main_window: FluentWindow) -> None:
        """添加主体控件"""
        body_widget = QWidget(self)
        body_layout = QHBoxLayout(body_widget)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(8)

        # qfluentwidgets 的样式管理依赖 widget 的父子关系，首次进入页面时若无父对象
        # 可能出现 TableWidget 使用 Qt 原生样式，直到主题切换触发全局刷新才恢复。
        self.table_widget = ProofreadingTableWidget(body_widget)
        self.table_widget.retranslate_clicked.connect(self.on_retranslate_clicked)
        self.table_widget.batch_retranslate_clicked.connect(
            self.on_batch_retranslate_clicked
        )
        self.table_widget.reset_translation_clicked.connect(
            self.on_reset_translation_clicked
        )
        self.table_widget.batch_reset_translation_clicked.connect(
            self.on_batch_reset_translation_clicked
        )
        self.table_widget.copy_src_clicked.connect(self.on_copy_src_clicked)
        self.table_widget.copy_dst_clicked.connect(self.on_copy_dst_clicked)
        self.table_widget.itemSelectionChanged.connect(self.on_table_selection_changed)
        self.table_widget.set_items([], {})

        self.edit_panel = ProofreadingEditPanel(self)
        self.edit_panel.save_requested.connect(self.on_edit_save_requested)
        self.edit_panel.copy_src_requested.connect(self.on_copy_src_clicked)
        self.edit_panel.copy_dst_requested.connect(self.on_copy_dst_clicked)
        self.edit_panel.retranslate_requested.connect(self.on_retranslate_clicked)
        self.edit_panel.reset_translation_requested.connect(
            self.on_reset_translation_clicked
        )

        body_layout.addWidget(self.table_widget, 7)
        body_layout.addWidget(self.edit_panel, 3)
        parent.addWidget(body_widget, 1)

    # ========== 底部：命令栏 ==========
    def add_widget_foot(self, parent: QVBoxLayout, main_window: FluentWindow) -> None:
        """添加底部控件"""
        # 搜索栏（默认隐藏）
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        # 绑定搜索回调
        self.search_card.on_back_clicked(lambda w: self.on_search_back_clicked())
        self.search_card.on_prev_clicked(lambda w: self.on_search_prev_clicked())
        self.search_card.on_next_clicked(lambda w: self.on_search_next_clicked())
        self.search_card.on_search_triggered(lambda w: self.do_search())
        self.search_card.on_search_mode_changed(lambda w: self.on_search_mode_changed())

        # 命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 本页统一写死字号与图标尺寸，避免跨平台/主题的细微差异造成视觉不一致。
        base_font = QFont(self.command_bar_card.command_bar.font())
        base_font.setPixelSize(self.ui_font_px)
        self.command_bar_card.command_bar.setFont(base_font)
        self.command_bar_card.command_bar.setIconSize(
            QSize(self.ui_icon_px, self.ui_icon_px)
        )

        self.search_card.set_base_font(self.command_bar_card.command_bar.font())

        self.command_bar_card.set_minimum_width(640)

        # 功能按钮组
        self.btn_export = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_EXPORT,
                Localizer.get().export_translation,
                triggered=self.on_export_clicked,
            )
        )
        self.btn_export.installEventFilter(
            ToolTipFilter(self.btn_export, 300, ToolTipPosition.TOP)
        )
        self.btn_export.setToolTip(Localizer.get().proofreading_page_export_tooltip)
        self.btn_export.setEnabled(False)

        self.command_bar_card.add_separator()
        self.btn_search = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_SEARCH,
                Localizer.get().search,
                triggered=self.on_search_clicked,
            )
        )
        self.btn_search.setEnabled(False)

        self.btn_filter = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_FILTER,
                Localizer.get().proofreading_page_filter,
                triggered=self.on_filter_clicked,
            )
        )
        self.btn_filter.setEnabled(False)

        # 分页组件（放到右侧）
        # 使用 add_widget 添加到 hbox，而非 command_bar 内部，使 stretch 能正确生效
        self.command_bar_card.add_stretch(1)
        self.pagination_bar = PaginationBar()
        self.pagination_bar.page_changed.connect(self.on_page_changed)
        self.command_bar_card.add_widget(self.pagination_bar)

    # ========== 自动载入 / 同步 ==========

    def mark_data_stale(self, new_cycle: bool = True) -> None:
        self.data_stale = True
        if not new_cycle:
            return

        self.toast_cycle += 1
        self.no_cache_toast_cycle = -1
        self.no_review_items_toast_cycle = -1

    def schedule_reload(self, reason: str) -> None:
        if not self.isVisible():
            return
        if not DataManager.get().is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.reload_pending = True
            return
        if self.is_loading:
            self.reload_pending = True
            return
        if self.edit_panel.has_unsaved_changes():
            self.reload_pending = True
            return

        self.reload_timer.start(self.AUTO_RELOAD_DELAY_MS)

    def try_reload(self) -> None:
        if not self.data_stale:
            return
        if not DataManager.get().is_loaded():
            return
        if Engine.get().get_status() != Base.TaskStatus.IDLE:
            self.reload_pending = True
            return
        if self.is_loading:
            self.reload_pending = True
            return
        if self.edit_panel.has_unsaved_changes():
            self.reload_pending = True
            return

        self.is_loading = True
        self.data_stale = False
        self.reload_token += 1
        token: int = self.reload_token
        self.loading_token = token
        toast_cycle = self.toast_cycle
        lg_path = DataManager.get().get_lg_path() or ""

        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)

        def task() -> None:
            try:
                # 加载流程下沉到 LoadService，避免 Page 内联大量 dict payload 与分支逻辑。
                result = ProofreadingLoadService.load_snapshot(lg_path, toast_cycle)
                self.items_loaded.emit(token, result)
            except Exception as e:
                LogManager.get().error(Localizer.get().proofreading_page_load_failed, e)
                self.items_loaded.emit(
                    token,
                    ProofreadingLoadResult(
                        kind=ProofreadingLoadKind.ERROR,
                        toast_cycle=toast_cycle,
                        lg_path=lg_path,
                    ),
                )

        threading.Thread(target=task, daemon=True).start()

    def on_items_loaded_ui(self, token: int, payload: ProofreadingLoadResult) -> None:
        """数据加载完成的 UI 更新（主线程）"""
        if token != self.loading_token:
            return

        self.is_loading = False
        self.indeterminate_hide()

        kind = payload.kind
        toast_cycle = payload.toast_cycle

        if kind == ProofreadingLoadKind.STALE:
            # 工程已切换/卸载，丢弃旧线程结果。
            return

        if kind == ProofreadingLoadKind.ERROR:
            self.data_stale = True
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().proofreading_page_load_failed,
                },
            )
            return

        # 更新页面数据快照（只在主线程写入）。
        self.config = payload.config
        self.items_all = payload.items_all
        self.items = payload.items
        self.warning_map = payload.warning_map
        self.result_checker = payload.checker
        self.filter_options = payload.filter_options
        self.data_version = token

        # Toast 仅提示一次（同一次 stale 周期）。
        if (
            kind == ProofreadingLoadKind.NO_CACHE
            and self.no_cache_toast_cycle != toast_cycle
        ):
            self.no_cache_toast_cycle = toast_cycle
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().proofreading_page_no_cache,
                },
            )
        if (
            kind == ProofreadingLoadKind.NO_REVIEW_ITEMS
            and self.no_review_items_toast_cycle != toast_cycle
        ):
            self.no_review_items_toast_cycle = toast_cycle
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().proofreading_page_no_review_items,
                },
            )

        self.edit_panel.set_result_checker(self.result_checker)

        if self.items:
            self.apply_filter(False)
        else:
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()
            self.current_item = None
            self.current_row_in_page = -1
            self.edit_panel.clear()

        self.check_engine_status()

        if self.reload_pending:
            self.reload_pending = False
            self.data_stale = True
            self.schedule_reload("pending")

    # ========== 筛选功能 ==========
    def on_filter_clicked(self) -> None:
        """筛选按钮点击"""
        if not self.items or not self.result_checker:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().proofreading_page_no_cache,
                },
            )
            return

        dialog = FilterDialog(
            items=self.items,
            warning_map=self.warning_map,
            result_checker=self.result_checker,
            parent=self.main_window,
        )
        dialog.set_filter_options(self.filter_options)

        if dialog.exec():
            new_options = dialog.get_filter_options()

            def action() -> None:
                self.filter_options = new_options
                self.pending_selected_item = None
                self.apply_filter(False)

            self.run_with_unsaved_guard(action)

    def apply_filter(self, guard: bool = True) -> None:
        """应用筛选条件 (异步执行)"""
        if guard:
            self.run_with_unsaved_guard(lambda: self.apply_filter(False))
            return
        # 如果正在加载，则不重复触发
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)

        # 捕获当前需要的参数快照，避免竞态
        data_version = self.data_version
        options = self.filter_options
        items_ref = self.items
        warning_map_ref = self.warning_map
        checker_ref = self.result_checker
        keyword = self.search_keyword
        use_regex = self.search_is_regex
        use_search_filter = self.search_filter_mode

        if use_search_filter and keyword and use_regex:
            # 保持原有体验：正则非法时直接在 UI 线程提示，而不是让后台线程吞掉异常。
            try:
                re.compile(keyword)
            except re.error as e:
                self.indeterminate_hide()
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": f"{Localizer.get().search_regex_invalid}: {e}",
                    },
                )
                return

        def filter_task() -> None:
            try:
                # 筛选规则由 Domain 层统一实现，避免 Page/Dialog 两套逻辑逐渐漂移。
                filtered = ProofreadingDomain.filter_items(
                    items=items_ref,
                    warning_map=warning_map_ref,
                    options=options,
                    checker=checker_ref,
                    search_keyword=keyword,
                    search_is_regex=use_regex,
                    enable_search_filter=use_search_filter,
                    enable_glossary_term_filter=True,
                )
                self.filter_done.emit(data_version, filtered)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.filter_done.emit(data_version, [])

        threading.Thread(target=filter_task, daemon=True).start()

    def on_filter_done_ui(self, data_version: int, filtered: list[Item]) -> None:
        """筛选完成的 UI 更新 (主线程)"""
        if data_version != self.data_version:
            return
        self.indeterminate_hide()
        self.filtered_items = filtered
        self.pagination_bar.set_total(len(filtered))
        self.pagination_bar.set_page(1)
        self.render_page(1)

        # 筛选后更新搜索状态
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        should_build_match_indices = self.search_filter_mode and bool(
            self.search_keyword
        )
        if should_build_match_indices:
            self.build_match_indices()
            if not self.search_match_indices:
                self.search_card.set_match_info(0, 0)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )

        self.restore_selected_item()

    # build_default_filter_options/build_review_items 已迁移到 ProofreadingDomain/ProofreadingLoadService。

    # ========== 搜索功能 ==========
    def on_search_clicked(self) -> None:
        """搜索按钮点击"""
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)
        self.attach_pagination_to_search_bar()
        # 聚焦到输入框
        self.search_card.get_line_edit().setFocus()

    def on_search_back_clicked(self) -> None:
        """搜索栏返回点击，清除搜索状态"""

        def action() -> None:
            self.search_keyword = ""
            self.search_is_regex = False
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.clear_match_info()
            if self.search_filter_mode:
                self.pending_selected_item = None
                self.apply_filter(False)
            self.search_card.setVisible(False)
            self.attach_pagination_to_command_bar()
            self.command_bar_card.setVisible(True)

        self.run_with_unsaved_guard(action)

    def reset_search_state(self) -> None:
        """清空搜索状态并退出搜索栏。

        用于页面禁用/数据清空等场景：不保留搜索输入/模式/匹配进度。
        """

        self.search_keyword = ""
        self.search_is_regex = False
        self.search_filter_mode = False
        self.search_match_indices = []
        self.search_current_match = -1
        self.pending_selected_item = None

        self.search_card.reset_state()
        self.search_card.setVisible(False)
        self.attach_pagination_to_command_bar()
        self.command_bar_card.setVisible(True)

    def do_search(self) -> None:
        """执行搜索，构建匹配索引列表并跳转到第一个匹配项"""
        keyword = self.search_card.get_keyword()
        if not keyword:
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.clear_match_info()
            if self.search_filter_mode:
                self.search_keyword = ""
                self.search_is_regex = self.search_card.is_regex_mode()
                self.pending_selected_item = None
                self.apply_filter()
            return

        is_regex = self.search_card.is_regex_mode()

        # 验证正则表达式
        if is_regex:
            is_valid, error_msg = self.search_card.validate_regex()
            if not is_valid:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": f"{Localizer.get().search_regex_invalid}: {error_msg}",
                    },
                )
                return

        self.search_keyword = keyword
        self.search_is_regex = is_regex

        if self.search_filter_mode:

            def action() -> None:
                self.pending_selected_item = None
                self.apply_filter(False)

            self.run_with_unsaved_guard(action)
            return

        # 构建匹配索引列表
        self.build_match_indices()

        if not self.search_match_indices:
            self.search_card.set_match_info(0, 0)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().search_no_match,
                },
            )
            return

        # 跳转到第一个匹配项
        self.search_current_match = 0
        self.jump_to_match()

    def on_search_mode_changed(self) -> None:
        def action() -> None:
            self.search_filter_mode = self.search_card.is_filter_mode()
            self.search_keyword = self.search_card.get_keyword()
            self.search_is_regex = self.search_card.is_regex_mode()

            if self.search_filter_mode and self.search_keyword and self.search_is_regex:
                is_valid, error_msg = self.search_card.validate_regex()
                if not is_valid:
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.ERROR,
                            "message": f"{Localizer.get().search_regex_invalid}: {error_msg}",
                        },
                    )
                    return

            selected_items = self.table_widget.get_selected_items()
            self.pending_selected_item = selected_items[0] if selected_items else None

            if self.search_filter_mode:
                if not self.search_keyword:
                    self.search_match_indices = []
                    self.search_current_match = -1
                    self.search_card.clear_match_info()
                self.apply_filter(False)
                return

            self.apply_filter(False)

        self.run_with_unsaved_guard(action)

    def build_match_indices(self) -> None:
        """构建匹配项索引列表 (修复变量未绑定隐患)"""
        self.search_match_indices = []

        if not self.search_keyword:
            return

        keyword = self.search_keyword
        is_regex = self.search_is_regex
        pattern = None
        keyword_lower = None

        # 预编译正则或准备小写关键词
        if is_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return
        else:
            keyword_lower = keyword.lower()

        for idx, item in enumerate(self.filtered_items):
            src = item.get_src()
            dst = item.get_dst()

            if is_regex and pattern:
                if pattern.search(src) or pattern.search(dst):
                    self.search_match_indices.append(idx)
            elif not is_regex and keyword_lower is not None:
                # 使用局部变量确保类型安全
                search_term: str = keyword_lower
                if search_term in src.lower() or search_term in dst.lower():
                    self.search_match_indices.append(idx)

    def restore_selected_item(self) -> None:
        if self.pending_selected_item is None:
            if self.search_filter_mode and self.search_match_indices:
                self.search_current_match = 0
                self.jump_to_match()
            self.pending_selected_item = None
            return

        if self.pending_selected_item not in self.filtered_items:
            self.pending_selected_item = None
            if self.search_filter_mode and self.search_match_indices:
                self.search_current_match = 0
                self.jump_to_match()
            return

        item_index = self.filtered_items.index(self.pending_selected_item)
        if self.search_match_indices:
            if item_index in self.search_match_indices:
                self.search_current_match = self.search_match_indices.index(item_index)
                self.jump_to_match()
        else:
            page_size = self.pagination_bar.get_page_size()
            target_page = (item_index // page_size) + 1
            self.pagination_bar.set_page(target_page)
            self.render_page(target_page)
            row_in_page = item_index % page_size
            self.table_widget.select_row(row_in_page)

        self.pending_selected_item = None

    def on_search_prev_clicked(self) -> None:
        """上一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self.do_search()
            return

        selection_index = self.get_selected_item_index()
        if selection_index >= 0:
            prev_matches = [m for m in self.search_match_indices if m < selection_index]
            if prev_matches:
                self.search_current_match = self.search_match_indices.index(
                    prev_matches[-1]
                )
            else:
                self.search_current_match = len(self.search_match_indices) - 1
            self.jump_to_match()
            return

        # 循环跳转到上一个
        self.search_current_match -= 1
        if self.search_current_match < 0:
            self.search_current_match = len(self.search_match_indices) - 1
        self.jump_to_match()

    def on_search_next_clicked(self) -> None:
        """下一个匹配项"""
        if not self.search_match_indices:
            # 如果没有匹配结果，先执行搜索
            self.do_search()
            return

        selection_index = self.get_selected_item_index()
        if selection_index >= 0:
            next_matches = [m for m in self.search_match_indices if m > selection_index]
            if next_matches:
                self.search_current_match = self.search_match_indices.index(
                    next_matches[0]
                )
            else:
                self.search_current_match = 0
            self.jump_to_match()
            return

        # 循环跳转到下一个
        self.search_current_match += 1
        if self.search_current_match >= len(self.search_match_indices):
            self.search_current_match = 0
        self.jump_to_match()

    def get_selected_item_index(self) -> int:
        selected_items = self.table_widget.get_selected_items()
        if not selected_items:
            return -1

        item = selected_items[0]
        if item not in self.filtered_items:
            return -1

        return self.filtered_items.index(item)

    def attach_pagination_to_search_bar(self) -> None:
        self.pagination_bar.setParent(self.search_card)
        self.search_card.add_right_widget(self.pagination_bar)

    def attach_pagination_to_command_bar(self) -> None:
        self.pagination_bar.setParent(self.command_bar_card)
        self.command_bar_card.add_widget(self.pagination_bar)

    def jump_to_match(self) -> None:
        """跳转到当前匹配项"""
        if not self.search_match_indices or self.search_current_match < 0:
            return

        # 更新匹配信息显示
        total = len(self.search_match_indices)
        current = self.search_current_match + 1  # 显示时从 1 开始
        self.search_card.set_match_info(current, total)

        # 计算匹配项所在页码
        item_index = self.search_match_indices[self.search_current_match]
        page_size = self.pagination_bar.get_page_size()
        target_page = (item_index // page_size) + 1

        # 如果需要翻页
        current_page = self.pagination_bar.get_page()
        if target_page != current_page:
            self.pagination_bar.set_page(target_page)
            self.render_page(target_page)

        # 在表格中选中该行
        row_in_page = item_index % page_size
        self.table_widget.select_row(row_in_page)

    # ========== 分页渲染 ==========
    def on_page_changed(self, page: int) -> None:
        """页码变化"""
        if self.block_page_change:
            return

        def action() -> None:
            self.render_page(page)

        def revert() -> None:
            self.block_page_change = True
            self.pagination_bar.set_page(self.current_page)
            self.block_page_change = False

        self.run_with_unsaved_guard(action, revert)

    def render_page(self, page_num: int) -> None:
        """渲染指定页的数据"""
        page_size = self.pagination_bar.get_page_size()
        start_idx = (page_num - 1) * page_size
        end_idx = start_idx + page_size

        page_items = self.filtered_items[start_idx:end_idx]
        page_warning_map = {
            ProofreadingDomain.get_warning_key(
                item
            ): ProofreadingDomain.get_item_warnings(item, self.warning_map)
            for item in page_items
        }

        self.table_widget.set_items(page_items, page_warning_map, start_idx)
        self.current_page_start_index = start_idx
        self.current_page = page_num

        if not page_items:
            self.current_item = None
            self.current_row_in_page = -1
            self.edit_panel.clear()
            return

        if self.current_item in page_items:
            row = page_items.index(self.current_item)
        else:
            row = 0

        self.block_selection_change = True
        self.table_widget.selectRow(row)
        self.block_selection_change = False
        self.apply_selection(page_items[row], row)

    def on_table_selection_changed(self) -> None:
        if self.block_selection_change:
            return

        row = self.table_widget.get_selected_row()
        if row < 0:
            self.current_item = None
            self.current_row_in_page = -1
            self.edit_panel.clear()
            return

        item = self.table_widget.get_item_at_row(row)
        if not item:
            return

        def action() -> None:
            self.apply_selection(item, row)

        def revert() -> None:
            if self.current_row_in_page < 0:
                return
            self.block_selection_change = True
            self.table_widget.selectRow(self.current_row_in_page)
            self.block_selection_change = False

        self.run_with_unsaved_guard(action, revert)

    def apply_selection(self, item: Item, row: int) -> None:
        self.current_item = item
        self.current_row_in_page = row
        warnings = ProofreadingDomain.get_item_warnings(item, self.warning_map)
        index = self.current_page_start_index + row + 1
        self.edit_panel.bind_item(item, index, warnings)
        self.edit_panel.set_readonly(self.is_readonly)

    def run_with_unsaved_guard(
        self, action: Callable[[], None], on_cancel: Callable[[], None] | None = None
    ) -> None:
        if not self.edit_panel.has_unsaved_changes():
            action()
            return

        # 直接触发保存，不再弹窗询问用户，减少操作流程中断
        self.pending_action = action
        self.pending_revert = on_cancel
        self.save_current_item()

    def save_current_item(self) -> None:
        if self.is_readonly or not self.current_item:
            return
        self.on_edit_save_requested(
            self.current_item, self.edit_panel.get_current_text()
        )

    def on_edit_save_requested(self, item: Item, new_dst: str) -> None:
        if self.is_readonly:
            return

        if new_dst == item.get_dst():
            self.edit_panel.apply_saved_state()
            if self.pending_action:
                action = self.pending_action
                self.pending_action = None
                self.pending_revert = None
                action()
            return

        old_dst = item.get_dst()
        old_status = item.get_status()
        if new_dst and old_status not in (
            Base.ProjectStatus.PROCESSED,
            Base.ProjectStatus.PROCESSED_IN_PAST,
        ):
            item.set_status(Base.ProjectStatus.PROCESSED)

        item.set_dst(new_dst)

        def task() -> None:
            success = False
            try:
                DataManager.get().save_item(item)
                success = True
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                item.set_dst(old_dst)
                item.set_status(old_status)

            self.item_saved.emit(item, success)

        threading.Thread(target=task, daemon=True).start()

    def on_item_saved_ui(self, item: Item, success: bool) -> None:
        if not success:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().proofreading_page_save_failed,
                },
            )
            if self.pending_revert:
                self.pending_revert()
            self.pending_action = None
            self.pending_revert = None
            return

        self.edit_panel.apply_saved_state()
        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.update_row_dst(row, item.get_dst())

        # 结果检查可能较重，放到后台线程执行，避免 UI 卡顿。
        self.start_recheck_item(item)

        self.update_project_status_after_save()

        # 自动保存成功后给用户反馈，避免用户疑惑修改是否生效
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().toast_save,
            },
        )

        if self.pending_action:
            action = self.pending_action
            self.pending_action = None
            self.pending_revert = None
            action()

        if self.reload_pending and self.data_stale:
            self.reload_pending = False
            self.schedule_reload("after_save")

    def start_recheck_item(self, item: Item) -> None:
        config = self.config
        if config is None:
            self.item_rechecked.emit(item, [])
            return

        def task() -> None:
            try:
                checker = ResultChecker(config)
                warnings = checker.check_item(item)
                self.item_rechecked.emit(item, warnings)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.item_rechecked.emit(item, [])

        threading.Thread(target=task, daemon=True).start()

    def on_item_rechecked_ui(self, item: Item, warnings: list[WarningType]) -> None:
        key = ProofreadingDomain.get_warning_key(item)
        if warnings:
            self.warning_map[key] = warnings
        else:
            self.warning_map.pop(key, None)

        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.update_row_status(row, warnings)
        if self.current_item is item:
            self.edit_panel.refresh_status_tags(item, warnings)

    def recheck_item(self, item: Item) -> list[WarningType]:
        """重新检查单个条目"""
        if not self.config:
            return []

        checker = ResultChecker(self.config)
        warnings = checker.check_item(item)

        key = ProofreadingDomain.get_warning_key(item)
        if warnings:
            self.warning_map[key] = warnings
        else:
            self.warning_map.pop(key, None)

        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            self.table_widget.update_row_status(row, warnings)

        return warnings

    def on_copy_src_clicked(self, item: Item) -> None:
        """复制原文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            clipboard.setText(item.get_src())

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_src_done,
            },
        )

    def on_copy_dst_clicked(self, item: Item) -> None:
        """复制译文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            text = item.get_dst()
            # 右侧编辑面板的“复制译文”应复制当前编辑框内容（可能未保存）。
            if self.sender() is self.edit_panel and self.current_item is item:
                text = self.edit_panel.get_current_text()
            clipboard.setText(text)

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_dst_done,
            },
        )

    # ========== 重置翻译功能 ==========
    def on_reset_translation_clicked(self, item: Item) -> None:
        """重置翻译按钮点击"""
        if self.is_readonly:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_reset_translation_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_reset_translation([item])

    def on_batch_reset_translation_clicked(self, items: list[Item]) -> None:
        """批量重置翻译按钮点击"""
        if self.is_readonly or not items:
            return

        count = len(items)
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_batch_reset_translation_confirm.replace(
                "{COUNT}", str(count)
            ),
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_reset_translation(items)

    def do_batch_reset_translation(self, items: list[Item]) -> None:
        """执行批量重置"""
        # 保存按钮已移至编辑区，重置操作需要自动入库
        for item in items:
            item.set_dst("")
            item.set_status(Base.ProjectStatus.NONE)
            item.set_retry_count(0)

            # 入库
            DataManager.get().save_item(item)

            # 更新 UI 和检查结果
            self.recheck_item(item)
            row = self.table_widget.find_row_by_item(item)
            if row >= 0:
                self.table_widget.update_row_dst(row, "")
            if self.current_item is item:
                warnings = ProofreadingDomain.get_item_warnings(item, self.warning_map)
                index = self.current_page_start_index + self.current_row_in_page + 1
                self.edit_panel.bind_item(item, index, warnings)
                self.edit_panel.set_readonly(self.is_readonly)

        self.update_project_status_after_save()

    # ========== 重新翻译功能 ==========
    def on_retranslate_clicked(self, item: Item) -> None:
        """重新翻译按钮点击 - 单条翻译也使用批量翻译流程"""
        if self.is_readonly or not self.config:
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_retranslate_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 使用统一的批量翻译流程（单条也走这个逻辑）
        self.do_batch_retranslate([item])

    def on_batch_retranslate_clicked(self, items: list[Item]) -> None:
        """批量重新翻译按钮点击"""
        if self.is_readonly or not self.config or not items:
            return

        # 确认对话框
        count = len(items)
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_batch_retranslate_confirm.replace(
                "{COUNT}", str(count)
            ),
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        self.do_batch_retranslate(items)

    def do_batch_retranslate(self, items: list[Item]) -> None:
        """执行批量翻译（单条和多条统一入口）"""
        count = len(items)
        # 使用最新配置，而非缓存的 self.config
        config = Config().load()

        # 显示进度 Toast（初始显示"正在处理第 1 个"）
        self.progress_show(
            Localizer.get()
            .task_batch_translation_progress.replace("{CURRENT}", "1")
            .replace("{TOTAL}", str(count)),
            1,
            count,
        )

        def batch_translate_task() -> None:
            success_count = 0
            fail_count = 0
            total = len(items)

            for idx, item in enumerate(items):
                # 更新进度（在任务开始前显示"正在处理第 N 个"）
                current = idx + 1
                self.progress_updated.emit(
                    Localizer.get()
                    .task_batch_translation_progress.replace("{CURRENT}", str(current))
                    .replace("{TOTAL}", str(total)),
                    current,
                    total,
                )

                # 重置状态
                item.set_status(Base.ProjectStatus.NONE)
                item.set_retry_count(0)

                # 同步翻译（使用 Event 等待完成，兼容 No-GIL）
                complete_event = threading.Event()
                result_container = {"success": False}

                def callback(i: Item, s: bool) -> None:
                    result_container["success"] = s
                    # 发射信号通知 UI 逐条刷新
                    self.translate_done.emit(i, s)
                    complete_event.set()

                Engine.get().translate_single_item(
                    item=item, config=config, callback=callback
                )

                # 阻塞等待翻译完成，避免忙轮询
                complete_event.wait()

                if result_container["success"]:
                    success_count += 1
                else:
                    fail_count += 1
                    item.set_status(Base.ProjectStatus.ERROR)

            # 完成后隐藏 Toast（通过信号在主线程执行）
            self.progress_finished.emit()

            # 显示结果
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS
                    if fail_count == 0
                    else Base.ToastType.WARNING,
                    "message": Localizer.get()
                    .task_batch_translation_success.replace(
                        "{SUCCESS}", str(success_count)
                    )
                    .replace("{FAILED}", str(fail_count)),
                },
            )

        threading.Thread(target=batch_translate_task, daemon=True).start()

    def on_translate_done_ui(self, item: Item, success: bool) -> None:
        """翻译完成的 UI 更新（主线程）- 逐条刷新，不显示 Toast（批量流程统一显示）"""
        # 失败时先落状态，保证后续持久化与 UI 刷新一致。
        if not success:
            item.set_status(Base.ProjectStatus.ERROR)

        # 保存按钮已移至编辑区，翻译完成后需要自动入库
        try:
            DataManager.get().save_item(item)
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)

        # 1. 无论是否可见，都更新数据层面的警告状态，确保翻页后状态正确
        if success:
            self.recheck_item(item)

        # 2. 如果条目在当前页可见，更新 UI 显示
        row = self.table_widget.find_row_by_item(item)
        if row >= 0:
            if success:
                self.table_widget.update_row_dst(row, item.get_dst())
            else:
                # 失败也要刷新状态图标，否则 UI 可能仍显示旧状态。
                warnings = ProofreadingDomain.get_item_warnings(item, self.warning_map)
                self.table_widget.update_row_status(row, warnings)
        if self.current_item is item:
            warnings = ProofreadingDomain.get_item_warnings(item, self.warning_map)
            index = self.current_page_start_index + self.current_row_in_page + 1
            self.edit_panel.bind_item(item, index, warnings)
            self.edit_panel.set_readonly(self.is_readonly)

        self.update_project_status_after_save()

    def on_progress_updated_ui(self, content: str, current: int, total: int) -> None:
        """进度更新的 UI 处理（主线程）"""
        self.progress_update(content, current, total)

    def on_progress_finished_ui(self) -> None:
        """进度完成的 UI 处理（主线程）"""
        self.indeterminate_hide()
        # 逐条刷新已在 on_translate_done_ui 中完成，无需再次刷新

    # ========== 保存功能 ==========
    def on_save_clicked(self) -> None:
        """保存按钮点击"""
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def save_data(self) -> None:
        """保存数据到缓存文件（异步执行）"""
        if self.is_readonly or not self.config or not self.items_all:
            self.indeterminate_hide()
            return

        # 捕获当前状态的引用，避免在子线程中访问 self 时产生竞态
        items_all = self.items_all

        def task() -> None:
            try:
                # 直接写入工程数据库
                DataManager.get().replace_all_items(items_all)
                self.update_project_status_after_save()

                self.save_done.emit(True)
            except Exception as e:
                LogManager.get().error(Localizer.get().proofreading_page_save_failed, e)
                self.save_done.emit(False)

        threading.Thread(target=task, daemon=True).start()

    def update_project_status_after_save(self) -> None:
        dm = DataManager.get()
        if not dm.is_loaded():
            return

        review_items = self.items
        untranslated_count = sum(
            1 for item in review_items if item.get_status() == Base.ProjectStatus.NONE
        )
        project_status = (
            Base.ProjectStatus.PROCESSING
            if untranslated_count > 0
            else Base.ProjectStatus.PROCESSED
        )
        dm.set_project_status(project_status)

        extras = dm.get_translation_extras()
        translated_count = sum(
            1
            for item in review_items
            if item.get_status()
            in (
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.PROCESSED_IN_PAST,
            )
        )
        extras["line"] = translated_count
        dm.set_translation_extras(extras)

    # ========== 导出功能 ==========
    def on_export_clicked(self) -> None:
        """导出按钮点击"""
        # 弹框让用户确认
        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().export_translation_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            return

        # 先保存数据再导出，保证译文文件与缓存数据一致
        self.pending_export = True
        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_saving)
        self.save_data()

    def on_save_done_ui(self, success: bool) -> None:
        """保存完成的 UI 更新（主线程）"""
        # 检查是否有待处理的导出操作
        pending_export = self.pending_export
        self.pending_export = False

        if pending_export:
            # 导出流程中的保存
            if success:
                self.indeterminate_show(
                    Localizer.get().proofreading_page_indeterminate_exporting
                )
                self.export_data()  # 异步执行，完成后由 export_done 信号触发隐藏
            else:
                self.indeterminate_hide()
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_save_failed,
                    },
                )
        else:
            # 普通保存流程：成功时触发项目状态检查，失败时弹出错误提示
            self.indeterminate_hide()
            if success:
                # 通知翻译页更新按钮状态
                self.emit(Base.Event.PROJECT_CHECK_RUN, {})
            else:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().proofreading_page_save_failed,
                    },
                )

    def export_data(self) -> None:
        """导出数据（异步执行）"""
        if not self.config or not self.items_all:
            self.export_done.emit(False, "")
            return

        # 捕获当前状态的引用，避免子线程中访问 self 时产生竞态
        config = self.config
        items_all = self.items_all

        def task() -> None:
            try:
                FileManager(config).write_to_path(items_all)
                self.export_done.emit(True, "")
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.export_done.emit(False, "")

        threading.Thread(target=task, daemon=True).start()

    def on_export_done_ui(self, success: bool, error_msg: str) -> None:
        """导出完成的 UI 更新（主线程）"""
        # 成功时直接隐藏进度条，失败时弹出错误提示
        self.indeterminate_hide()
        if not success:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": error_msg
                    or Localizer.get().proofreading_page_export_failed,
                },
            )

    # ========== 只读模式控制 ==========
    def on_engine_status_changed(self, event: Base.Event, data: dict) -> None:
        """Engine 状态变更事件"""
        del data
        if event == Base.Event.TRANSLATION_RUN:
            # 翻译过程中数据会变化；翻译结束后需要自动同步。
            self.data_stale = True
            self.reload_pending = True
        if event == Base.Event.TRANSLATION_DONE:
            # 翻译完成视为一次新的数据周期。
            self.mark_data_stale(new_cycle=True)

        self.check_engine_status()

    def check_engine_status(self) -> None:
        """检查并更新只读模式"""
        # 获取全局引擎状态，确保 UI 状态与后台任务一致
        engine_status = Engine.get().get_status()
        is_busy = engine_status in (
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.STOPPING,
        )

        was_busy = self.is_readonly

        # 1. 如果处于翻译中/停止中，清空页面数据
        if is_busy and (self.items or self.items_all):
            self.items_all = []
            self.items = []
            self.filtered_items = []
            self.warning_map = {}
            self.data_stale = True
            self.reload_pending = True
            # 繁忙态清空选择态，避免 current_item 等指向旧对象造成 UI 同步错乱。
            self.pending_selected_item = None
            self.current_item = None
            self.current_row_in_page = -1
            self.current_page_start_index = 0
            self.current_page = 1
            # 使在途的加载线程结果自动失效，避免翻译中被旧数据覆盖。
            self.loading_token = 0
            self.is_loading = False
            self.table_widget.set_items([], {})
            self.pagination_bar.reset()
            self.edit_panel.clear()

        # 禁用态不保留搜索状态：若当前在搜索栏，直接回到主动作条。
        if is_busy:
            self.reset_search_state()

        # 2. 翻译结束后自动同步一次
        if was_busy and (not is_busy) and self.data_stale:
            self.schedule_reload("engine_idle")

        # 2. 更新按钮状态
        has_items_all = bool(self.items_all)
        has_items = bool(self.items)

        # 其他按钮只有在不繁忙且有数据时启用
        can_operate_export = not is_busy and has_items_all
        can_operate_review = not is_busy and has_items
        self.btn_export.setEnabled(can_operate_export)
        self.btn_search.setEnabled(can_operate_review)
        self.btn_filter.setEnabled(can_operate_review)

        if is_busy != self.is_readonly:
            self.is_readonly = is_busy
            self.table_widget.set_readonly(is_busy)
        # 无论是否选中条目都需要同步（空态也应只读 + 禁用写入口）。
        self.edit_panel.set_readonly(self.is_readonly)

    def showEvent(self, a0: QShowEvent | None) -> None:
        """页面显示时自动刷新状态，确保与全局翻译任务同步"""
        super().showEvent(a0)
        self.check_engine_status()
        if self.data_stale:
            self.schedule_reload("show")
        if self.pending_quality_rule_refresh and self.items:
            self.pending_quality_rule_refresh = False
            self.schedule_quality_rule_refresh()

    # ========== Loading 指示器 ==========
    def indeterminate_show(self, msg: str) -> None:
        """显示 loading 指示器（不定进度）"""
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": msg,
                "indeterminate": True,
            },
        )

    def progress_show(self, msg: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度指示器"""
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": msg,
                "indeterminate": False,
                "current": current,
                "total": total,
            },
        )

    def progress_update(self, msg: str, current: int, total: int) -> None:
        """更新进度"""
        self.emit(
            Base.Event.PROGRESS_TOAST_UPDATE,
            {
                "message": msg,
                "current": current,
                "total": total,
            },
        )

    def indeterminate_hide(self) -> None:
        """隐藏 loading 指示器"""
        self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})

    def on_translation_reset(self, event: Base.Event, data: dict) -> None:
        """响应翻译重置事件"""
        self.clear_all_data()
        self.mark_data_stale(new_cycle=True)
        self.schedule_reload("translation_reset")

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        """工程加载后自动同步数据"""
        del event
        del data
        self.clear_all_data()
        self.config = None
        self.mark_data_stale(new_cycle=True)
        self.schedule_reload("project_loaded")

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后清理数据"""
        self.clear_all_data()
        self.config = None

    def clear_all_data(self) -> None:
        """彻底清理页面所有数据和 UI 状态"""
        # 清空数据
        self.items_all = []
        self.items = []
        self.filtered_items = []
        self.warning_map = {}
        self.result_checker = None
        self.filter_options = ProofreadingFilterOptions()
        self.current_item = None
        self.current_row_in_page = -1
        self.current_page_start_index = 0
        self.current_page = 1
        self.data_stale = True
        self.reload_pending = False
        self.is_loading = False
        self.loading_token = 0
        self.data_version = 0

        # 禁用态不保留搜索状态。
        self.reset_search_state()

        # 重置表格和分页
        self.table_widget.set_items([], {})
        self.pagination_bar.reset()
        self.edit_panel.set_result_checker(None)
        self.edit_panel.clear()

        # 重置按钮状态
        self.btn_export.setEnabled(False)
        self.btn_search.setEnabled(False)
        self.btn_filter.setEnabled(False)

        # 隐藏 loading
        self.indeterminate_hide()
