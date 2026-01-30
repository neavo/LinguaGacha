import json
import os
from functools import partial
from pathlib import Path

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
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import RoundMenu
from qfluentwidgets import TableWidget
from qfluentwidgets import TransparentPushButton

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.QualityRuleManager import QualityRuleManager
from module.TableManager import TableManager
from widget.CommandBarCard import CommandBarCard
from widget.LineEditMessageBox import LineEditMessageBox
from widget.SearchCard import SearchCard
from widget.SwitchButtonCard import SwitchButtonCard


class TextPreservePage(QWidget, Base):
    BASE: str = "text_preserve"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_foot(self.root, config, window)

        # 注册事件：工程加载后刷新数据（从 .lg 文件读取）
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        # 工程卸载后清空数据
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

    # 获取文本保护数据
    def get_text_preserve_data(self) -> list[dict[str, str]]:
        return QualityRuleManager.get().get_text_preserve()

    # 保存文本保护数据
    def set_text_preserve_data(self, data: list[dict[str, str]]) -> None:
        QualityRuleManager.get().set_text_preserve(data)

    # 获取启用状态
    def get_text_preserve_enable(self) -> bool:
        return QualityRuleManager.get().get_text_preserve_enable()

    # 设置启用状态
    def set_text_preserve_enable(self, enable: bool) -> None:
        QualityRuleManager.get().set_text_preserve_enable(enable)

    # 工程加载后刷新数据
    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        self.table_manager.reset()
        self.table_manager.set_data(self.get_text_preserve_data())
        self.table_manager.sync()
        # 刷新开关状态
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(
                self.get_text_preserve_enable()
            )

    # 工程卸载后清空数据
    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        self.table_manager.reset()
        self.table_manager.sync()
        # 重置开关状态
        if hasattr(self, "switch_card"):
            self.switch_card.get_switch_button().setChecked(True)

    # 头部
    def add_widget_head(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(self.get_text_preserve_enable())

        def checked_changed(widget: SwitchButtonCard) -> None:
            self.set_text_preserve_enable(widget.get_switch_button().isChecked())

        self.switch_card = SwitchButtonCard(
            getattr(Localizer.get(), f"{__class__.BASE}_page_head_title"),
            getattr(Localizer.get(), f"{__class__.BASE}_page_head_content"),
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.switch_card)

    # 主体
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def item_changed(item: QTableWidgetItem) -> None:
            if self.table_manager.get_updating():
                return None

            new_row = item.row()
            new_entry = self.table_manager.get_entry_by_row(new_row)

            # 确保 new_entry 和其 'src' 键存在且为字符串
            new_src_raw = new_entry.get("src")
            if not isinstance(new_src_raw, str):
                return
            new_src = new_src_raw.strip()
            if not new_src:
                return

            for old_row in range(self.table.rowCount()):
                if new_row == old_row:
                    continue

                old_entry = self.table_manager.get_entry_by_row(old_row)
                # 确保 old_entry 和其 'src' 键存在且为字符串
                old_entry_raw = old_entry.get("src")
                if not isinstance(old_entry_raw, str):
                    continue
                old_src = old_entry_raw.strip()
                if not old_src:
                    continue

                if new_src == old_src:
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "duration": 5000,
                            "message": (
                                f"{Localizer.get().quality_merge_duplication}"
                                f"\n{json.dumps(new_entry, indent=None, ensure_ascii=False)}"
                                f"\n{json.dumps(old_entry, indent=None, ensure_ascii=False)}"
                            ),
                        },
                    )

            # 清空数据，再从表格加载数据
            self.table_manager.set_data([])
            self.table_manager.append_data_from_table()
            self.table_manager.sync()

            # 保存数据
            self.set_text_preserve_data(self.table_manager.get_data())

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_save_toast,
                },
            )

        def custom_context_menu_requested(position: QPoint) -> None:
            def delete_row_with_save() -> None:
                self.table_manager.delete_row()
                self.table_manager.sync()
                self.set_text_preserve_data(self.table_manager.get_data())
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().quality_save_toast,
                    },
                )

            menu = RoundMenu("", self.table)
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().quality_delete_row,
                    triggered=delete_row_with_save,
                )
            )
            menu.exec(self.table.viewport().mapToGlobal(position))

        self.table = TableWidget(self)
        parent.addWidget(self.table)

        # 设置表格属性
        self.table.setColumnCount(2)
        self.table.setBorderVisible(False)
        self.table.setSelectRightClickedRow(True)

        # 设置表格列宽
        self.table.setColumnWidth(0, 470)
        self.table.horizontalHeader().setStretchLastSection(True)

        # 设置水平表头并隐藏垂直表头
        self.table.verticalHeader().setDefaultAlignment(Qt.AlignmentFlag.AlignCenter)
        self.table.setHorizontalHeaderLabels(
            (
                getattr(Localizer.get(), f"{__class__.BASE}_page_table_row_01"),
                getattr(Localizer.get(), f"{__class__.BASE}_page_table_row_02"),
            )
        )

        # 向表格更新数据
        self.table_manager = TableManager(
            type=TableManager.Type.TEXT_PRESERVE,
            data=[],
            table=self.table,
        )
        self.table_manager.sync()

        # 注册事件
        self.table.itemChanged.connect(item_changed)
        self.table.customContextMenuRequested.connect(custom_context_menu_requested)
        self.table.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)

    # 底部
    def add_widget_foot(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
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
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().alert_no_data,
                    },
                )

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
    def add_command_bar_action_import(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            # 选择文件
            path, _ = QFileDialog.getOpenFileName(
                None,
                Localizer.get().quality_select_file,
                "",
                Localizer.get().quality_select_file_type,
            )
            if not isinstance(path, str) or path == "":
                return

            # 从文件加载数据
            data = self.table_manager.get_data()
            self.table_manager.reset()
            self.table_manager.set_data(data)
            self.table_manager.append_data_from_file(path)
            self.table_manager.sync()

            # 保存数据
            self.set_text_preserve_data(self.table_manager.get_data())

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_import_toast,
                },
            )

        parent.add_action(
            Action(
                FluentIcon.DOWNLOAD,
                Localizer.get().quality_import,
                parent,
                triggered=triggered,
            ),
        )

    # 导出
    def add_command_bar_action_export(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            path, _ = QFileDialog.getSaveFileName(
                window,
                Localizer.get().quality_select_file,
                "",
                Localizer.get().quality_select_file_type,
            )
            if not isinstance(path, str) or path == "":
                return None

            # 导出文件
            self.table_manager.export(str(Path(path).with_suffix("")))

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_export_toast,
                },
            )

        parent.add_action(
            Action(
                FluentIcon.SHARE,
                Localizer.get().quality_export,
                parent,
                triggered=triggered,
            ),
        )

    # 搜索
    def add_command_bar_action_search(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            self.search_card.setVisible(True)
            self.command_bar_card.setVisible(False)

        parent.add_action(
            Action(
                FluentIcon.SEARCH, Localizer.get().search, parent, triggered=triggered
            ),
        )

    # 预设
    def add_command_bar_action_preset(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def get_preset_paths() -> tuple[list[dict], list[dict]]:
            builtin_dir = (
                f"resource/preset/{self.BASE}/{Localizer.get_app_language().lower()}"
            )
            user_dir = f"resource/preset/{self.BASE}/user"

            builtin_presets = []
            user_presets = []

            # 加载内置预设
            if os.path.exists(builtin_dir):
                for f in os.listdir(builtin_dir):
                    if f.lower().endswith(".json"):
                        path = os.path.join(builtin_dir, f).replace("\\", "/")
                        builtin_presets.append(
                            {
                                "name": f[:-5],
                                "path": path,
                                "type": "builtin",
                            }
                        )

            # 加载用户预设
            if not os.path.exists(user_dir):
                os.makedirs(user_dir)

            for f in os.listdir(user_dir):
                if f.lower().endswith(".json"):
                    path = os.path.join(user_dir, f).replace("\\", "/")
                    user_presets.append(
                        {
                            "name": f[:-5],
                            "path": path,
                            "type": "user",
                        }
                    )

            return builtin_presets, user_presets

        def set_default_preset(item: dict) -> None:
            # 重新加载配置以防止覆盖其他页面的修改
            current_config = Config().load()
            current_config.text_preserve_default_preset = item["path"]
            current_config.save()

            # 更新当前页面的配置对象
            config.text_preserve_default_preset = item["path"]

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_set_default_preset_success,
                },
            )

        def cancel_default_preset() -> None:
            # 重新加载配置以防止覆盖其他页面的修改
            current_config = Config().load()
            current_config.text_preserve_default_preset = ""
            current_config.save()

            # 更新当前页面的配置对象
            config.text_preserve_default_preset = ""

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_cancel_default_preset_success,
                },
            )

        def reset() -> None:
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().quality_reset_alert, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            # 重置数据
            self.table_manager.reset()

            # 如果配置了默认预设，则加载默认预设
            default_preset = config.text_preserve_default_preset
            if default_preset and os.path.exists(default_preset):
                self.table_manager.append_data_from_file(default_preset)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().quality_default_preset_loaded_toast.format(
                            NAME=os.path.basename(default_preset)
                        ),
                    },
                )
            else:
                self.table_manager.set_data([])

            self.table_manager.sync()

            # 保存数据
            self.set_text_preserve_data(self.table_manager.get_data())

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_reset_toast,
                },
            )

        def apply_preset(path: str) -> None:
            # 从文件加载数据
            data = self.table_manager.get_data()
            self.table_manager.reset()
            self.table_manager.set_data(data)
            self.table_manager.append_data_from_file(path)
            self.table_manager.sync()

            # 保存数据
            self.set_text_preserve_data(self.table_manager.get_data())

            # 弹出提示
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().quality_import_toast,
                },
            )

        def save_preset() -> None:
            def on_save(dialog: LineEditMessageBox, text: str) -> None:
                if not text.strip():
                    return

                path = f"resource/preset/{self.BASE}/user/{text.strip()}.json"
                user_dir = os.path.dirname(path)
                if not os.path.exists(user_dir):
                    os.makedirs(user_dir)

                if os.path.exists(path):
                    message_box = MessageBox(
                        Localizer.get().warning,
                        Localizer.get().alert_preset_already_exists,
                        window,
                    )
                    message_box.yesButton.setText(Localizer.get().confirm)
                    message_box.cancelButton.setText(Localizer.get().cancel)

                    if not message_box.exec():
                        return

                try:
                    data = self.table_manager.get_data()
                    with open(path, "w", encoding="utf-8") as writer:
                        writer.write(json.dumps(data, indent=4, ensure_ascii=False))

                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().quality_save_preset_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    self.error("Failed to save preset", e)

            dialog = LineEditMessageBox(
                window, Localizer.get().quality_save_preset_title, on_save
            )
            dialog.exec()

        def rename_preset(item: dict) -> None:
            def on_rename(dialog: LineEditMessageBox, text: str) -> None:
                if not text.strip():
                    return

                new_path = os.path.join(
                    os.path.dirname(item["path"]), text.strip() + ".json"
                )
                if os.path.exists(new_path):
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().alert_file_already_exists,
                        },
                    )
                    return

                try:
                    os.rename(item["path"], new_path)
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().task_success,
                        },
                    )
                    dialog.accept()
                except Exception as e:
                    self.error("Failed to rename preset", e)

            dialog = LineEditMessageBox(window, Localizer.get().rename, on_rename)
            dialog.get_line_edit().setText(item["name"])
            dialog.exec()

        def delete_preset(item: dict) -> None:
            message_box = MessageBox(
                Localizer.get().warning,
                Localizer.get().alert_delete_preset.format(NAME=item["name"]),
                window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if message_box.exec():
                try:
                    os.remove(item["path"])

                    # 如果删除的是默认预设，则清除配置
                    current_config = Config().load()
                    if current_config.text_preserve_default_preset == item["path"]:
                        current_config.text_preserve_default_preset = ""
                        current_config.save()
                        # 更新当前页面的配置对象
                        config.text_preserve_default_preset = ""

                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.SUCCESS,
                            "message": Localizer.get().task_success,
                        },
                    )
                except Exception as e:
                    self.error("Failed to delete preset", e)

        def triggered() -> None:
            menu = RoundMenu("", widget)

            # 重置
            menu.addAction(
                Action(
                    FluentIcon.ERASE_TOOL,
                    Localizer.get().quality_reset,
                    triggered=reset,
                )
            )

            # 保存
            menu.addAction(
                Action(
                    FluentIcon.SAVE,
                    Localizer.get().quality_save_preset,
                    triggered=save_preset,
                )
            )

            menu.addSeparator()

            builtin_presets, user_presets = get_preset_paths()

            # 内置预设
            for item in builtin_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(FluentIcon.FOLDER)
                sub_menu.addAction(
                    Action(
                        FluentIcon.DOWNLOAD,
                        Localizer.get().quality_import,
                        triggered=partial(apply_preset, item["path"]),
                    )
                )

                sub_menu.addSeparator()

                # 默认预设控制
                if config.text_preserve_default_preset == item["path"]:
                    sub_menu.setIcon(FluentIcon.CERTIFICATE)
                    sub_menu.addAction(
                        Action(
                            FluentIcon.FLAG,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            FluentIcon.TAG,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            # 如果需要分隔符
            if builtin_presets and user_presets:
                menu.addSeparator()

            # 用户预设
            for item in user_presets:
                sub_menu = RoundMenu(item["name"], menu)
                sub_menu.setIcon(FluentIcon.FOLDER_ADD)

                # 应用
                sub_menu.addAction(
                    Action(
                        FluentIcon.DOWNLOAD,
                        Localizer.get().quality_import,
                        triggered=partial(apply_preset, item["path"]),
                    )
                )

                # 重命名
                sub_menu.addAction(
                    Action(
                        FluentIcon.EDIT,
                        Localizer.get().rename,
                        triggered=partial(rename_preset, item),
                    )
                )

                # 删除
                sub_menu.addAction(
                    Action(
                        FluentIcon.DELETE,
                        Localizer.get().quality_delete_preset,
                        triggered=partial(delete_preset, item),
                    )
                )

                sub_menu.addSeparator()

                # 默认预设控制
                if config.text_preserve_default_preset == item["path"]:
                    sub_menu.setIcon(FluentIcon.CERTIFICATE)
                    sub_menu.addAction(
                        Action(
                            FluentIcon.CLEAR_SELECTION,
                            Localizer.get().quality_cancel_default_preset,
                            triggered=cancel_default_preset,
                        )
                    )
                else:
                    sub_menu.addAction(
                        Action(
                            FluentIcon.CERTIFICATE,
                            Localizer.get().quality_set_as_default_preset,
                            triggered=partial(set_default_preset, item),
                        )
                    )

                menu.addMenu(sub_menu)

            # 计算弹出位置（向上弹出）
            # 1. 获取按钮全局坐标 (左上角)
            global_pos = widget.mapToGlobal(QPoint(0, 0))

            # 2. 向上弹出动画
            # 使用 PULL_UP 动画类型，并传入按钮顶部坐标作为基准点
            # 库会自动计算菜单位置：y = pos.y() - h + 13
            # 我们稍微调整基准点以避免菜单覆盖按钮
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        widget = parent.add_action(
            Action(
                FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                Localizer.get().quality_preset,
                parent=parent,
                triggered=triggered,
            )
        )

    # WiKi
    def add_command_bar_action_wiki(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def connect() -> None:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki"))

        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(connect)
        parent.add_widget(push_button)
