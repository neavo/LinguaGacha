import json
import os
from functools import partial

from PyQt5.QtCore import QPoint
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QTableWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CommandButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import TransparentPushButton

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.TableManager import TableManager
from widget.CommandBarCard import CommandBarCard
from widget.SearchCard import SearchCard
from widget.SwitchButtonCard import SwitchButtonCard

class TextReplacementPage(QWidget, Base):

    def __init__(self, name: str, window: FluentWindow, base_key: str) -> None:
        super().__init__(window)
        self.setObjectName(name.replace(" ", "-"))

        # 初始化
        self.base_key = base_key

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_foot(self.root, config, window)

    # 头部
    def add_widget_head(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                getattr(config, f"{self.base_key}_enable")
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            setattr(config, f"{self.base_key}_enable", widget.get_switch_button().isChecked())
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                getattr(Localizer.get(), f"{self.base_key}_page_head_title"),
                getattr(Localizer.get(), f"{self.base_key}_page_head_content"),
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def item_changed(item: QTableWidgetItem) -> None:
            if self.table_manager.get_updating() == True:
                return None

            new_row = item.row()
            new = self.table_manager.get_entry_by_row(new_row)
            for old_row in range(self.table.rowCount()):
                old = self.table_manager.get_entry_by_row(old_row)

                if new_row == old_row:
                    continue
                if new.get("src").strip() == "" or old.get("src").strip() == "":
                    continue

                if new.get("src") == old.get("src"):
                    self.emit(Base.Event.APP_TOAST_SHOW, {
                        "type": Base.ToastType.WARNING,
                        "duration": 5000,
                        "message": (
                            f"{Localizer.get().quality_merge_duplication}"
                            "\n" + f"{json.dumps(new, indent = None, ensure_ascii = False)}"
                            "\n" + f"{json.dumps(old, indent = None, ensure_ascii = False)}"
                        ),
                    })

            # 清空数据，再从表格加载数据
            self.table_manager.set_data([])
            self.table_manager.append_data_from_table()
            self.table_manager.sync()

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", self.table_manager.get_data())
            config.save()

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            })

        def custom_context_menu_requested(position: QPoint) -> None:
            menu = RoundMenu("", self.table)
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().quality_delete_row,
                    triggered = self.table_manager.delete_row,
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.IOT,
                    Localizer.get().quality_switch_regex,
                    triggered = self.table_manager.switch_regex,
                )
            )
            menu.exec(self.table.viewport().mapToGlobal(position))

        self.table = TableWidget(self)
        parent.addWidget(self.table)

        # 设置表格属性
        self.table.setColumnCount(3)
        self.table.setBorderVisible(False)
        self.table.setSelectRightClickedRow(True)

        # 设置表格列宽
        self.table.setColumnWidth(0, 420)
        self.table.setColumnWidth(1, 420)
        self.table.horizontalHeader().setStretchLastSection(True)

        # 设置水平表头并隐藏垂直表头
        self.table.verticalHeader().setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        self.table.setHorizontalHeaderLabels(
            (
                getattr(Localizer.get(), f"{self.base_key}_page_table_row_01"),
                getattr(Localizer.get(), f"{self.base_key}_page_table_row_02"),
                getattr(Localizer.get(), f"{self.base_key}_page_table_row_03"),
            )
        )

        # 向表格更新数据
        self.table_manager = TableManager(
            type = TableManager.Type.REPLACEMENT,
            data = getattr(config, f"{self.base_key}_data"),
            table = self.table,
        )
        self.table_manager.sync()

        # 注册事件
        self.table.itemChanged.connect(item_changed)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

    # 底部
    def add_widget_foot(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        # 创建搜索栏
        self.search_card = SearchCard(self)
        self.search_card.setVisible(False)
        parent.addWidget(self.search_card)

        def back_clicked(widget: SearchCard) -> None:
            self.search_card.setVisible(False)
            self.command_bar_card.setVisible(True)
        self.search_card.on_back_clicked(back_clicked)

        def next_clicked(widget: SearchCard) -> None:
            keyword: str = widget.get_line_edit().text().strip()

            row: int = self.table_manager.search(keyword, self.table.currentRow())
            if row > -1:
                self.table.setCurrentCell(row, 0)
            else:
                self.emit(Base.Event.APP_TOAST_SHOW, {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().alert_no_data,
                })
        self.search_card.on_next_clicked(next_clicked)

        # 创建命令栏
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        self.command_bar_card.set_minimum_width(640)
        self.add_command_bar_action_import(self.command_bar_card, config, window)
        self.add_command_bar_action_export(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_search(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(self.command_bar_card, config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)


    # 导入
    def add_command_bar_action_import(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        def triggered() -> None:
            # 选择文件
            path, _ = QFileDialog.getOpenFileName(None, Localizer.get().quality_select_file, "", Localizer.get().quality_select_file_type)
            if not isinstance(path, str) or path == "":
                return

            # 从文件加载数据
            data = self.table_manager.get_data()
            self.table_manager.reset()
            self.table_manager.set_data(data)
            self.table_manager.append_data_from_file(path)
            self.table_manager.sync()

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", self.table_manager.get_data())
            config.save()

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            })

        parent.add_action(
            Action(FluentIcon.DOWNLOAD, Localizer.get().quality_import, parent, triggered = triggered),
        )

    # 导出
    def add_command_bar_action_export(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        def triggered() -> None:
            # 导出文件
            self.table_manager.export(getattr(Localizer.get(), f"path_{self.base_key}_export"))

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_export_toast,
            })

        parent.add_action(
            Action(FluentIcon.SHARE, Localizer.get().quality_export, parent, triggered = triggered),
        )

    # 搜索
    def add_command_bar_action_search(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        def triggered() -> None:
            self.search_card.setVisible(True)
            self.command_bar_card.setVisible(False)

        parent.add_action(
            Action(FluentIcon.SEARCH, Localizer.get().search, parent, triggered = triggered),
        )

    # 预设
    def add_command_bar_action_preset(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        widget: CommandButton = None

        def load_preset() -> list[str]:
            filenames: list[str] = []

            try:
                for _, _, filenames in os.walk(f"resource/{self.base_key}_preset/{Localizer.get_app_language().lower()}"):
                    filenames = [v.lower().removesuffix(".json") for v in filenames if v.lower().endswith(".json")]
            except Exception:
                pass

            return filenames

        def reset() -> None:
            message_box = MessageBox(Localizer.get().alert, Localizer.get().quality_reset_alert, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            # 重置数据
            self.table_manager.reset()
            self.table_manager.set_data(getattr(Config(), f"{self.base_key}_data"))
            self.table_manager.sync()

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", self.table_manager.get_data())
            config.save()

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_reset_toast,
            })

        def apply_preset(filename: str) -> None:
            path: str = f"resource/{self.base_key}_preset/{Localizer.get_app_language().lower()}/{filename}.json"

            # 从文件加载数据
            data = self.table_manager.get_data()
            self.table_manager.reset()
            self.table_manager.set_data(data)
            self.table_manager.append_data_from_file(path)
            self.table_manager.sync()

            # 更新配置文件
            config = Config().load()
            setattr(config, f"{self.base_key}_data", self.table_manager.get_data())
            config.save()

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            })

        def triggered() -> None:
            menu = RoundMenu("", widget)
            menu.addAction(
                Action(
                    FluentIcon.CLEAR_SELECTION,
                    Localizer.get().quality_reset,
                    triggered = reset,
                )
            )
            for v in load_preset():
                menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        v,
                        triggered = partial(apply_preset, v),
                    )
                )
            menu.exec(widget.mapToGlobal(QPoint(0, -menu.height())))

        widget = parent.add_action(Action(
            FluentIcon.EXPRESSIVE_INPUT_ENTRY,
            Localizer.get().quality_preset,
            parent = parent,
            triggered = triggered
        ))

    # WiKi
    def add_command_bar_action_wiki(self, parent: CommandBarCard, config: Config, window: FluentWindow) -> None:

        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        parent.add_widget(push_button)