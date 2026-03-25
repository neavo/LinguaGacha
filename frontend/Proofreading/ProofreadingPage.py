import re
import threading
from dataclasses import dataclass
from typing import Any
from typing import Callable

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from PySide6.QtCore import QSize
from PySide6.QtCore import QTimer
from PySide6.QtCore import Signal
from PySide6.QtGui import QFont
from PySide6.QtGui import QKeySequence
from PySide6.QtGui import QShortcut
from PySide6.QtGui import QShowEvent
from PySide6.QtWidgets import QApplication
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from api.Bridge.ProofreadingRuleImpact import ProofreadingRuleImpact
from frontend.Proofreading.FilterDialog import FilterDialog
from frontend.Proofreading.ProofreadingEditPanel import ProofreadingEditPanel
from frontend.Proofreading.ProofreadingTableWidget import ProofreadingTableWidget
from model.Api.ProofreadingModels import ProofreadingFilterOptionsSnapshot
from model.Api.ProofreadingModels import ProofreadingItemView
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard

# ==================== 图标常量 ====================
ICON_ACTION_SEARCH: BaseIcon = BaseIcon.SEARCH  # 命令栏：打开搜索栏
ICON_ACTION_REPLACE: BaseIcon = BaseIcon.REPLACE  # 命令栏：打开替换栏
ICON_ACTION_FILTER: BaseIcon = BaseIcon.FUNNEL  # 命令栏：打开筛选面板


@dataclass(frozen=True)
class ProofreadingLookupRequest:
    keyword: str
    is_regex: bool


def resolve_status_after_manual_edit(old_status: str, new_dst: str) -> str:
    if old_status == Base.ProjectStatus.PROCESSED_IN_PAST.value:
        return Base.ProjectStatus.PROCESSED.value
    if not new_dst:
        return old_status
    if old_status == Base.ProjectStatus.PROCESSED.value:
        return old_status
    return Base.ProjectStatus.PROCESSED.value


