import threading
from typing import Any
from typing import cast

from api.Client.ExtraApiClient import ExtraApiClient
from PySide6.QtCore import QModelIndex
from PySide6.QtCore import QPoint
from PySide6.QtCore import Qt
from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHeaderView
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from model.Api.ExtraModels import NameFieldSnapshot
from model.Api.ExtraModels import NameFieldTranslateResult
from module.Localizer.Localizer import Localizer
from widget.AppTable.AppTableModelBase import AppTableModelBase
from widget.AppTable.AppTableView import AppTableView
from widget.AppTable.ColumnSpec import ColumnSpec
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard
from widget.SettingCard import SettingCard

# ==================== 图标常量 ====================

ICON_ROW_DELETE: BaseIcon = BaseIcon.TRASH_2  # 表格右键：删除选中行
ICON_ACTION_EXTRACT: BaseIcon = BaseIcon.FINGERPRINT_PATTERN  # 命令栏：提取姓名字段
ICON_ACTION_TRANSLATE: BaseIcon = BaseIcon.SCAN_TEXT  # 命令栏：翻译提取结果
ICON_ACTION_SEARCH: BaseIcon = BaseIcon.SEARCH  # 命令栏：搜索
ICON_ACTION_RESET: BaseIcon = BaseIcon.RECYCLE  # 命令栏：重置/清空
ICON_ACTION_IMPORT: BaseIcon = BaseIcon.FILE_DOWN  # 命令栏：导入


class NameFieldExtractionTableModel(AppTableModelBase[dict[str, Any]]):
    COL_SRC: int = 0
    COL_DST: int = 1

    def flags(self, index: QModelIndex) -> Qt.ItemFlags:  # noqa: N802
        flags = super().flags(index)
        if not index.isValid():
            return flags

        if index.column() != self.COL_DST:
            return flags

        row_object = self.row_object(index.row())
        if row_object is None:
            return flags

        src = str(row_object.get("src", "")).strip()
        if not src:
            flags = flags & ~Qt.ItemFlag.ItemIsEditable
        return cast(Qt.ItemFlags, flags)


