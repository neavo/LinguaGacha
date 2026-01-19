"""重译页面

TODO: 此页面目前存在问题，无法正常工作
-------------------------------------
原因：
1. 此页面设计为使用传统模式（ItemStore）存储翻译条目
2. 调用 DataAccessLayer.set_items() 后发送 TRANSLATION_RUN 事件启动翻译
3. 但 Translator.start() 强制要求工程模式（SessionContext.is_loaded() == True）
4. 因此翻译器会拒绝执行，提示"请先加载工程文件"

修复方案：
- 改造为工程模式兼容，要求用户先创建/加载工程
- 或重新设计此功能的工作流程
"""

import time

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import TransparentPushButton

from base.Base import Base
from model.Item import Item
from model.Project import Project
from module.Config import Config
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.OutputPath import OutputPath
from module.SessionContext import SessionContext
from widget.CommandBarCard import CommandBarCard
from widget.CustomTextEdit import CustomTextEdit
from widget.EmptyCard import EmptyCard
from widget.GroupCard import GroupCard


class ReTranslationPage(QWidget, Base):
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

    # 头部
    def add_widget_head(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        parent.addWidget(
            EmptyCard(
                title=Localizer.get().re_translation_page,
                description=Localizer.get().re_translation_page_desc,
                init=None,
            )
        )

    # 主体
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        parent.addWidget(scroll_area)

        def init(widget: GroupCard) -> None:
            self.keyword_text_edit = CustomTextEdit(self)
            self.keyword_text_edit.setPlaceholderText(Localizer.get().placeholder)
            widget.add_widget(self.keyword_text_edit)

        self.keyword_text_edit: PlainTextEdit = None
        scroll_area_vbox.addWidget(
            GroupCard(
                parent=self,
                title=Localizer.get().re_translation_page_white_list,
                description=Localizer.get().re_translation_page_white_list_desc,
                init=init,
            )
        )

    # 底部
    def add_widget_foot(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.set_minimum_width(512)
        self.add_command_bar_action_start(self.command_bar_card, config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

    # 开始
    def add_command_bar_action_start(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            message_box = MessageBox(
                Localizer.get().alert, Localizer.get().alert_reset_translation, window
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            # 点击取消，则不触发开始翻译事件
            if not message_box.exec():
                return None

            # 生成翻译数据
            project, items_single, error_message = self.process_single()
            if error_message != "":
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": error_message,
                    },
                )
                return None
            project, items_double, error_message = self.process_double()
            if error_message != "":
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": error_message,
                    },
                )
                return None

            # 合并翻译数据
            items = items_single + items_double

            # 有效性检查
            items_lenght = len(
                [v for v in items if v.get_status() == Base.ProjectStatus.NONE]
            )
            if items_lenght == 0:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().alert_no_data,
                    },
                )
                return None

            # 设置项目数据
            project.set_status(Base.ProjectStatus.PROCESSING)
            project.set_extras(
                {
                    "start_time": time.time(),
                    "total_line": len(
                        [
                            item
                            for item in items
                            if item.get_status() == Base.ProjectStatus.NONE
                        ]
                    ),
                    "line": 0,
                    "total_tokens": 0,
                    "total_output_tokens": 0,
                    "time": 0,
                }
            )

            # 写入工程数据库
            db = SessionContext.get().get_db()
            if db is None:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.ERROR,
                        "message": Localizer.get().alert_no_data,
                    },
                )
                return None
            db.set_items([item.to_dict() for item in items])

            window.switchTo(window.translation_page)
            self.emit(
                Base.Event.TRANSLATION_RUN,
                {
                    "status": Base.ProjectStatus.PROCESSING,
                },
            )

        parent.add_action(
            Action(
                FluentIcon.PLAY,
                Localizer.get().start,
                parent,
                triggered=triggered,
            ),
        )

    # WiKi
    def add_command_bar_action_wiki(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(
            lambda: QDesktopServices.openUrl(
                QUrl("https://github.com/neavo/LinguaGacha/wiki")
            )
        )
        parent.add_widget(push_button)

    # 处理单文件部分
    def process_single(self) -> tuple[Project, list[Item], str]:
        # 获取输出目录作为输入源
        output_path = OutputPath.get_translated_path()
        input_path = f"{output_path}/dst"

        # 读取译文
        config = Config().load()
        project, items_dst = FileManager(config).read_from_path(input_path)
        items_dst = [
            v
            for v in items_dst
            if v.get_file_type()
            in (
                Item.FileType.XLSX,
                Item.FileType.WOLFXLSX,
                Item.FileType.RENPY,
                Item.FileType.TRANS,
                Item.FileType.KVJSON,
            )
        ]
        items_dst.sort(
            key=lambda item: (item.get_file_path(), item.get_tag(), item.get_row())
        )

        # 加载关键词
        keywords = [
            v.strip()
            for v in self.keyword_text_edit.toPlainText().splitlines()
            if v.strip() != ""
        ]

        # 生成翻译数据
        for item_dst in items_dst:
            if item_dst.get_status() != Base.ProjectStatus.EXCLUDED and any(
                keyword in item_dst.get_src() for keyword in keywords
            ):
                item_dst.set_status(Base.ProjectStatus.NONE)
            elif item_dst.get_status() != Base.ProjectStatus.EXCLUDED:
                item_dst.set_status(Base.ProjectStatus.PROCESSED_IN_PAST)
            else:
                item_dst.set_status(Base.ProjectStatus.EXCLUDED)

        return project, items_dst, ""

    # 处理双文件部分
    def process_double(self) -> tuple[Project, list[Item], str]:
        # 获取输出目录作为输入源
        output_path = OutputPath.get_translated_path()

        # 读取译文
        config = Config().load()
        dst_input_path = f"{output_path}/dst"
        project, items_dst = FileManager(config).read_from_path(dst_input_path)
        items_dst = [
            v
            for v in items_dst
            if v.get_file_type()
            in (
                Item.FileType.MD,
                Item.FileType.TXT,
                Item.FileType.ASS,
                Item.FileType.SRT,
                Item.FileType.EPUB,
                Item.FileType.MESSAGEJSON,
            )
        ]
        items_dst.sort(
            key=lambda item: (item.get_file_path(), item.get_tag(), item.get_row())
        )

        # 读取原文
        config = Config().load()
        src_input_path = f"{output_path}/src"
        project, items_src = FileManager(config).read_from_path(src_input_path)
        items_src = [
            v
            for v in items_src
            if v.get_file_type()
            in (
                Item.FileType.MD,
                Item.FileType.TXT,
                Item.FileType.ASS,
                Item.FileType.SRT,
                Item.FileType.EPUB,
                Item.FileType.MESSAGEJSON,
            )
        ]
        items_src.sort(
            key=lambda item: (item.get_file_path(), item.get_tag(), item.get_row())
        )

        # 有效性检查
        items_src_length = len(
            [v for v in items_src if v.get_status() == Base.ProjectStatus.NONE]
        )
        items_dst_length = len(
            [v for v in items_dst if v.get_status() == Base.ProjectStatus.NONE]
        )
        if items_src_length != items_dst_length:
            return None, None, Localizer.get().re_translation_page_alert_not_equal

        # 加载关键词
        keywords = [
            v.strip()
            for v in self.keyword_text_edit.toPlainText().splitlines()
            if v.strip() != ""
        ]

        # 生成翻译数据
        for item_src, item_dst in zip(items_src, items_dst):
            if item_src.get_status() != Base.ProjectStatus.EXCLUDED and any(
                keyword in item_src.get_src() for keyword in keywords
            ):
                item_src.set_status(Base.ProjectStatus.NONE)
            elif item_dst.get_status() != Base.ProjectStatus.EXCLUDED:
                item_src.set_dst(item_dst.get_dst())
                item_src.set_name_dst(item_dst.get_name_dst())
                item_src.set_status(Base.ProjectStatus.PROCESSED_IN_PAST)
            else:
                item_src.set_dst(item_dst.get_dst())
                item_src.set_name_dst(item_dst.get_name_dst())
                item_src.set_status(Base.ProjectStatus.EXCLUDED)

        return project, items_src, ""
