import threading
from pathlib import Path
from typing import Any

from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtCore import QTimer
from PySide6.QtGui import QColor
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QFileDialog
from PySide6.QtWidgets import QFrame
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CaptionLabel
from qfluentwidgets import MessageBox
from qfluentwidgets import ScrollArea
from qfluentwidgets import SimpleCardWidget
from qfluentwidgets import StrongBodyLabel

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Workbench.WorkbenchTableWidget import WorkbenchTableWidget
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Data.DataManager import WorkbenchSnapshot
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Utils.GapTool import GapTool
from widget.CommandBarCard import CommandBarCard


class StatCard(SimpleCardWidget):
    CARD_HEIGHT: int = 140

    def __init__(
        self,
        title: str,
        unit: str,
        *,
        accent_color: str | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)

        self.title_label = CaptionLabel(title, self)
        self.value_label = StrongBodyLabel("0", self)
        self.unit_label = CaptionLabel(unit, self)

        self.title_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.value_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.unit_label.setAlignment(Qt.AlignmentFlag.AlignLeft)

        # 数字更醒目一些
        font = self.value_label.font()
        font.setPointSize(32)
        self.value_label.setFont(font)

        if isinstance(accent_color, str) and accent_color:
            # 用 setTextColor 才能在主题切换后保持自定义颜色不被覆盖。
            accent = QColor(accent_color)
            if accent.isValid():
                self.value_label.setTextColor(accent, accent)

        # unit 文字在亮/暗主题下用不同透明度的灰，且需要随主题切换自动刷新。
        self.unit_label.setTextColor(
            QColor(0, 0, 0, 115),
            QColor(255, 255, 255, 140),
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(6)
        layout.addWidget(self.title_label)
        layout.addWidget(self.value_label)
        layout.addStretch()
        layout.addWidget(self.unit_label)

        self.setFixedHeight(self.CARD_HEIGHT)

    def set_value(self, value: int) -> None:
        self.value_label.setText(f"{value:,}")


class WorkbenchPage(Base, ScrollArea):
    """工作台页面（文件管理）"""

    FONT_SIZE: int = 12
    ICON_SIZE: int = 16
    TRANSLATION_REFRESH_THROTTLE_MS: int = 500

    def __init__(self, object_name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName(object_name)
        self.setWidgetResizable(True)
        self.enableTransparentBackground()
        self.file_entries: list[dict[str, Any]] = []
        # 刷新后希望聚焦/保持选中的文件（例如“更新文件”重命名后）。
        self.pending_focus_rel_path: str | None = None

        self.table_widget: WorkbenchTableWidget | None = None
        self.command_bar_card: CommandBarCard | None = None
        self.btn_add_file = None
        self.btn_export_translation = None

        # 文件列表的聚合计算可能很重（大量 items 时），统一放到后台线程做。
        self.refresh_lock = threading.Lock()
        self.refresh_cond = threading.Condition(self.refresh_lock)
        self.refresh_running: bool = False
        self.refresh_pending: bool = False

        self.container = QWidget(self)
        self.container.setStyleSheet("background: transparent;")
        self.setWidget(self.container)

        self.main_layout = QVBoxLayout(self.container)
        self.main_layout.setContentsMargins(24, 24, 24, 24)
        self.main_layout.setSpacing(8)

        self.build_stats_section()
        self.build_file_list_section()
        self.build_footer_section()

        self.busy_timer = QTimer(self)
        self.busy_timer.timeout.connect(self.update_controls_enabled)
        self.busy_timer.start(500)

        # 翻译进度更新可能很高频：用节流合并刷新请求，避免后台线程高频重算快照。
        self.translation_refresh_timer = QTimer(self)
        self.translation_refresh_timer.setSingleShot(True)
        self.translation_refresh_timer.timeout.connect(self.on_translation_refresh_timeout)

        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)
        self.subscribe(Base.Event.PROJECT_FILE_UPDATE, self.on_project_file_update)
        self.subscribe(Base.Event.WORKBENCH_REFRESH, self.on_workbench_refresh)
        self.subscribe(Base.Event.WORKBENCH_SNAPSHOT, self.on_workbench_snapshot)
        self.subscribe(Base.Event.TRANSLATION_PROGRESS, self.on_translation_update)

        self.refresh_all()

    def on_translation_update(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        # 仅页面可见时刷新：隐藏页不做无意义的聚合计算。
        if not self.isVisible():
            return
        if not DataManager.get().is_loaded():
            return

        # 500ms throttle（而不是 debounce）：持续有进度更新时，也能按固定节奏刷新统计。
        if self.translation_refresh_timer.isActive():
            return
        self.translation_refresh_timer.start(self.TRANSLATION_REFRESH_THROTTLE_MS)

    def on_translation_refresh_timeout(self) -> None:
        # timeout 触发时再做一次保护：避免用户刚切走页面仍触发后台重算。
        if not self.isVisible():
            return
        if not DataManager.get().is_loaded():
            return
        self.request_refresh()

    def build_stats_section(self) -> None:
        stats_frame = QFrame(self.container)
        stats_layout = QHBoxLayout(stats_frame)
        stats_layout.setContentsMargins(0, 0, 0, 0)
        stats_layout.setSpacing(12)

        unit_file = Localizer.get().workbench_unit_file
        unit_line = Localizer.get().workbench_unit_line

        self.card_file_count = StatCard(
            Localizer.get().workbench_stat_file_count,
            unit_file,
        )
        self.card_total_items = StatCard(
            Localizer.get().workbench_stat_total_lines,
            unit_line,
        )
        self.card_translated = StatCard(
            Localizer.get().workbench_stat_translated,
            unit_line,
            accent_color="#22c55e",
        )
        self.card_untranslated = StatCard(
            Localizer.get().workbench_stat_untranslated,
            unit_line,
            accent_color="#f59e0b",
        )

        for card in (
            self.card_file_count,
            self.card_total_items,
            self.card_translated,
            self.card_untranslated,
        ):
            stats_layout.addWidget(card)

        self.main_layout.addWidget(stats_frame)

    def build_file_list_section(self) -> None:
        self.table_widget = WorkbenchTableWidget(self.container)
        self.table_widget.update_clicked.connect(self.on_update_file)
        self.table_widget.reset_clicked.connect(self.on_reset_file)
        self.table_widget.delete_clicked.connect(self.on_delete_file)
        self.table_widget.itemSelectionChanged.connect(self.update_controls_enabled)
        self.main_layout.addWidget(self.table_widget, 1)

    def build_footer_section(self) -> None:
        self.command_bar_card = CommandBarCard()
        self.main_layout.addWidget(self.command_bar_card)

        base_font = QFont(self.command_bar_card.command_bar.font())
        base_font.setPixelSize(self.FONT_SIZE)
        self.command_bar_card.command_bar.setFont(base_font)
        self.command_bar_card.command_bar.setIconSize(QSize(self.ICON_SIZE, self.ICON_SIZE))
        self.command_bar_card.set_minimum_width(640)

        self.btn_add_file = self.command_bar_card.add_action(
            Action(
                BaseIcon.FILE_PLUS,
                Localizer.get().workbench_btn_add_file,
                triggered=self.on_add_file_clicked,
            )
        )

        self.command_bar_card.add_separator()
        self.btn_export_translation = self.command_bar_card.add_action(
            Action(
                BaseIcon.FILE_INPUT,
                Localizer.get().export_translation,
                triggered=self.on_export_translation_clicked,
            )
        )

    def is_engine_busy(self) -> bool:
        return Engine.get().get_status() != Base.TaskStatus.IDLE or Engine.get().get_running_task_count() > 0

    def update_controls_enabled(self) -> None:
        loaded = DataManager.get().is_loaded()
        busy = self.is_engine_busy()
        file_op_running = DataManager.get().is_file_op_running()
        readonly = (not loaded) or busy or file_op_running

        if self.btn_add_file is not None:
            self.btn_add_file.setEnabled(not readonly)

        # 生成译文不依赖“引擎空闲”，允许翻译过程中导出；但需要工程已加载且不处于文件操作中。
        if self.btn_export_translation is not None:
            self.btn_export_translation.setEnabled(loaded and (not file_op_running))

        if self.table_widget is not None:
            self.table_widget.set_readonly(readonly)

    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.refresh_all()

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.refresh_all()

    def on_project_file_update(self, event: Base.Event, data: dict) -> None:
        del event
        rel_path = data.get("rel_path")
        if isinstance(rel_path, str) and rel_path:
            # 后台更新完成后刷新列表，并尽量将焦点保持在更新后的文件上。
            self.pending_focus_rel_path = rel_path
        self.refresh_all()

    def on_workbench_refresh(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        self.refresh_all()

    def on_workbench_snapshot(self, event: Base.Event, data: dict) -> None:
        del event
        snapshot = data.get("snapshot")
        if not isinstance(snapshot, WorkbenchSnapshot):
            return
        self.apply_snapshot(snapshot)

    def refresh_all(self) -> None:
        self.request_refresh()

    def request_refresh(self) -> None:
        start_worker = False
        with self.refresh_cond:
            self.refresh_pending = True
            if self.refresh_running:
                self.refresh_cond.notify_all()
                return

            self.refresh_running = True
            start_worker = True

        if not start_worker:
            return

        threading.Thread(target=self.refresh_worker, daemon=True).start()

    def refresh_worker(self) -> None:
        while True:
            with self.refresh_cond:
                if not self.refresh_pending:
                    self.refresh_running = False
                    return
                self.refresh_pending = False

            snapshot = DataManager.get().build_workbench_snapshot()
            self.emit(Base.Event.WORKBENCH_SNAPSHOT, {"snapshot": snapshot})

    def apply_snapshot(self, snapshot: WorkbenchSnapshot) -> None:
        selected_rel_path = self.table_widget.get_selected_rel_path() if self.table_widget else ""

        self.card_file_count.set_value(snapshot.file_count)
        self.card_total_items.set_value(snapshot.total_items)
        self.card_translated.set_value(snapshot.translated)
        self.card_untranslated.set_value(snapshot.untranslated)

        entries: list[dict[str, Any]] = []
        for entry in GapTool.iter(snapshot.entries):
            fmt = self.get_format_label(entry.file_type, entry.rel_path)
            entries.append(
                {
                    "rel_path": entry.rel_path,
                    "format": fmt,
                    "item_count": entry.item_count,
                }
            )

        self.file_entries = entries
        if self.table_widget is not None:
            self.table_widget.set_entries(entries)

            focus_rel_path = self.pending_focus_rel_path or selected_rel_path
            self.pending_focus_rel_path = None
            if focus_rel_path:
                for row, entry in enumerate(entries):
                    if entry.get("rel_path") == focus_rel_path:
                        self.table_widget.selectRow(row)
                        self.table_widget.scroll_to_row(row)
                        break
        self.update_controls_enabled()

    def get_format_label(self, file_type: Item.FileType | None, rel_path: str) -> str:
        if file_type == Item.FileType.MD:
            return Localizer.get().workbench_fmt_markdown
        if file_type == Item.FileType.RENPY:
            return Localizer.get().workbench_fmt_renpy
        if file_type == Item.FileType.KVJSON:
            return Localizer.get().workbench_fmt_mtool
        if file_type == Item.FileType.MESSAGEJSON:
            return Localizer.get().workbench_fmt_sextractor
        if file_type == Item.FileType.TRANS:
            return Localizer.get().workbench_fmt_trans_proj
        if file_type == Item.FileType.WOLFXLSX:
            return Localizer.get().workbench_fmt_wolf
        if file_type == Item.FileType.XLSX:
            # 这里不区分导出源，按大类展示。
            return Localizer.get().workbench_fmt_trans_export
        if file_type == Item.FileType.EPUB:
            return Localizer.get().workbench_fmt_ebook

        suffix = Path(rel_path).suffix.lower()
        if suffix in {".srt", ".ass"}:
            return Localizer.get().workbench_fmt_subtitle_file
        if suffix == ".txt":
            return Localizer.get().workbench_fmt_text_file

        fallback = Path(rel_path).suffix.lstrip(".")
        return fallback.upper() if fallback else "-"

    def on_add_file_clicked(self) -> None:
        if self.is_engine_busy():
            return

        exts = [f"*{ext}" for ext in sorted(DataManager.get().get_supported_extensions()) if isinstance(ext, str)]
        filter_str = f"{Localizer.get().supported_files} ({' '.join(exts)})"
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            Localizer.get().workbench_btn_add_file,
            "",
            filter_str,
        )
        if not file_path:
            return

        DataManager.get().schedule_add_file(file_path)

    def on_export_translation_clicked(self) -> None:
        if not DataManager.get().is_loaded():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().alert_project_not_loaded,
                },
            )
            return

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().export_translation_confirm,
            self,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        self.emit(Base.Event.TRANSLATION_EXPORT, {})

    def on_update_file(self, rel_path: str) -> None:
        if self.is_engine_busy():
            return

        exts = [f"*{ext}" for ext in sorted(DataManager.get().get_supported_extensions()) if isinstance(ext, str)]
        filter_str = f"{Localizer.get().supported_files} ({' '.join(exts)})"
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            Localizer.get().workbench_btn_update,
            "",
            filter_str,
        )
        if not file_path:
            return

        box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().workbench_msg_update_confirm,
            self,
        )
        box.yesButton.setText(Localizer.get().confirm)
        box.cancelButton.setText(Localizer.get().cancel)
        if not box.exec():
            return

        DataManager.get().schedule_update_file(rel_path, file_path)

    def on_reset_file(self, rel_path: str) -> None:
        if self.is_engine_busy():
            return

        box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().workbench_msg_reset_confirm,
            self,
        )
        box.yesButton.setText(Localizer.get().confirm)
        box.cancelButton.setText(Localizer.get().cancel)
        if not box.exec():
            return

        DataManager.get().schedule_reset_file(rel_path)

    def on_delete_file(self, rel_path: str) -> None:
        if self.is_engine_busy():
            return

        box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().workbench_msg_delete_confirm,
            self,
        )
        box.yesButton.setText(Localizer.get().confirm)
        box.cancelButton.setText(Localizer.get().cancel)
        if not box.exec():
            return

        DataManager.get().schedule_delete_file(rel_path)