class NameFieldExtractionPage(Base, QWidget):
    BASE: str = "name_field_extraction"

    # 定义信号用于跨线程更新 UI
    update_signal = Signal(int)
    progress_updated = Signal(str, int, int)  # 进度更新信号 (content, current, total)
    progress_finished = Signal()  # 进度完成信号
    extract_finished = Signal(object)
    extract_failed = Signal()
    translate_finished = Signal(object)
    translate_failed = Signal()
    save_finished = Signal(object)
    save_failed = Signal()

    def __init__(
        self,
        text: str,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None = None,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.extra_api_client = self.resolve_extra_api_client(window, extra_api_client)

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 数据存储
        # 结构: [{"src": str, "dst": str, "context": str, "status": str}]
        self.items: list[dict[str, Any]] = []

        # 添加控件
        self.add_widget_head(self.root)
        self.add_widget_body(self.root, window)
        self.add_widget_foot(self.root, window)

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_RESET_ALL, self.on_translation_reset)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

        # 连接信号
        self.update_signal.connect(self.update_row)
        self.progress_updated.connect(self.on_progress_updated)
        self.progress_finished.connect(self.on_progress_finished)
        self.extract_finished.connect(self.on_extract_finished)
        self.extract_failed.connect(self.on_extract_failed)
        self.translate_finished.connect(self.on_translate_finished)
        self.translate_failed.connect(self.on_translate_failed)
        self.save_finished.connect(self.on_save_finished)
        self.save_failed.connect(self.on_save_failed)

        self.is_extracting = False
        self.is_saving = False

    def resolve_extra_api_client(
        self,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None,
    ) -> ExtraApiClient | None:
        """优先使用显式注入，其次兼容窗口上下文，避免当前任务越界改 wiring。"""

        resolved_client = extra_api_client
        if resolved_client is None and window is not None:
            window_client = getattr(window, "extra_api_client", None)
            if isinstance(window_client, ExtraApiClient):
                resolved_client = window_client
            else:
                app_client_context = getattr(window, "app_client_context", None)
                context_client = getattr(app_client_context, "extra_api_client", None)
                if isinstance(context_client, ExtraApiClient):
                    resolved_client = context_client
        return resolved_client

    # 头部
    def add_widget_head(self, parent: QLayout) -> None:
        parent.addWidget(
            SettingCard(
                title=Localizer.get().name_field_extraction_page,
                description=Localizer.get().name_field_extraction_page_desc,
                parent=self,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, window: FluentWindow | None) -> None:
        del window

        def delete_row() -> None:
            row = self.table.get_current_source_row()
            if row >= 0 and row < len(self.items):
                del self.items[row]
                self.refresh_table()

        def custom_context_menu_requested(position: QPoint) -> None:
            menu = RoundMenu("", self.table)
            menu.addAction(
                Action(
                    ICON_ROW_DELETE,
                    Localizer.get().quality_delete_row,
                    triggered=delete_row,
                )
            )
            viewport = self.table.viewport()
            if viewport is None:
                return
            menu.exec(viewport.mapToGlobal(position))

        self.table = AppTableView(self)
        parent.addWidget(self.table)

        self.column_specs: list[ColumnSpec[dict[str, Any]]] = [
            ColumnSpec(
                header=Localizer.get().table_col_source,
                width_mode=ColumnSpec.WidthMode.FIXED,
                width=300,
                alignment=Qt.AlignmentFlag.AlignCenter,
                display_getter=lambda row: str(row.get("src", "")),
                tooltip_getter=lambda row: (
                    f"{Localizer.get().name_field_extraction_context}:\n{row.get('context', '')}"
                    if row.get("context")
                    else ""
                ),
            ),
            ColumnSpec(
                header=Localizer.get().table_col_translation,
                width_mode=ColumnSpec.WidthMode.FIXED,
                width=300,
                alignment=Qt.AlignmentFlag.AlignCenter,
                display_getter=lambda row: str(row.get("dst", "")),
                editable=True,
                set_value=self.on_dst_edited,
            ),
            ColumnSpec(
                header=Localizer.get().proofreading_page_col_status,
                width_mode=ColumnSpec.WidthMode.STRETCH,
                alignment=Qt.AlignmentFlag.AlignCenter,
                display_getter=lambda row: str(row.get("status", "")),
            ),
        ]

        self.table_model: NameFieldExtractionTableModel = NameFieldExtractionTableModel(
            self.table.ui_font,
            self.column_specs,
            parent=self,
        )
        self.table.setModel(self.table_model)
        self.table.apply_column_specs(self.column_specs)

        header = cast(QHeaderView, self.table.horizontalHeader())
        header.setStretchLastSection(True)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

        self.refresh_table()

    # 底部
    def add_widget_foot(self, parent: QLayout, window: FluentWindow | None) -> None:
        del window

        # 创建搜索栏
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        def back_clicked(widget: SearchCard) -> None:
            widget.reset_state()
            self.search_card.setVisible(False)
            self.command_bar_card.setVisible(True)

        self.search_card.on_back_clicked(back_clicked)

        def prev_clicked(widget: SearchCard) -> None:
            widget.run_table_search(reverse=True)

        def next_clicked(widget: SearchCard) -> None:
            widget.run_table_search(reverse=False)

        def search_options_changed(widget: SearchCard) -> None:
            widget.apply_table_search()

        self.search_card.on_prev_clicked(prev_clicked)
        self.search_card.on_next_clicked(next_clicked)
        self.search_card.on_search_triggered(next_clicked)
        self.search_card.on_search_options_changed(search_options_changed)

        def notify(level: str, message: str) -> None:
            type_map = {
                "error": Base.ToastType.ERROR,
                "warning": Base.ToastType.WARNING,
                "info": Base.ToastType.INFO,
            }
            self.show_toast(type_map.get(level, Base.ToastType.INFO), message)

        self.search_card.bind_view(self.table, self.get_search_columns(), notify)

        # 创建命令栏
        self.command_bar_card = CommandBarCard()
        self.command_bar_card.set_minimum_width(640)
        parent.addWidget(self.command_bar_card)

        self.search_card.set_base_font(self.command_bar_card.command_bar.font())

        # 添加命令栏操作
        self.add_command_bar_action_extract(self.command_bar_card)
        self.add_command_bar_action_translate(self.command_bar_card)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search(self.command_bar_card)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_reset(self.command_bar_card)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_import(self.command_bar_card)

    # 提取操作
    def add_command_bar_action_extract(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.extract_names()

        parent.add_action(
            Action(
                ICON_ACTION_EXTRACT,
                Localizer.get().name_field_extraction_action_extract,
                parent,
                triggered=triggered,
            ),
        )

    # 翻译操作
    def add_command_bar_action_translate(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.translate_names()

        parent.add_action(
            Action(
                ICON_ACTION_TRANSLATE,
                Localizer.get().name_field_extraction_action_translate,
                parent,
                triggered=triggered,
            ),
        )

    # 搜索操作
    def add_command_bar_action_search(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.search_card.setVisible(True)
            self.command_bar_card.setVisible(False)

        parent.add_action(
            Action(
                ICON_ACTION_SEARCH,
                Localizer.get().search,
                parent,
                triggered=triggered,
            ),
        )

    # 重置操作
    def add_command_bar_action_reset(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.reset_table()

        parent.add_action(
            Action(
                ICON_ACTION_RESET,
                Localizer.get().reset,
                parent,
                triggered=triggered,
            ),
        )

    # 导入到术语表
    def add_command_bar_action_import(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.save_to_glossary()

        parent.add_action(
            Action(
                ICON_ACTION_IMPORT,
                Localizer.get().name_field_extraction_action_import,
                parent,
                triggered=triggered,
            ),
        )

    # ================= 业务逻辑 =================

    def on_progress_updated(self, content: str, current: int, total: int) -> None:
        """进度更新的 UI 处理（主线程）"""
        self.update_progress_toast(content, current, total)

    def on_progress_finished(self) -> None:
        """进度完成的 UI 处理（主线程）"""
        self.hide_indeterminate_toast()

    def show_progress_toast(self, msg: str, current: int = 0, total: int = 0) -> None:
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

    def update_progress_toast(self, msg: str, current: int, total: int) -> None:
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

    def hide_indeterminate_toast(self) -> None:
        """隐藏 loading 指示器"""
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {"sub_event": Base.SubEvent.DONE},
        )

    def on_extract_finished(self, snapshot: object) -> None:
        self.hide_indeterminate_toast()
        self.is_extracting = False
        items = self.snapshot_to_rows(snapshot)

        if not items:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().alert_no_data)
            return

        self.items = items
        self.refresh_table()
        self.show_toast(Base.ToastType.SUCCESS, Localizer.get().task_success)

    def on_extract_failed(self) -> None:
        self.hide_indeterminate_toast()
        self.is_extracting = False
        self.show_task_failed_toast()

    def extract_names(self) -> None:
        """通过 Extra API 提取名字，避免页面继续直接扫描工程数据。"""
        if self.is_extracting:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().task_running)
            return

        client = self.extra_api_client
        if client is None:
            self.show_task_failed_toast()
            return

        self.is_extracting = True
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().name_field_extraction_action_progress,
                "indeterminate": True,
            },
        )

        def extract_task() -> None:
            try:
                snapshot = client.extract_name_fields()
                self.extract_finished.emit(snapshot)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.extract_failed.emit()

        threading.Thread(target=extract_task, daemon=True).start()

    def reset_table(self) -> None:
        """重置表格（清空列表）"""
        if not self.items:
            return

        title = Localizer.get().alert
        content = Localizer.get().alert_confirm_reset_data

        # 弹窗确认
        w = MessageBox(title, content, self.window())
        if w.exec():
            self.items = []
            self.refresh_table()
            self.show_toast(Base.ToastType.SUCCESS, Localizer.get().toast_reset)

    def refresh_table(self) -> None:
        """完全刷新表格显示"""
        self.table_model.set_rows(self.items)
        self.table.update_row_number_width(len(self.items))

    def emit_row_changed(self, row: int) -> None:
        if row < 0 or row >= len(self.items):
            return
        if self.table_model.columnCount() <= 0:
            return

        top_left = self.table_model.index(row, 0)
        bottom_right = self.table_model.index(row, self.table_model.columnCount() - 1)
        self.table_model.dataChanged.emit(
            top_left,
            bottom_right,
            [
                int(Qt.ItemDataRole.DisplayRole),
                int(Qt.ItemDataRole.ToolTipRole),
                int(Qt.ItemDataRole.DecorationRole),
            ],
        )

    def on_dst_edited(self, row_object: dict[str, Any], value: object) -> bool:
        src = str(row_object.get("src", "")).strip()
        if not src:
            return False

        new_val = str(value).strip() if value is not None else ""
        row_object["dst"] = new_val
        row_object["status"] = (
            Localizer.get().proofreading_page_status_processed
            if new_val
            else Localizer.get().proofreading_page_status_none
        )
        return True

    def translate_names(self) -> None:
        """通过 Extra API 翻译整表草稿，页面只负责展示与编辑态。"""

        indices_to_translate: list[int] = []
        for index, item in enumerate(self.items):
            if not item["dst"]:
                indices_to_translate.append(index)

        if not indices_to_translate:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().alert_no_data)
            return

        client = self.extra_api_client
        if client is None:
            self.show_task_failed_toast()
            return

        for index in indices_to_translate:
            self.items[index]["status"] = (
                Localizer.get().translation_page_status_translating
            )
            self.emit_row_changed(index)

        count = len(indices_to_translate)
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get()
                .task_batch_translation_progress.replace("{CURRENT}", "1")
                .replace("{TOTAL}", str(count)),
                "indeterminate": True,
            },
        )

        def batch_translate_task() -> None:
            try:
                result = client.translate_name_fields(self.serialize_items())
                self.translate_finished.emit(result)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.translate_failed.emit()

        threading.Thread(target=batch_translate_task, daemon=True).start()

    def update_row(self, row: int) -> None:
        """信号槽：更新指定行的 UI"""
        self.emit_row_changed(row)

    def save_to_glossary(self) -> None:
        """通过 Extra API 保存到术语表，页面不再直接写 glossary。"""

        if self.is_saving:
            self.show_toast(Base.ToastType.WARNING, Localizer.get().task_running)
            return

        client = self.extra_api_client
        if client is None:
            self.show_task_failed_toast()
            return

        items_snapshot = self.serialize_items()
        self.is_saving = True

        def save_task() -> None:
            try:
                snapshot = client.save_name_fields_to_glossary(items_snapshot)
                self.save_finished.emit(snapshot)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.save_failed.emit()

        threading.Thread(target=save_task, daemon=True).start()

    def on_translate_finished(self, result: object) -> None:
        self.hide_indeterminate_toast()
        translate_result = result
        if not isinstance(translate_result, NameFieldTranslateResult):
            translate_result = NameFieldTranslateResult()

        self.items = [item.to_dict() for item in translate_result.items]
        self.refresh_table()
        self.show_toast(
            Base.ToastType.SUCCESS
            if translate_result.failed_count == 0
            else Base.ToastType.WARNING,
            Localizer.get()
            .task_batch_translation_success.replace(
                "{SUCCESS}", str(translate_result.success_count)
            )
            .replace("{FAILED}", str(translate_result.failed_count)),
        )

    def on_translate_failed(self) -> None:
        self.hide_indeterminate_toast()
        self.show_task_failed_toast()

    def on_save_finished(self, snapshot: object) -> None:
        self.is_saving = False
        items = self.snapshot_to_rows(snapshot)
        if items:
            self.items = items
            self.refresh_table()
        self.show_toast(Base.ToastType.SUCCESS, Localizer.get().toast_save)

    def on_save_failed(self) -> None:
        self.is_saving = False
        self.show_task_failed_toast()

    def serialize_items(self) -> list[dict[str, str]]:
        """把当前表格草稿统一转换成 API 请求结构，避免命令入口散写字段。"""

        serialized_items: list[dict[str, str]] = []
        for item in self.items:
            serialized_items.append(
                {
                    "src": str(item.get("src", "")).strip(),
                    "dst": str(item.get("dst", "")).strip(),
                    "context": str(item.get("context", "")).strip(),
                    "status": str(item.get("status", "")).strip(),
                }
            )
        return serialized_items

    def snapshot_to_rows(self, snapshot: object) -> list[dict[str, str]]:
        """统一把快照对象恢复成表格行，避免多个结果入口各自转协议。"""

        normalized_snapshot = snapshot
        if not isinstance(normalized_snapshot, NameFieldSnapshot):
            normalized_snapshot = NameFieldSnapshot()
        return [item.to_dict() for item in normalized_snapshot.items]

    def get_search_columns(self) -> tuple[int, ...]:
        return (0, 1)

    def show_toast(self, type: Base.ToastType, message: str) -> None:
        self.emit(
            Base.Event.TOAST,
            {
                "type": type,
                "message": message,
            },
        )

    def show_task_failed_toast(self) -> None:
        """统一展示任务失败提示，避免多个失败分支散写同一条文案。"""

        self.show_toast(Base.ToastType.ERROR, Localizer.get().task_failed)

    def on_translation_reset(self, event: Base.Event, data: dict) -> None:
        """仅在全量重置终态清理页面，避免请求态触发无效抖动。"""
        sub_event: Base.SubEvent = data["sub_event"]
        if sub_event not in (
            Base.SubEvent.DONE,
            Base.SubEvent.ERROR,
        ):
            return
        self.on_project_unloaded(event, data)

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后清理数据"""
        self.items = []
        self.is_saving = False
        self.refresh_table()

        # 重置搜索栏
        self.search_card.reset_state()
        self.search_card.setVisible(False)
        self.command_bar_card.setVisible(True)
