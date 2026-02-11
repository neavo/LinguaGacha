import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QFrame
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CaptionLabel
from qfluentwidgets import MessageBox
from qfluentwidgets import ScrollArea
from qfluentwidgets import SimpleCardWidget
from qfluentwidgets import StrongBodyLabel

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from frontend.Workbench.WorkbenchTableWidget import WorkbenchTableWidget
from model.Item import Item
from module.Data.DataManager import DataManager
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


class WorkbenchPage(ScrollArea, Base):
    """工作台页面（文件管理）"""

    FONT_SIZE: int = 12
    ICON_SIZE: int = 16
    TABLE_MIN_ROWS: int = 30

    def __init__(self, object_name: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName(object_name)
        self.setWidgetResizable(True)
        self.enableTransparentBackground()
        self.file_entries: list[dict[str, Any]] = []

        self.table_widget: WorkbenchTableWidget | None = None
        self.command_bar_card: CommandBarCard | None = None
        self.btn_add_file = None

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

        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)
        self.subscribe(Base.Event.PROJECT_FILE_UPDATE, self.on_project_file_update)

        self.refresh_all()

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
            Localizer.get().workbench_stat_total_items,
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
        self.main_layout.addWidget(self.table_widget, 1)

    def build_footer_section(self) -> None:
        self.command_bar_card = CommandBarCard()
        self.main_layout.addWidget(self.command_bar_card)

        base_font = QFont(self.command_bar_card.command_bar.font())
        base_font.setPixelSize(self.FONT_SIZE)
        self.command_bar_card.command_bar.setFont(base_font)
        self.command_bar_card.command_bar.setIconSize(
            QSize(self.ICON_SIZE, self.ICON_SIZE)
        )
        self.command_bar_card.set_minimum_width(640)

        self.btn_add_file = self.command_bar_card.add_action(
            Action(
                BaseIcon.FILE_PLUS,
                Localizer.get().workbench_btn_add_file,
                triggered=self.on_add_file_clicked,
            )
        )

    def is_engine_busy(self) -> bool:
        return (
            Engine.get().get_status() != Base.TaskStatus.IDLE
            or Engine.get().get_running_task_count() > 0
        )

    def update_controls_enabled(self) -> None:
        loaded = DataManager.get().is_loaded()
        busy = self.is_engine_busy()
        readonly = (not loaded) or busy

        if self.btn_add_file is not None:
            self.btn_add_file.setEnabled(not readonly)

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
        del data
        self.refresh_all()

    def refresh_all(self) -> None:
        dm = DataManager.get()

        asset_paths = dm.get_all_asset_paths()
        items = dm.get_all_items()

        file_count = len(asset_paths)
        total_items = len(items)

        translated = 0
        for item in GapTool.iter(items):
            if item.get_status() in (
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.PROCESSED_IN_PAST,
            ):
                translated += 1
        untranslated = max(0, total_items - translated)

        self.card_file_count.set_value(file_count)
        self.card_total_items.set_value(total_items)
        self.card_translated.set_value(translated)
        self.card_untranslated.set_value(untranslated)

        count_by_path: dict[str, int] = defaultdict(int)
        file_type_by_path: dict[str, Item.FileType] = {}
        for item in GapTool.iter(items):
            count_by_path[item.get_file_path()] += 1
            path = item.get_file_path()
            if path and path not in file_type_by_path:
                file_type = item.get_file_type()
                if file_type != Item.FileType.NONE:
                    file_type_by_path[path] = file_type

        entries: list[dict[str, Any]] = []
        for rel_path in GapTool.iter(asset_paths):
            fmt = self.get_format_label(file_type_by_path.get(rel_path), rel_path)
            entries.append(
                {
                    "rel_path": rel_path,
                    "format": fmt,
                    "item_count": count_by_path.get(rel_path, 0),
                }
            )

        self.file_entries = entries

        if self.table_widget is not None:
            self.table_widget.set_entries(entries, fixed_rows=self.TABLE_MIN_ROWS)
        self.update_controls_enabled()

    def get_format_label(self, file_type: Item.FileType | None, rel_path: str) -> str:
        if file_type == Item.FileType.MD:
            return Localizer.get().project_fmt_markdown
        if file_type == Item.FileType.RENPY:
            return Localizer.get().project_fmt_renpy
        if file_type == Item.FileType.KVJSON:
            return Localizer.get().project_fmt_mtool
        if file_type == Item.FileType.MESSAGEJSON:
            return Localizer.get().project_fmt_sextractor
        if file_type == Item.FileType.TRANS:
            return Localizer.get().project_fmt_trans_proj
        if file_type == Item.FileType.WOLFXLSX:
            return Localizer.get().project_fmt_wolf
        if file_type == Item.FileType.XLSX:
            # 这里不区分导出源，按大类展示。
            return Localizer.get().project_fmt_trans_export
        if file_type == Item.FileType.EPUB:
            return Localizer.get().project_fmt_ebook

        suffix = Path(rel_path).suffix.lower()
        if suffix in {".srt", ".ass"}:
            return Localizer.get().workbench_fmt_subtitle_file
        if suffix == ".txt":
            return Localizer.get().workbench_fmt_text_file

        fallback = Path(rel_path).suffix.lstrip(".")
        return fallback.upper() if fallback else "-"

    def run_in_thread(self, fn) -> None:
        t = threading.Thread(target=fn, daemon=True)
        t.start()

    def on_add_file_clicked(self) -> None:
        if self.is_engine_busy():
            return

        exts = [
            f"*{ext}"
            for ext in sorted(DataManager.get().get_supported_extensions())
            if isinstance(ext, str)
        ]
        filter_str = f"{Localizer.get().supported_files} ({' '.join(exts)})"
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            Localizer.get().workbench_btn_add_file,
            "",
            filter_str,
        )
        if not file_path:
            return

        def worker() -> None:
            try:
                DataManager.get().add_file(file_path)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().workbench_toast_add_success,
                    },
                )
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to add file: {file_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )

        self.run_in_thread(worker)

    def on_update_file(self, rel_path: str) -> None:
        if self.is_engine_busy():
            return

        exts = [
            f"*{ext}"
            for ext in sorted(DataManager.get().get_supported_extensions())
            if isinstance(ext, str)
        ]
        filter_str = f"{Localizer.get().supported_files} ({' '.join(exts)})"
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            Localizer.get().workbench_btn_update,
            "",
            filter_str,
        )
        if not file_path:
            return

        def worker() -> None:
            try:
                stats = DataManager.get().update_file(rel_path, file_path)
                matched = str(stats.get("matched", 0))
                new_count = str(stats.get("new", 0))
                stat_text = (
                    Localizer.get()
                    .workbench_update_stat.replace("{MATCHED}", matched)
                    .replace("{NEW}", new_count)
                )
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": f"{Localizer.get().workbench_toast_update_success} - {stat_text}",
                    },
                )
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(
                    f"Failed to update file: {rel_path} -> {file_path}", e
                )
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )

        self.run_in_thread(worker)

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

        def worker() -> None:
            try:
                DataManager.get().reset_file(rel_path)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().workbench_toast_reset_success,
                    },
                )
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to reset file: {rel_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )

        self.run_in_thread(worker)

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

        def worker() -> None:
            try:
                DataManager.get().delete_file(rel_path)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().workbench_toast_delete_success,
                    },
                )
            except ValueError as e:
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.WARNING, "message": str(e)},
                )
            except Exception as e:
                LogManager.get().error(f"Failed to delete file: {rel_path}", e)
                self.emit(
                    Base.Event.TOAST,
                    {"type": Base.ToastType.ERROR, "message": str(e)},
                )

        self.run_in_thread(worker)
