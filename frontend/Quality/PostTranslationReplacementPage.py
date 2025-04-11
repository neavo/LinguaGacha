import os
from functools import partial

import openpyxl
import openpyxl.worksheet.worksheet
import rapidjson as json
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
from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.XLSXHelper import XLSXHelper
from module.TableHelper import TableHelper
from widget.CommandBarCard import CommandBarCard
from widget.SwitchButtonCard import SwitchButtonCard

class PostTranslationReplacementPage(QWidget, Base):

    PRESET_PATH: str = "resource/post_translation_replacement_preset"

    # 表格每列对应的数据字段
    KEYS = (
        "src",
        "dst",
    )

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 根据应用语言加载默认设置
        if Localizer.get_app_language() == BaseLanguage.ZH:
            self.default = {
                "post_translation_replacement_enable": True,
                "post_translation_replacement_regex": False,
                "post_translation_replacement_data" : [],
            }
        else:
            self.default = {
                "post_translation_replacement_enable": True,
                "post_translation_replacement_regex": False,
                "post_translation_replacement_data" : [],
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
            widget.set_checked(config.get("post_translation_replacement_enable"))

        def checked_changed(widget: SwitchButtonCard, checked: bool) -> None:
            config = self.load_config()
            config["post_translation_replacement_enable"] = checked
            self.save_config(config)

        parent.addWidget(
            SwitchButtonCard(
                Localizer.get().post_translation_replacement_page_head_title,
                Localizer.get().post_translation_replacement_page_head_content,
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
                    Localizer.get().table_insert_row,
                    triggered = lambda _: insert_row(self.table),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().table_delete_row,
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
        self.table.setColumnCount(len(PostTranslationReplacementPage.KEYS))
        self.table.resizeRowsToContents() # 设置行高度自适应内容
        self.table.resizeColumnsToContents() # 设置列宽度自适应内容
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch) # 撑满宽度
        self.table.setSelectRightClickedRow(True) # 右键选中行

        # 注册事件
        self.table.itemChanged.connect(item_changed)
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)

        # 设置水平表头并隐藏垂直表头
        self.table.verticalHeader().setDefaultAlignment(Qt.AlignCenter)
        self.table.setHorizontalHeaderLabels(
            (
                Localizer.get().post_translation_replacement_page_table_row_01,
                Localizer.get().post_translation_replacement_page_table_row_02,
            )
        )

        # 向表格更新数据
        TableHelper.update_to_table(self.table, config.get("post_translation_replacement_data"), PostTranslationReplacementPage.KEYS)

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
        self.command_bar_card.add_separator()
        self.add_command_bar_action_regex(self.command_bar_card, config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

    # 导入
    def add_command_bar_action_import(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            # 选择文件
            path, _ = QFileDialog.getOpenFileName(None, Localizer.get().select_file, "", Localizer.get().select_file_type)
            if not isinstance(path, str) or path == "":
                return

            # 从文件加载数据
            data = TableHelper.load_from_file(path, PostTranslationReplacementPage.KEYS)

            # 读取配置文件
            config = self.load_config()
            config["post_translation_replacement_data"].extend(data)

            # 向表格更新数据
            TableHelper.update_to_table(self.table, config["post_translation_replacement_data"], PostTranslationReplacementPage.KEYS)

            # 从表格加载数据（去重后）
            config["post_translation_replacement_data"] = TableHelper.load_from_table(self.table, PostTranslationReplacementPage.KEYS)

            # 保存配置文件
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

        def export_to_xlsx(data: list[dict[str, str]], path: str) -> None:
            # 新建工作表
            book: openpyxl.Workbook = openpyxl.Workbook()
            sheet: openpyxl.worksheet.worksheet.Worksheet = book.active

            # 设置表头
            sheet.column_dimensions["A"].width = 32
            sheet.column_dimensions["B"].width = 32
            sheet.column_dimensions["C"].width = 32

            # 将数据写入工作表
            for row, item in enumerate(data):
                XLSXHelper.set_cell_value(sheet, row + 1, 1, item.get("src", ""), 10)
                XLSXHelper.set_cell_value(sheet, row + 1, 2, item.get("dst", ""), 10)
                XLSXHelper.set_cell_value(sheet, row + 1, 3, item.get("info", ""), 10)

            # 保存工作簿
            book.save(path)

        def triggered() -> None:
            # 从表格加载数据
            data = TableHelper.load_from_table(self.table, PostTranslationReplacementPage.KEYS)

            # 导出文件
            export_to_xlsx(data, f"{Localizer.get().path_post_translation_replacement_export}.xlsx")
            with open(f"{Localizer.get().path_post_translation_replacement_export}.json", "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(data, indent = 4, ensure_ascii = False))

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
            # 加载配置文件
            config = self.load_config()

            # 从表格加载数据
            config["post_translation_replacement_data"] = TableHelper.load_from_table(self.table, PostTranslationReplacementPage.KEYS)

            # 清空表格
            self.table.clearContents()

            # 向表格更新数据
            TableHelper.update_to_table(self.table, config["post_translation_replacement_data"], PostTranslationReplacementPage.KEYS)

            # 从表格加载数据（去重后）
            config["post_translation_replacement_data"] = TableHelper.load_from_table(self.table, PostTranslationReplacementPage.KEYS)

            # 保存配置文件
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
                for root, _, filenames in os.walk(f"{__class__.PRESET_PATH}/{Localizer.get_app_language().lower()}"):
                    filenames = [v.lower().removesuffix(".json") for v in filenames if v.lower().endswith(".json")]
            except Exception as e:
                pass

            return filenames

        def reset() -> None:
            message_box = MessageBox(Localizer.get().alert, Localizer.get().quality_reset_alert, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            self.table.clearContents()
            config = self.load_config()
            config["post_translation_replacement_data"] = self.default.get("post_translation_replacement_data")
            config = self.save_config(config)
            TableHelper.update_to_table(self.table, config.get("post_translation_replacement_data"), __class__.KEYS)

            # 弹出提示
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().quality_reset_toast,
            })

        def apply_preset(filename: str) -> None:
            path: str = f"{__class__.PRESET_PATH}/{Localizer.get_app_language().lower()}/{filename}.json"

            # 从文件加载数据
            data = TableHelper.load_from_file(path, __class__.KEYS)

            # 读取配置文件
            config = self.load_config()
            config["post_translation_replacement_data"].extend(data)

            # 向表格更新数据
            TableHelper.update_to_table(self.table, config["post_translation_replacement_data"], __class__.KEYS)

            # 从表格加载数据（去重后）
            config["post_translation_replacement_data"] = TableHelper.load_from_table(self.table, __class__.KEYS)

            # 保存配置文件
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

    # 正则模式
    def add_command_bar_action_regex(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        action_regex: Action = None

        def update_ui(config: dict) -> None:
            if config.get("post_translation_replacement_regex") == True:
                action_regex.setText(Localizer.get().quality_regex_on)
            else:
                action_regex.setText(Localizer.get().quality_regex_off)

        def triggered() -> None:
            config = self.load_config()
            config["post_translation_replacement_regex"] = config.get("post_translation_replacement_regex") == False
            config = self.save_config(config)
            update_ui(config)

        action_regex = Action(FluentIcon.TILES, Localizer.get().quality_regex_off, parent, triggered = triggered)
        parent.add_action(action_regex)
        update_ui(config)

    # WiKi
    def add_command_bar_action_wiki(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        parent.add_widget(push_button)