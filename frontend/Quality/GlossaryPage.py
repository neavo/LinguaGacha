import os
from functools import partial

from PyQt5.QtGui import QDesktopServices
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtCore import QPoint
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QHeaderView
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QTableWidgetItem
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import TableWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import CommandButton
from qfluentwidgets import TransparentPushButton

from base.Base import Base
from module.Localizer.Localizer import Localizer
from module.TableManager import TableManager
from widget.CommandBarCard import CommandBarCard
from widget.SwitchButtonCard import SwitchButtonCard

class GlossaryPage(QWidget, Base):

    BASE: str = "glossary"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认设置
        self.default = {
            f"{__class__.BASE}_enable": True,
            f"{__class__.BASE}_data": [],
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_foot(self.root, config, window)

    # 头部
    def add_widget_head(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.set_checked(config.get(f"{__class__.BASE}_enable"))

        def checked_changed(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config[f"{__class__.BASE}_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().glossary_page_head_title,
                Localizer.get().glossary_page_head_content,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def item_changed(item: QTableWidgetItem) -> None:
            item.setTextAlignment(Qt.AlignCenter)

        def insert_row(table: TableWidget) -> None:
            selected_index = self.table.selectedIndexes()

            # 有效性检验
            if selected_index == None or len(selected_index) == 0:
                return

            # 插入空行
            table.insertRow(selected_index[0].row())

        def delete_row(table: TableWidget) -> None:
            selected_index = self.table.selectedIndexes()

            # 有效性检验
            if selected_index == None or len(selected_index) == 0:
                return

            # 逆序删除并去重以避免索引错误
            for row in sorted({item.row() for item in selected_index}, reverse = True):
                table.removeRow(row)

        def custom_context_menu_requested(position: QPoint) -> None:
            menu = RoundMenu("", self.table)
            menu.addAction(
                Action(
                    FluentIcon.ADD,
                    Localizer.get().quality_insert_row,
                    triggered = lambda _: insert_row(self.table),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().quality_delete_row,
                    triggered = lambda _: delete_row(self.table),
                )
            )
            menu.exec(self.table.viewport().mapToGlobal(position))

        self.table = TableWidget(self)
        parent.addWidget(self.table)

        # 设置表格属性
        self.table.setBorderRadius(4)
        self.table.setBorderVisible(True)
        self.table.setWordWrap(False)
        self.table.setColumnCount(3)
        self.table.setSelectRightClickedRow(True) # 右键选中行

        # 设置表格列宽
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)

        # 注册事件
        self.table.itemChanged.connect(item_changed)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)

        # 设置水平表头并隐藏垂直表头
        self.table.verticalHeader().setDefaultAlignment(Qt.AlignCenter)
        self.table.setHorizontalHeaderLabels(
            (
                Localizer.get().glossary_page_table_row_01,
                Localizer.get().glossary_page_table_row_02,
                Localizer.get().glossary_page_table_row_03,
            )
        )

        # 向表格更新数据
        self.table_manager = TableManager(
            type = TableManager.Type.GLOSSARY,
            data = config.get(f"{__class__.BASE}_data"),
            table = self.table,
        )
        self.table_manager.sync()

    # 底部
    def add_widget_foot(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.set_minimum_width(640)
        self.add_command_bar_action_import(self.command_bar_card, config, window)
        self.add_command_bar_action_export(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_add(self.command_bar_card, config, window)
        self.add_command_bar_action_save(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_preset(self.command_bar_card, config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

    # 导入
    def add_command_bar_action_import(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            # 选择文件
            path, _ = QFileDialog.getOpenFileName(None, Localizer.get().quality_select_file, "", Localizer.get().quality_select_file_type)
            if not isinstance(path, str) or path == "":
                return

            # 从文件加载数据
            self.table_manager.load_from_file(path)
            self.table_manager.sync()

            # 更新配置文件
            config = self.load_config()
            config[f"{__class__.BASE}_data"] = self.table_manager.get_data()
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            })

        parent.add_action(
            Action(FluentIcon.DOWNLOAD, Localizer.get().quality_import, parent, triggered = triggered),
        )

    # 导出
    def add_command_bar_action_export(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            # 导出文件
            self.table_manager.export(Localizer.get().path_glossary_export)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_export_toast,
            })

        parent.add_action(
            Action(FluentIcon.SHARE, Localizer.get().quality_export, parent, triggered = triggered),
        )

    # 添加新行
    def add_command_bar_action_add(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            # 添加新行
            self.table.setRowCount(self.table.rowCount() + 1)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_add_toast,
            })

        parent.add_action(
            Action(FluentIcon.ADD_TO, Localizer.get().quality_add, parent, triggered = triggered),
        )

    # 保存
    def add_command_bar_action_save(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            # 清空数据，再从表格加载数据
            self.table_manager.set_data([])
            self.table_manager.load_from_table()
            self.table_manager.sync()

            # 更新配置文件
            config = self.load_config()
            config[f"{__class__.BASE}_data"] = self.table_manager.get_data()
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_save_toast,
            })

        parent.add_action(
            Action(FluentIcon.SAVE, Localizer.get().quality_save, parent, triggered = triggered),
        )

    # 预设
    def add_command_bar_action_preset(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        widget: CommandButton = None

        def load_preset() -> list[str]:
            filenames: list[str] = []

            try:
                for _, _, filenames in os.walk(f"resource/{__class__.BASE}_preset/{Localizer.get_app_language().lower()}"):
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
            self.table_manager.set_data(self.default.get(f"{__class__.BASE}_data"))
            self.table_manager.sync()

            # 更新配置文件
            config = self.load_config()
            config[f"{__class__.BASE}_data"] = self.table_manager.get_data()
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_reset_toast,
            })

        def apply_preset(filename: str) -> None:
            path: str = f"resource/{__class__.BASE}_preset/{Localizer.get_app_language().lower()}/{filename}.json"

            # 从文件加载数据
            self.table_manager.load_from_file(path)
            self.table_manager.sync()

            # 更新配置文件
            config = self.load_config()
            config[f"{__class__.BASE}_data"] = self.table_manager.get_data()
            config = self.save_config(config)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_import_toast,
            })

        def triggered() -> None:
            menu = RoundMenu("", widget)
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
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
            FluentIcon.TRANSPARENT,
            Localizer.get().quality_preset,
            parent = parent,
            triggered = triggered
        ))

    # KG
    def add_command_bar_action_kg(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/KeywordGacha"))

        push_button = TransparentPushButton(FluentIcon.ROBOT, Localizer.get().glossary_page_kg)
        push_button.clicked.connect(connect)
        parent.add_widget(push_button)

    # WiKi
    def add_command_bar_action_wiki(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        parent.add_widget(push_button)