class ProofreadingPage(Base, QWidget):
    """校对任务主页面"""

    # 布局常量
    FONT_SIZE = 12
    ICON_SIZE = 16

    # 防抖时间（毫秒）
    AUTO_RELOAD_DELAY_MS: int = 120

    # 信号定义
    items_loaded = Signal(int, object)  # (token, payload)
    filter_done = Signal(int, object)  # (data_version, filtered_snapshot)
    search_done = Signal(object)  # 搜索结果
    translate_done = Signal(object, int)  # (result, requested_count)
    item_saved = Signal(object, bool)  # 单条保存完成信号
    item_rechecked = Signal(object, bool)  # (result, success)
    progress_updated = Signal(str, int, int)  # 进度更新信号 (content, current, total)
    progress_finished = Signal()  # 进度完成信号
    replace_all_done = Signal(object)  # 批量替换完成信号

    def __init__(
        self,
        text: str,
        proofreading_api_client: ProofreadingApiClient,
        api_state_store: ApiStateStore,
        window: FluentWindow,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 成员变量
        self.main_window = window
        self.proofreading_api_client = proofreading_api_client
        self.api_state_store = api_state_store
        self.current_snapshot: ProofreadingSnapshot = ProofreadingSnapshot()
        self.filtered_items: list[ProofreadingItemView] = []  # 当前展示的快照条目
        self.search_result: ProofreadingSearchResult | None = None
        self.is_readonly: bool = False  # 只读模式标志
        self.is_resetting: bool = False  # 重置执行中标志（RUN 到终态）
        self.filter_options: ProofreadingFilterOptionsSnapshot = (
            ProofreadingFilterOptionsSnapshot()
        )
        self.filter_dialog: FilterDialog | None = None
        self.selected_item_id: int | str | None = None
        self.search_keyword: str = ""  # 当前搜索关键词
        self.search_is_regex: bool = False  # 是否正则搜索
        self.search_replace_mode: bool = False  # True 表示仅在 dst 上查找/替换
        self.search_match_indices: list[int] = []  # 匹配项在 filtered_items 中的索引
        self.search_current_match: int = (
            -1
        )  # 当前匹配项索引（在 search_match_indices 中的位置）
        self.search_next_anchor_index: int | None = None
        self.search_next_anchor_strict: bool = True
        self.replace_once_last_item_index: int | None = None
        self.replace_once_keep_match: bool = False
        self.replace_once_pending_jump: bool = False
        self.replace_once_pending_refilter_apply: bool = False
        self.pending_selected_item_id: int | str | None = None
        self.current_item: ProofreadingItemView | None = None
        # 分页已移除：该值表示当前条目在 filtered_items 中的绝对行索引。
        self.current_row_index: int = -1
        self.block_selection_change: bool = False
        self.pending_action: Callable[[], None] | None = None
        self.pending_revert: Callable[[], None] | None = None
        # Replace 后不立刻重筛，等待下一次显式搜索再刷新列表范围。
        self.search_refilter_deferred: bool = False
        self.pending_lookup_request: ProofreadingLookupRequest | None = None

        # 自动载入/同步调度
        self.data_stale: bool = True
        self.reload_pending: bool = False
        self.is_loading: bool = False
        self.reload_token: int = 0
        self.loading_token: int = 0
        self.data_version: int = 0
        self.reload_timer: QTimer = QTimer(self)
        self.reload_timer.setSingleShot(True)
        self.reload_timer.timeout.connect(self.try_reload)
        self.pending_quality_rule_refresh: bool = False
        self.task_busy_hint: bool = False

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
        # 这里只关心任务生命周期节点；高频进度不会改变只读状态，订阅它们只会放大无效刷新。
        self.subscribe(Base.Event.TRANSLATION_TASK, self.on_engine_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUEST_STOP, self.on_engine_status_changed
        )
        self.subscribe(Base.Event.ANALYSIS_TASK, self.on_engine_status_changed)
        self.subscribe(Base.Event.ANALYSIS_REQUEST_STOP, self.on_engine_status_changed)
        self.subscribe(Base.Event.TRANSLATION_RESET_ALL, self.on_translation_reset)
        self.subscribe(
            Base.Event.TRANSLATION_RESET_FAILED,
            self.on_translation_reset,
        )
        self.subscribe(Base.Event.ANALYSIS_RESET_ALL, self.on_translation_reset)
        self.subscribe(Base.Event.ANALYSIS_RESET_FAILED, self.on_translation_reset)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)
        self.subscribe(Base.Event.PROJECT_FILE_UPDATE, self.on_project_file_update)
        self.subscribe(Base.Event.QUALITY_RULE_UPDATE, self.on_quality_rule_update)
        self.subscribe(Base.Event.PROJECT_PREFILTER, self.on_project_prefilter_updated)

        # 连接信号
        self.items_loaded.connect(self.on_items_loaded_ui)
        self.filter_done.connect(self.on_filter_done_ui)
        self.search_done.connect(self.on_search_done_ui)
        self.translate_done.connect(self.on_translate_done_ui)
        self.item_saved.connect(self.on_item_saved_ui)
        self.item_rechecked.connect(self.on_item_rechecked_ui)
        self.progress_updated.connect(self.on_progress_updated_ui)
        self.progress_finished.connect(self.on_progress_finished_ui)
        self.replace_all_done.connect(self.on_replace_all_done_ui)

    def on_quality_rule_update(self, event: Base.Event, event_data: dict) -> None:
        del event
        # 只对影响校对判定的规则变更触发重算，避免无效刷新
        if not self.is_quality_rule_update_relevant(event_data):
            return
        if not self.isVisible():
            self.pending_quality_rule_refresh = True
            return
        if not self.current_snapshot.items:
            return
        self.mark_data_stale()
        self.schedule_reload("quality_rule_updated")

    def on_project_prefilter_updated(self, event: Base.Event, event_data: dict) -> None:
        del event
        sub_event = event_data.get("sub_event")
        if sub_event != Base.ProjectPrefilterSubEvent.UPDATED:
            return
        self.mark_data_stale()
        self.schedule_reload("prefilter_updated")

    def on_project_file_update(self, event: Base.Event, event_data: dict) -> None:
        """工程文件变更（工作台增删改重命名）后同步校对页数据。"""
        del event

        rel_path = event_data.get("rel_path") if isinstance(event_data, dict) else None
        if not isinstance(rel_path, str) or not rel_path:
            return
        # 文件内容/路径变更会影响 items 快照与筛选范围；即便页面不可见也要标记 stale，
        # 这样用户切回校对页时 showEvent 才会触发自动 reload。
        self.mark_data_stale()
        self.schedule_reload("project_file_update")

    def is_quality_rule_update_relevant(self, event_data: dict) -> bool:
        return ProofreadingRuleImpact.is_rule_update_relevant(event_data)

    # ========== 主体：表格 ==========
    def add_widget_body(self, parent: QVBoxLayout, main_window: FluentWindow) -> None:
        """添加主体控件"""
        body_widget = QWidget(self)
        body_layout = QHBoxLayout(body_widget)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(8)

        # qfluentwidgets 的样式管理依赖 widget 的父子关系；首次进入页面时若表格无父对象，
        # 可能回退为 Qt 原生风格，直到主题切换触发全局刷新才恢复。
        self.table_widget = ProofreadingTableWidget(body_widget)
        self.table_widget.batch_retranslate_clicked.connect(
            self.on_batch_retranslate_clicked
        )
        self.table_widget.batch_reset_translation_clicked.connect(
            self.on_batch_reset_translation_clicked
        )
        self.table_widget.itemSelectionChanged.connect(self.on_table_selection_changed)
        self.table_widget.set_items([])

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
        self.search_card.on_search_options_changed(
            lambda w: self.on_search_options_changed()
        )
        self.search_card.on_replace_clicked(lambda w: self.on_replace_once_clicked())
        self.search_card.on_replace_all_clicked(lambda w: self.on_replace_all_clicked())

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
        self.btn_search = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_SEARCH,
                Localizer.get().search,
                triggered=self.on_search_clicked,
            )
        )
        self.btn_search.setEnabled(False)
        self.install_shortcut_tooltip(
            self.btn_search,
            Localizer.get().shortcut_ctrl_f,
        )

        self.btn_replace = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_REPLACE,
                Localizer.get().proofreading_page_replace_action,
                triggered=self.on_replace_clicked,
            )
        )
        self.btn_replace.setEnabled(False)
        self.install_shortcut_tooltip(
            self.btn_replace,
            Localizer.get().shortcut_ctrl_h,
        )

        self.command_bar_card.add_separator()
        self.btn_filter = self.command_bar_card.add_action(
            Action(
                ICON_ACTION_FILTER,
                Localizer.get().proofreading_page_filter,
                triggered=self.on_filter_clicked,
            )
        )
        self.btn_filter.setEnabled(False)

        # 右侧留白：保持命令栏布局稳定（分页已迁移为无限滚动）。
        self.command_bar_card.add_stretch(1)

        self.search_shortcut = QShortcut(
            QKeySequence(Localizer.get().shortcut_ctrl_f),
            self,
        )
        self.search_shortcut.activated.connect(self.on_search_shortcut)

        self.replace_shortcut = QShortcut(
            QKeySequence(Localizer.get().shortcut_ctrl_h),
            self,
        )
        self.replace_shortcut.activated.connect(self.on_replace_shortcut)

    # ========== 自动载入 / 同步 ==========

    def mark_data_stale(self) -> None:
        self.data_stale = True

    def build_item_payload(self, item: ProofreadingItemView) -> dict[str, Any]:
        status_value = item.status
        try:
            status_value = Base.ProjectStatus(item.status)
        except ValueError:
            status_value = item.status
        return {
            "id": item.item_id,
            "row": item.row_number,
            "src": item.src,
            "dst": item.dst,
            "file_path": item.file_path,
            "status": status_value,
        }

    def build_item_payloads(
        self,
        items: list[ProofreadingItemView],
        *,
        dst_override: str | None = None,
        status_override: str | Base.ProjectStatus | None = None,
    ) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        for item in items:
            payload = self.build_item_payload(item)
            if dst_override is not None:
                payload["dst"] = dst_override
            if status_override is not None:
                payload["status"] = status_override
            payloads.append(payload)
        return payloads

    def get_project_id(self) -> str:
        project_id = self.current_snapshot.project_id
        if project_id:
            return project_id
        return self.api_state_store.get_project_path()

    def is_task_busy(self) -> bool:
        return self.api_state_store.is_busy() or self.task_busy_hint

    def find_filtered_item_index(self, item_id: int | str | None) -> int:
        if item_id is None:
            return -1
        for index, item in enumerate(self.filtered_items):
            if item.item_id == item_id:
                return index
        return -1

    def replace_items_in_snapshot(
        self,
        source_items: tuple[ProofreadingItemView, ...],
        changed_items: tuple[ProofreadingItemView, ...],
    ) -> tuple[ProofreadingItemView, ...]:
        changed_map = {item.item_id: item for item in changed_items}
        if not changed_map:
            return source_items
        return tuple(changed_map.get(item.item_id, item) for item in source_items)

    def apply_mutation_result(
        self,
        result: ProofreadingMutationResult,
        *,
        preferred_item_id: int | str | None = None,
    ) -> None:
        merged_items = self.replace_items_in_snapshot(
            self.current_snapshot.items,
            result.items,
        )
        self.current_snapshot = ProofreadingSnapshot(
            revision=result.revision,
            project_id=self.current_snapshot.project_id,
            readonly=self.current_snapshot.readonly,
            summary=result.summary,
            filters=self.current_snapshot.filters,
            items=merged_items,
        )
        self.filtered_items = list(
            self.replace_items_in_snapshot(tuple(self.filtered_items), result.items)
        )
        if preferred_item_id is not None:
            self.selected_item_id = preferred_item_id

        self.table_widget.set_items(list(self.filtered_items))
        self.restore_selected_item()
        if self.search_keyword:
            self.start_search()
        self.check_engine_status()

    def apply_snapshot(
        self,
        snapshot: ProofreadingSnapshot,
        *,
        preferred_item_id: int | str | None = None,
    ) -> None:
        """应用 API 返回的校对快照。"""

        self.current_snapshot = snapshot
        self.filtered_items = list(snapshot.items)
        self.selected_item_id = preferred_item_id
        self.search_result = None
        self.current_item = None
        self.current_row_index = -1
        self.data_stale = False
        self.filter_options = snapshot.filters
        self.is_readonly = snapshot.readonly
        self.table_widget.set_items(list(snapshot.items))
        if not snapshot.items:
            self.edit_panel.clear()
        self.restore_selected_item()
        self.check_engine_status()

    def reload_invalidated_snapshot_if_needed(self) -> None:
        """当 SSE 标记校对快照失效时，重新通过 API 拉取一次。"""

        if not self.api_state_store.is_proofreading_snapshot_invalidated():
            return

        snapshot = self.proofreading_api_client.get_snapshot({})
        preferred_item_id = getattr(self, "selected_item_id", None)
        self.apply_snapshot(snapshot, preferred_item_id=preferred_item_id)
        self.api_state_store.clear_proofreading_snapshot_invalidated()

    def schedule_reload(self, reason: str) -> None:
        del reason
        if not self.isVisible():
            return
        if not self.api_state_store.is_project_loaded():
            return
        if self.is_task_busy():
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
        if not self.api_state_store.is_project_loaded():
            return
        if self.is_task_busy():
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
        project_id = self.get_project_id()

        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)

        def task() -> None:
            try:
                snapshot = self.proofreading_api_client.get_snapshot(
                    {"project_id": project_id}
                )
                self.items_loaded.emit(token, snapshot)
            except Exception as e:
                LogManager.get().error(Localizer.get().alert_no_data, e)
                self.items_loaded.emit(token, None)

        threading.Thread(target=task, daemon=True).start()

    def on_items_loaded_ui(self, token: int, payload: object) -> None:
        """数据加载完成的 UI 更新（主线程）"""
        if token != self.loading_token:
            return

        self.is_loading = False
        self.indeterminate_hide()

        if not isinstance(payload, ProofreadingSnapshot):
            self.data_stale = True
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().alert_no_data,
                },
            )
            return

        self.data_version = token
        self.apply_snapshot(payload, preferred_item_id=self.selected_item_id)
        if self.pending_lookup_request is not None:
            self.apply_pending_lookup_if_ready()

        if self.reload_pending:
            self.reload_pending = False
            self.data_stale = True
            self.schedule_reload("pending")

    # ========== 筛选功能 ==========
    def on_filter_clicked(self) -> None:
        """筛选按钮点击"""
        if not self.current_snapshot.items:
            return

        if self.filter_dialog is None:
            self.filter_dialog = FilterDialog(
                items=list(self.current_snapshot.items),
                project_id=self.current_snapshot.project_id,
                parent=self.main_window,
            )

        dialog = self.filter_dialog
        dialog.reset_for_open()
        dialog.update_snapshot(
            items=list(self.current_snapshot.items),
            project_id=self.current_snapshot.project_id,
        )
        dialog.set_filter_options(self.filter_options)

        if dialog.exec():
            new_options = dialog.get_filter_options()

            def action() -> None:
                self.filter_options = new_options
                self.pending_selected_item_id = None
                self.apply_filter(False)

            self.run_with_unsaved_guard(action)

    def apply_filter(self, guard: bool = True) -> None:
        """应用筛选条件 (异步执行)"""
        if guard:
            self.run_with_unsaved_guard(lambda: self.apply_filter(False))
            return

        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)
        data_version = self.data_version
        filter_options = self.filter_options.to_dict()
        project_id = self.get_project_id()

        if self.search_keyword and self.search_is_regex:
            try:
                re.compile(self.search_keyword)
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
                filtered_snapshot = self.proofreading_api_client.filter_items(
                    {
                        "project_id": project_id,
                        "filters": filter_options,
                    }
                )
                self.filter_done.emit(data_version, filtered_snapshot)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.filter_done.emit(data_version, None)

        threading.Thread(target=filter_task, daemon=True).start()

    def on_filter_done_ui(self, data_version: int, payload: object) -> None:
        """筛选完成的 UI 更新 (主线程)"""
        if data_version != self.data_version:
            self.replace_once_pending_refilter_apply = False
            return

        self.indeterminate_hide()
        if not isinstance(payload, ProofreadingSnapshot):
            self.filtered_items = []
            self.table_widget.set_items([])
            self.edit_panel.clear()
            return

        self.filtered_items = list(payload.items)

        # 分页已迁移为无限滚动：筛选完成后一次性设置数据源，由 TableModel 负责 lazyload。
        self.table_widget.set_items(list(self.filtered_items))
        if not self.filtered_items:
            self.current_item = None
            self.current_row_index = -1
            self.edit_panel.clear()

        # 筛选后更新搜索状态
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_card.clear_match_info()
        should_build_match_indices = bool(self.search_keyword)
        if should_build_match_indices:
            # 搜索条件已在过滤阶段应用，匹配索引直接使用全量范围，避免重复扫描。
            self.search_match_indices = list(range(len(self.filtered_items)))
            if not self.search_match_indices:
                self.search_next_anchor_index = None
                self.search_card.set_match_info(0, 0)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )
            elif self.search_next_anchor_index is not None:
                self.search_current_match = self.pick_next_match_position(
                    matches=self.search_match_indices,
                    anchor=self.search_next_anchor_index,
                    strict=self.search_next_anchor_strict,
                )
                self.search_next_anchor_index = None
        else:
            self.search_next_anchor_index = None

        self.restore_selected_item()
        if self.search_keyword:
            self.start_search()

        if self.replace_once_pending_refilter_apply:
            self.replace_once_pending_refilter_apply = False
            self.on_replace_once_clicked()

    # 默认筛选与校对条目构建已下沉到快照加载服务。

    # ========== 搜索功能 ==========
    def show_search_panel(self, *, replace_mode: bool) -> None:
        """统一切换搜索栏展示状态，避免搜索/替换/反查入口各自拼 UI。"""

        self.search_card.set_replace_mode(replace_mode)
        self.search_card.setVisible(True)
        self.command_bar_card.setVisible(False)
        self.search_card.get_line_edit().setFocus()

    def hide_search_panel(self) -> None:
        self.search_card.setVisible(False)
        self.command_bar_card.setVisible(True)

    def clear_search_runtime_state(self) -> None:
        """清空搜索相关运行态，不直接改动搜索栏控件内容。"""

        self.search_keyword = ""
        self.search_is_regex = False
        self.search_replace_mode = False
        self.search_refilter_deferred = False
        self.replace_once_pending_jump = False
        self.replace_once_pending_refilter_apply = False
        self.search_match_indices = []
        self.search_current_match = -1
        self.search_next_anchor_index = None
        self.pending_selected_item_id = None

    def on_search_clicked(self) -> None:
        """搜索按钮点击"""
        self.show_search_panel(replace_mode=False)

    def on_replace_clicked(self) -> None:
        """替换按钮点击"""
        self.show_search_panel(replace_mode=True)

    def install_shortcut_tooltip(self, widget: QWidget, shortcut: str) -> None:
        """命令栏按钮统一显示仅含快捷键的 qfluent Tooltip。"""
        widget.setToolTip(shortcut)
        widget.installEventFilter(ToolTipFilter(widget, 300, ToolTipPosition.TOP))

    def on_search_shortcut(self) -> None:
        """Ctrl+F：打开搜索栏，或在已展开时聚焦搜索输入框。"""
        if not self.btn_search.isEnabled():
            return
        if not self.search_card.isVisible():
            self.on_search_clicked()
            return
        self.search_card.get_line_edit().setFocus()

    def on_replace_shortcut(self) -> None:
        """Ctrl+H：优先执行单步替换，否则切换到替换模式。"""
        if self.search_card.isVisible() and self.search_card.is_replace_mode():
            # 复用同一快捷键：搜索栏已处于 Replace 模式时，直接触发当前替换动作。
            if self.search_card.replace_btn.isEnabled():
                self.on_replace_once_clicked()
            return
        if not self.btn_replace.isEnabled():
            return
        self.on_replace_clicked()
        self.search_card.get_line_edit().setFocus()

    def on_search_back_clicked(self) -> None:
        """搜索栏返回点击，清除搜索状态"""

        def action() -> None:
            self.pending_lookup_request = None
            self.clear_search_runtime_state()
            self.search_card.reset_state()
            self.apply_filter(False)
            self.hide_search_panel()

        self.run_with_unsaved_guard(action)

    def reset_search_state(self) -> None:
        """清空搜索状态并退出搜索栏。

        用于页面禁用/数据清空等场景：不保留搜索输入/模式/匹配进度。
        """

        self.pending_lookup_request = None
        self.clear_search_runtime_state()

        self.search_card.reset_state()
        self.hide_search_panel()

    def request_lookup(self, *, keyword: str, is_regex: bool) -> None:
        """接收质量规则页的反查请求，并尽量在页面可见后自动执行。"""

        normalized_keyword = keyword.strip()
        if not normalized_keyword:
            return

        self.pending_lookup_request = ProofreadingLookupRequest(
            keyword=normalized_keyword,
            is_regex=bool(is_regex),
        )
        self.search_card.set_search_state(
            keyword=normalized_keyword,
            is_regex=bool(is_regex),
            replace_mode=False,
            emit_options_changed=False,
        )
        self.search_card.clear_match_info()
        self.show_search_panel(replace_mode=False)
        if self.isVisible():
            self.apply_pending_lookup_if_ready()

    def apply_pending_lookup_if_ready(self) -> None:
        """在数据和可见性都就绪后执行挂起的反查请求。"""

        lookup = self.pending_lookup_request
        if lookup is None:
            return
        if not self.isVisible():
            return
        if self.is_loading:
            return
        if self.data_stale:
            self.schedule_reload("quality_rule_lookup")
            return

        def action() -> None:
            current_lookup = self.pending_lookup_request
            if current_lookup is None:
                return

            self.pending_lookup_request = None
            self.clear_search_runtime_state()
            self.search_card.set_search_state(
                keyword=current_lookup.keyword,
                is_regex=current_lookup.is_regex,
                replace_mode=False,
                emit_options_changed=False,
            )
            self.search_keyword = current_lookup.keyword
            self.search_is_regex = current_lookup.is_regex
            self.start_search()
            self.search_card.get_line_edit().setFocus()

        self.run_with_unsaved_guard(action)

    def do_search(self) -> None:
        """执行搜索，并让页面只消费 API 返回的匹配结果。"""
        keyword = self.search_card.get_keyword()
        self.search_replace_mode = self.search_card.is_replace_mode()
        self.replace_once_pending_jump = False
        self.replace_once_pending_refilter_apply = False
        if not keyword:
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_next_anchor_index = None
            self.search_card.clear_match_info()
            self.search_keyword = ""
            self.search_is_regex = self.search_card.is_regex_mode()
            self.pending_selected_item_id = None
            self.search_result = None
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
        self.search_next_anchor_index = None

        def action() -> None:
            self.pending_selected_item_id = None
            self.start_search()

        self.run_with_unsaved_guard(action)

    def on_search_options_changed(self) -> None:
        had_keyword = bool(self.search_keyword)
        self.search_replace_mode = self.search_card.is_replace_mode()
        self.replace_once_pending_jump = False
        self.replace_once_pending_refilter_apply = False
        self.search_keyword = self.search_card.get_keyword()
        self.search_is_regex = self.search_card.is_regex_mode()

        self.search_match_indices = []
        self.search_current_match = -1
        self.search_next_anchor_index = None
        self.search_card.clear_match_info()

        if self.search_keyword and self.search_is_regex:
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

        if not self.search_keyword:
            if not had_keyword:
                return
            self.search_result = None
            self.search_match_indices = []
            self.search_card.clear_match_info()
            return

        row = self.table_widget.get_selected_row()
        selected_item = self.table_widget.get_item_at_row(row) if row >= 0 else None
        self.pending_selected_item_id = (
            selected_item.item_id if selected_item is not None else None
        )

        self.run_with_unsaved_guard(self.start_search)

    def start_search(self) -> None:
        if not self.search_keyword:
            self.search_result = None
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.clear_match_info()
            return

        project_id = self.get_project_id()
        request = {
            "project_id": project_id,
            "filters": self.filter_options.to_dict(),
            "keyword": self.search_keyword,
            "is_regex": self.search_is_regex,
            "search_dst_only": self.search_replace_mode,
        }

        def task() -> None:
            try:
                result = self.proofreading_api_client.search(request)
                self.search_done.emit(result)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.search_done.emit(None)

        threading.Thread(target=task, daemon=True).start()

    def on_search_done_ui(self, payload: object) -> None:
        if not isinstance(payload, ProofreadingSearchResult):
            self.search_result = None
            self.search_match_indices = []
            self.search_current_match = -1
            self.search_card.set_match_info(0, 0)
            return

        self.search_result = payload
        matched_ids = set(payload.matched_item_ids)
        self.search_match_indices = [
            index
            for index, item in enumerate(self.filtered_items)
            if item.item_id in matched_ids
        ]
        if not self.search_match_indices:
            self.search_current_match = -1
            self.search_card.set_match_info(0, 0)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().search_no_match,
                },
            )
            return

        self.search_current_match = 0
        self.jump_to_match()

    @staticmethod
    def compute_match_indices(
        items: list[ProofreadingItemView],
        *,
        keyword: str,
        is_regex: bool,
        match_dst_only: bool = False,
    ) -> list[int]:
        if not keyword:
            return []

        indices: list[int] = []

        if is_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return []

            for idx, item in enumerate(items):
                src = item.src
                dst = item.dst
                if match_dst_only:
                    if pattern.search(dst):
                        indices.append(idx)
                    continue
                if pattern.search(src) or pattern.search(dst):
                    indices.append(idx)
            return indices

        keyword_lower = keyword.lower()
        for idx, item in enumerate(items):
            src = item.src
            dst = item.dst
            if match_dst_only:
                if keyword_lower in dst.lower():
                    indices.append(idx)
                continue
            if keyword_lower in src.lower() or keyword_lower in dst.lower():
                indices.append(idx)
        return indices

    @staticmethod
    def pick_next_match_position(matches: list[int], anchor: int, strict: bool) -> int:
        """在匹配列表中定位“下一处”的位置索引。"""
        if not matches:
            return -1

        if strict:
            for pos, match_index in enumerate(matches):
                if match_index > anchor:
                    return pos
        else:
            for pos, match_index in enumerate(matches):
                if match_index >= anchor:
                    return pos
        return 0

    def restore_selected_item(self) -> None:
        if self.pending_selected_item_id is None:
            if self.search_match_indices:
                if self.search_current_match < 0 or self.search_current_match >= len(
                    self.search_match_indices
                ):
                    self.search_current_match = 0
                self.jump_to_match()

                # jump_to_match() 会负责定位与选中。
                return

            if not self.filtered_items:
                self.current_item = None
                self.current_row_index = -1
                self.edit_panel.clear()
                return

            # 默认行为：尽量保留当前条目，否则选中首行。
            target_index = self.find_filtered_item_index(self.selected_item_id)
            if target_index < 0:
                target_index = 0

            self.block_selection_change = True
            self.jump_to_row(target_index)
            self.block_selection_change = False
            self.apply_selection(self.filtered_items[target_index], target_index)
            return

        item_index = self.find_filtered_item_index(self.pending_selected_item_id)
        if item_index < 0:
            self.pending_selected_item_id = None
            if self.search_match_indices:
                self.search_current_match = 0
                self.jump_to_match()
            return

        if self.search_match_indices:
            if item_index in self.search_match_indices:
                self.search_current_match = self.search_match_indices.index(item_index)
                self.jump_to_match()
        else:
            self.jump_to_row(item_index)

        self.pending_selected_item_id = None

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

    def prepare_replace_context(self) -> bool:
        """同步替换上下文并构建 Replace 模式匹配集合。"""
        keyword = self.search_card.get_keyword()
        if not keyword:
            self.search_card.clear_match_info()
            return False

        is_regex = self.search_card.is_regex_mode()
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
                return False

        self.search_keyword = keyword
        self.search_is_regex = is_regex
        self.search_replace_mode = True

        self.search_match_indices = self.compute_match_indices(
            list(self.filtered_items),
            keyword=self.search_keyword,
            is_regex=self.search_is_regex,
            match_dst_only=True,
        )
        if not self.search_match_indices:
            self.search_current_match = -1
            self.search_card.set_match_info(0, 0)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().search_no_match,
                },
            )
            return False

        selected_item_index = self.get_selected_item_index()
        if selected_item_index in self.search_match_indices:
            self.search_current_match = self.search_match_indices.index(
                selected_item_index
            )
        elif self.search_current_match < 0 or self.search_current_match >= len(
            self.search_match_indices
        ):
            self.search_current_match = 0

        self.search_card.set_match_info(
            self.search_current_match + 1, len(self.search_match_indices)
        )
        return True

    @staticmethod
    def replace_once_in_text(
        *,
        text: str,
        keyword: str,
        replacement: str,
        is_regex: bool,
    ) -> tuple[str, int]:
        if is_regex:
            pattern = re.compile(keyword, re.IGNORECASE)
            return pattern.subn(replacement, text, count=1)

        if not keyword:
            return text, 0

        # 与命中规则保持一致：非正则也按不区分大小写的字面量匹配处理。
        pattern = re.compile(re.escape(keyword), re.IGNORECASE)
        return pattern.subn(lambda m: replacement, text, count=1)

    @staticmethod
    def text_matches_keyword(*, text: str, keyword: str, is_regex: bool) -> bool:
        if not keyword:
            return False
        if is_regex:
            try:
                pattern = re.compile(keyword, re.IGNORECASE)
            except re.error:
                return False
            return pattern.search(text) is not None
        return keyword.lower() in text.lower()

    def should_refilter_before_replace(self, *, keyword: str, is_regex: bool) -> bool:
        if self.search_refilter_deferred:
            return False
        if self.search_keyword != keyword:
            return True
        if self.search_is_regex != is_regex:
            return True
        if not self.search_replace_mode:
            return True
        return False

    def on_replace_once_clicked(self) -> None:
        if self.is_readonly:
            return

        def action() -> None:
            if self.replace_once_pending_jump:
                self.replace_once_pending_jump = False
                if not self.prepare_replace_context():
                    return
                if self.search_current_match < 0 or self.search_current_match >= len(
                    self.search_match_indices
                ):
                    self.search_current_match = 0
                self.jump_to_match()
                return

            keyword = self.search_card.get_keyword()
            is_regex = self.search_card.is_regex_mode()
            if keyword and self.should_refilter_before_replace(
                keyword=keyword,
                is_regex=is_regex,
            ):
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

                # 首次直接点击 Replace 时，先按当前关键字刷新列表范围，再执行替换。
                self.replace_once_pending_refilter_apply = True
                self.search_keyword = keyword
                self.search_is_regex = is_regex
                self.search_replace_mode = True
                self.search_next_anchor_index = None
                self.pending_selected_item_id = None
                self.apply_filter(False)
                return

            if not self.prepare_replace_context():
                return

            if self.search_current_match < 0 or self.search_current_match >= len(
                self.search_match_indices
            ):
                self.search_current_match = 0

            item_index = self.search_match_indices[self.search_current_match]
            if item_index < 0 or item_index >= len(self.filtered_items):
                return

            target_item = self.filtered_items[item_index]
            replace_text = self.search_card.get_replace_text()
            new_dst, replaced_count = self.replace_once_in_text(
                text=target_item.dst,
                keyword=self.search_keyword,
                replacement=replace_text,
                is_regex=self.search_is_regex,
            )
            if replaced_count <= 0:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )
                return

            # 若当前条仍命中，则指向其后一个命中；若已不命中，则指向当前位置后的可见项。
            self.search_next_anchor_index = item_index
            self.search_next_anchor_strict = self.text_matches_keyword(
                text=new_dst,
                keyword=self.search_keyword,
                is_regex=self.search_is_regex,
            )
            self.replace_once_last_item_index = item_index
            self.replace_once_keep_match = self.search_next_anchor_strict
            self.pending_action = self.on_replace_once_saved
            self.pending_revert = None
            self.on_edit_save_requested(target_item, new_dst)

        self.run_with_unsaved_guard(action)

    def on_replace_once_saved(self) -> None:
        # Replace 之后保持当前列表，等用户下次显式搜索再重筛。
        self.search_refilter_deferred = True

        last_index = self.replace_once_last_item_index
        keep_match = self.replace_once_keep_match
        self.replace_once_last_item_index = None
        self.replace_once_keep_match = False
        self.search_next_anchor_index = None

        # 方案 A：保存成功后在当前命中集合内推进。
        if last_index is None or not self.search_match_indices:
            self.replace_once_pending_jump = False
            self.search_current_match = -1
            self.search_card.set_match_info(0, 0)
            return

        try:
            pos = self.search_match_indices.index(last_index)
        except ValueError:
            pos = self.search_current_match

        if keep_match:
            self.search_current_match = (max(pos, 0) + 1) % len(
                self.search_match_indices
            )
        else:
            if 0 <= pos < len(self.search_match_indices):
                self.search_match_indices.pop(pos)

            if not self.search_match_indices:
                self.replace_once_pending_jump = False
                self.search_current_match = -1
                self.search_card.set_match_info(0, 0)
                return

            if pos >= len(self.search_match_indices):
                pos = 0
            self.search_current_match = max(pos, 0)

        self.search_card.set_match_info(
            self.search_current_match + 1, len(self.search_match_indices)
        )
        # 单步替换后先停留在当前条目；下一次点击再显式跳到下一个目标。
        self.replace_once_pending_jump = True

    def on_replace_all_clicked(self) -> None:
        if self.is_readonly:
            return
        self.replace_once_pending_jump = False
        self.replace_once_pending_refilter_apply = False
        if not self.prepare_replace_context():
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().proofreading_page_replace_all_confirm,
            self.main_window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        def action() -> None:
            if not self.prepare_replace_context():
                return

            # 基础范围是 filtered_items；这里进一步收窄为当前命中集合。
            target_indices = list(self.search_match_indices)
            if not target_indices:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )
                return

            target_items = [
                self.filtered_items[index]
                for index in target_indices
                if 0 <= index < len(self.filtered_items)
            ]
            if not target_items:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().search_no_match,
                    },
                )
                return

            keyword = self.search_keyword
            replacement = self.search_card.get_replace_text()
            is_regex = self.search_is_regex
            self.indeterminate_show(
                Localizer.get().proofreading_page_indeterminate_saving
            )

            def task() -> None:
                try:
                    result = self.proofreading_api_client.replace_all(
                        {
                            "project_id": self.get_project_id(),
                            "items": self.build_item_payloads(target_items),
                            "search_text": keyword,
                            "replace_text": replacement,
                            "is_regex": is_regex,
                            "expected_revision": self.current_snapshot.revision,
                        }
                    )
                    self.replace_all_done.emit(result)
                except Exception as e:
                    LogManager.get().error(Localizer.get().task_failed, e)
                    self.replace_all_done.emit(None)

            threading.Thread(target=task, daemon=True).start()

        self.run_with_unsaved_guard(action)

    def on_replace_all_done_ui(self, result: object) -> None:
        self.indeterminate_hide()
        if not isinstance(result, ProofreadingMutationResult):
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().proofreading_page_save_failed,
                },
            )
            return

        changed_count = len(result.changed_item_ids)
        if changed_count <= 0:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().proofreading_page_replace_no_change,
                },
            )
            return

        self.apply_mutation_result(
            result,
            preferred_item_id=self.selected_item_id,
        )
        # Replace 路径下延后列表重筛，仅刷新状态。
        self.search_refilter_deferred = True

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_replace_done.replace(
                    "{N}", str(changed_count)
                ),
            },
        )

        self.search_next_anchor_index = None
        self.search_next_anchor_strict = True

    def get_selected_item_index(self) -> int:
        row = self.table_widget.get_selected_row()
        if row < 0:
            return -1

        item = self.table_widget.get_item_at_row(row)
        if item is None:
            return -1
        if item not in self.filtered_items:
            return -1

        return self.filtered_items.index(item)

    def jump_to_row(self, row: int) -> None:
        """跳转到指定行：选中并居中滚动。"""

        if row < 0:
            return

        index = self.table_widget.table_model.index(row, self.table_widget.COL_SRC)
        if not index.isValid():
            return

        self.table_widget.selectRow(row)
        self.table_widget.scrollTo(index, QAbstractItemView.ScrollHint.PositionAtCenter)

    def jump_to_match(self) -> None:
        """跳转到当前匹配项"""
        if not self.search_match_indices or self.search_current_match < 0:
            return

        # 更新匹配信息显示
        total = len(self.search_match_indices)
        current = self.search_current_match + 1  # 显示时从 1 开始
        self.search_card.set_match_info(current, total)

        item_index = self.search_match_indices[self.search_current_match]

        # 分页已移除：先确保目标行可见，再执行选中与居中滚动。
        self.jump_to_row(item_index)

    def on_table_selection_changed(self) -> None:
        if self.block_selection_change:
            return

        row = self.table_widget.get_selected_row()
        # 用户主动改选条目后，Replace 单击应立刻执行替换，不应沿用上一次的“仅跳转”状态。
        self.replace_once_pending_jump = False
        if row < 0:
            self.current_item = None
            self.current_row_index = -1
            self.selected_item_id = None
            self.edit_panel.clear()
            return

        item = self.table_widget.get_item_at_row(row)
        if not item:
            return

        def action() -> None:
            self.apply_selection(item, row)

        def revert() -> None:
            if self.current_row_index < 0:
                return
            self.block_selection_change = True
            self.table_widget.selectRow(self.current_row_index)
            self.block_selection_change = False

        self.run_with_unsaved_guard(action, revert)

    def apply_selection(self, item: ProofreadingItemView, row: int) -> None:
        self.current_item = item
        self.current_row_index = row
        self.selected_item_id = item.item_id
        index = row + 1
        self.edit_panel.bind_item(item, index, item.warnings)
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

    def on_edit_save_requested(
        self,
        item: ProofreadingItemView,
        new_dst: str,
    ) -> None:
        if self.is_readonly:
            return

        if new_dst == item.dst:
            self.edit_panel.apply_saved_state()
            if self.pending_action:
                action = self.pending_action
                self.pending_action = None
                self.pending_revert = None
                action()
            return

        def task() -> None:
            success = False
            result: ProofreadingMutationResult | None = None
            try:
                result = self.proofreading_api_client.save_item(
                    {
                        "project_id": self.get_project_id(),
                        "item": self.build_item_payload(item),
                        "new_dst": new_dst,
                        "expected_revision": self.current_snapshot.revision,
                    }
                )
                success = True
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)

            self.item_saved.emit(result, success)

        threading.Thread(target=task, daemon=True).start()

    def on_item_saved_ui(self, result: object, success: bool) -> None:
        if not success or not isinstance(result, ProofreadingMutationResult):
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

        preferred_item_id = self.current_item.item_id if self.current_item else None
        self.apply_mutation_result(result, preferred_item_id=preferred_item_id)

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

    def start_recheck_item(self, item: ProofreadingItemView) -> None:
        def task() -> None:
            try:
                result = self.proofreading_api_client.recheck_item(
                    {
                        "project_id": self.get_project_id(),
                        "item": self.build_item_payload(item),
                    }
                )
                self.item_rechecked.emit(result, True)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.item_rechecked.emit(None, False)

        threading.Thread(target=task, daemon=True).start()

    def on_item_rechecked_ui(self, result: object, success: bool) -> None:
        if not success or not isinstance(result, ProofreadingMutationResult):
            return

        preferred_item_id = self.current_item.item_id if self.current_item else None
        self.apply_mutation_result(result, preferred_item_id=preferred_item_id)

    def on_copy_src_clicked(self, item: ProofreadingItemView) -> None:
        """复制原文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            clipboard.setText(item.src)

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().proofreading_page_copy_src_done,
            },
        )

    def on_copy_dst_clicked(self, item: ProofreadingItemView) -> None:
        """复制译文到剪贴板"""
        clipboard = QApplication.clipboard()
        if clipboard:
            text = item.dst
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
    def on_reset_translation_clicked(self, item: ProofreadingItemView) -> None:
        """重置当前条目的译文与状态。"""

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

        self.run_with_unsaved_guard(lambda: self.do_batch_reset_translation([item]))

    def on_batch_reset_translation_clicked(
        self, items: list[ProofreadingItemView]
    ) -> None:
        """重置当前选中条目的译文与状态。"""

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

        self.run_with_unsaved_guard(lambda: self.do_batch_reset_translation(items))

    def do_batch_reset_translation(self, items: list[ProofreadingItemView]) -> None:
        """通过 API 批量重置当前条目。"""

        if not items:
            return

        self.indeterminate_show(Localizer.get().translation_page_toast_resetting)

        def task() -> None:
            try:
                result = self.proofreading_api_client.save_all(
                    {
                        "project_id": self.get_project_id(),
                        "items": self.build_item_payloads(
                            items,
                            dst_override="",
                            status_override=Base.ProjectStatus.NONE,
                        ),
                        "expected_revision": self.current_snapshot.revision,
                    }
                )
                self.translate_done.emit(result, len(items))
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.translate_done.emit(None, 0)

        threading.Thread(target=task, daemon=True).start()

    # ========== 重新翻译功能 ==========
    def on_retranslate_clicked(self, item: ProofreadingItemView) -> None:
        """重新翻译按钮点击。"""

        if self.is_readonly:
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

        self.run_with_unsaved_guard(lambda: self.do_batch_retranslate([item]))

    def on_batch_retranslate_clicked(self, items: list[ProofreadingItemView]) -> None:
        """批量重新翻译按钮点击。"""

        if self.is_readonly or not items:
            return

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

        self.run_with_unsaved_guard(lambda: self.do_batch_retranslate(items))

    def do_batch_retranslate(self, items: list[ProofreadingItemView]) -> None:
        """通过 API 统一处理单条/批量重译。"""

        if not items:
            return

        self.indeterminate_show(Localizer.get().proofreading_page_indeterminate_loading)

        def task() -> None:
            try:
                result = self.proofreading_api_client.retranslate_items(
                    {
                        "project_id": self.get_project_id(),
                        "items": self.build_item_payloads(items),
                        "expected_revision": self.current_snapshot.revision,
                    }
                )
                self.translate_done.emit(result, len(items))
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.translate_done.emit(None, len(items))

        threading.Thread(target=task, daemon=True).start()

    def on_translate_done_ui(self, result: object, requested_count: int) -> None:
        """重译/重置完成后统一消费 mutation result。"""

        self.indeterminate_hide()
        if not isinstance(result, ProofreadingMutationResult):
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
            return

        changed_count = len(result.changed_item_ids)
        self.apply_mutation_result(
            result,
            preferred_item_id=self.selected_item_id,
        )

        if changed_count == requested_count and changed_count > 0:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get()
                    .task_batch_translation_success.replace(
                        "{SUCCESS}", str(changed_count)
                    )
                    .replace("{FAILED}", "0"),
                },
            )
            return

        if requested_count > 0:
            fail_count = max(requested_count - changed_count, 0)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get()
                    .task_batch_translation_success.replace(
                        "{SUCCESS}", str(changed_count)
                    )
                    .replace("{FAILED}", str(fail_count)),
                },
            )

    def on_progress_updated_ui(self, content: str, current: int, total: int) -> None:
        """进度更新的 UI 处理（主线程）"""
        self.progress_update(content, current, total)

    def on_progress_finished_ui(self) -> None:
        """进度完成的 UI 处理（主线程）"""
        self.indeterminate_hide()
        # 逐条刷新已在 on_translate_done_ui 中完成，无需再次刷新

    # ========== 只读模式控制 ==========
    def on_engine_status_changed(self, event: Base.Event, data: dict) -> None:
        """Engine 状态变更事件"""
        sub_event = data.get("sub_event")
        if event in (
            Base.Event.TRANSLATION_TASK,
            Base.Event.TRANSLATION_REQUEST_STOP,
            Base.Event.ANALYSIS_TASK,
            Base.Event.ANALYSIS_REQUEST_STOP,
        ) and sub_event in (
            Base.SubEvent.REQUEST,
            Base.SubEvent.RUN,
        ):
            # 翻译过程中数据会变化；翻译结束后需要自动同步。
            self.data_stale = True
            self.reload_pending = True
        if event in (
            Base.Event.TRANSLATION_TASK,
            Base.Event.ANALYSIS_TASK,
        ) and sub_event in (
            Base.SubEvent.DONE,
            Base.SubEvent.ERROR,
        ):
            # 翻译完成或失败都视为一次新的数据周期。
            self.mark_data_stale()

        self.check_engine_status()

    def check_engine_status(self) -> None:
        """检查并更新只读模式"""
        # 重置虽然不占用 API busy 标志，但后台会改写条目，需与翻译运行态一样锁定编辑。
        is_busy = self.is_task_busy() or self.is_resetting

        was_busy = self.is_readonly

        # 1. 如果处于翻译中/停止中，清空页面数据
        if is_busy and (self.current_snapshot.items or self.filtered_items):
            self.current_snapshot = ProofreadingSnapshot(
                revision=self.current_snapshot.revision,
                project_id=self.current_snapshot.project_id,
                readonly=True,
                summary=self.current_snapshot.summary,
                filters=self.filter_options,
                items=tuple(),
            )
            self.filtered_items = []
            self.data_stale = True
            self.reload_pending = True
            # 繁忙态清空选择态，避免 current_item 等指向旧对象造成 UI 同步错乱。
            self.pending_selected_item_id = None
            self.selected_item_id = None
            self.current_item = None
            self.current_row_index = -1
            # 使在途的加载线程结果自动失效，避免翻译中被旧数据覆盖。
            self.loading_token = 0
            self.is_loading = False
            self.table_widget.set_items([])
            self.edit_panel.clear()

        # 禁用态不保留搜索状态：若当前在搜索栏，直接回到主动作条。
        if is_busy:
            self.reset_search_state()

        # 2. 翻译结束后自动同步一次
        if was_busy and (not is_busy) and self.data_stale:
            self.schedule_reload("engine_idle")

        # 2. 更新按钮状态
        has_items = bool(self.filtered_items)

        # 其他按钮只有在不繁忙且有数据时启用
        can_operate_review = not is_busy and has_items
        self.btn_search.setEnabled(can_operate_review)
        self.btn_replace.setEnabled(can_operate_review)
        self.btn_filter.setEnabled(can_operate_review)

        if is_busy != self.is_readonly:
            self.is_readonly = is_busy
            self.table_widget.set_readonly(is_busy)
        # 无论是否选中条目都需要同步（空态也应只读 + 禁用写入口）。
        self.edit_panel.set_readonly(self.is_readonly)

    def showEvent(self, a0: QShowEvent) -> None:
        """页面显示时自动刷新状态，确保与全局翻译任务同步"""
        super().showEvent(a0)
        self.reload_invalidated_snapshot_if_needed()
        self.check_engine_status()
        if self.data_stale:
            self.schedule_reload("show")
        elif self.pending_lookup_request is not None:
            self.apply_pending_lookup_if_ready()
        if self.pending_quality_rule_refresh and self.current_snapshot.items:
            self.pending_quality_rule_refresh = False
            self.schedule_quality_rule_refresh()

    # ========== Loading 指示器 ==========
    def indeterminate_show(self, msg: str) -> None:
        """显示 loading 指示器（不定进度）"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": msg,
                "indeterminate": True,
            },
        )

    def progress_show(self, msg: str, current: int = 0, total: int = 0) -> None:
        """显示确定进度指示器"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": msg,
                "indeterminate": False,
                "current": current,
                "total": total,
            },
        )

    def progress_update(self, msg: str, current: int, total: int) -> None:
        """更新进度"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "message": msg,
                "current": current,
                "total": total,
            },
        )

    def indeterminate_hide(self) -> None:
        """隐藏 loading 指示器"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {"sub_event": Base.SubEvent.DONE},
        )

    def on_translation_reset(self, event: Base.Event, data: dict) -> None:
        """响应翻译重置事件"""
        del event
        sub_event: Base.SubEvent = data["sub_event"]
        terminal_sub_events = (
            Base.SubEvent.DONE,
            Base.SubEvent.ERROR,
        )

        if sub_event == Base.SubEvent.RUN:
            self.is_resetting = True
        elif sub_event in terminal_sub_events:
            self.is_resetting = False
        else:
            return

        # 重置执行中后台会改写条目；开始态先锁定，终态再解锁并重载。
        self.clear_all_data()
        self.mark_data_stale()
        self.check_engine_status()
        if sub_event in terminal_sub_events:
            self.schedule_reload("translation_reset")

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        """工程加载后自动同步数据"""
        del event
        del data
        self.clear_all_data()
        self.mark_data_stale()
        self.schedule_reload("project_loaded")

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后清理数据"""
        del event
        del data
        self.clear_all_data()

    def clear_all_data(self) -> None:
        """彻底清理页面所有数据和 UI 状态"""
        # 清空数据
        self.current_snapshot = ProofreadingSnapshot()
        self.filtered_items = []
        self.search_result = None
        self.filter_options = ProofreadingFilterOptionsSnapshot()
        self.current_item = None
        self.current_row_index = -1
        self.selected_item_id = None
        self.pending_selected_item_id = None
        self.data_stale = True
        self.reload_pending = False
        self.is_loading = False
        self.loading_token = 0
        self.data_version = 0

        # 禁用态不保留搜索状态。
        self.reset_search_state()

        # 重置表格
        self.table_widget.set_items([])
        self.edit_panel.clear()

        # 释放筛选对话框持有的工程快照（对话框实例本身仍复用）。
        if self.filter_dialog is not None:
            if self.filter_dialog.isVisible():
                self.filter_dialog.close()
            self.filter_dialog.release_snapshot()

        # 重置按钮状态
        self.btn_search.setEnabled(False)
        self.btn_replace.setEnabled(False)
        self.btn_filter.setEnabled(False)

        # 隐藏 loading
        self.indeterminate_hide()
