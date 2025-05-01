import time

from PyQt5.QtGui import QDesktopServices
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from base.EventManager import EventManager
from module.File.FileManager import FileManager
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheManager import CacheManager
from module.Cache.CacheProject import CacheProject
from module.Localizer.Localizer import Localizer
from widget.EmptyCard import EmptyCard
from widget.GroupCard import GroupCard
from widget.CommandBarCard import CommandBarCard

class ReTranslationPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入配置文件
        config = self.load_config()

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget_header(self.vbox, config, window)
        self.add_widget_body(self.vbox, config, window)
        self.add_widget_footer(self.vbox, config, window)

    # 头部
    def add_widget_header(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        parent.addWidget(
            EmptyCard(
                title = Localizer.get().re_translation_page,
                description = Localizer.get().re_translation_page_desc,
                init = None,
            )
        )

    # 主体
    def add_widget_body(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient = Qt.Orientation.Vertical)
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        parent.addWidget(scroll_area)

        def init(widget: GroupCard) -> None:
            self.keyword_text_edit = PlainTextEdit(self)
            self.keyword_text_edit.setPlaceholderText(Localizer.get().re_translation_page_white_list_placeholder)
            widget.addWidget(self.keyword_text_edit)

        self.keyword_text_edit: PlainTextEdit = None
        scroll_area_vbox.addWidget(
            GroupCard(
                title = Localizer.get().re_translation_page_white_list,
                description = Localizer.get().re_translation_page_white_list_desc,
                init = init,
            )
        )

    # 底部
    def add_widget_footer(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.set_minimum_width(512)
        self.add_command_bar_action_start(self.command_bar_card, config, window)
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

    # 开始
    def add_command_bar_action_start(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:

        def triggered() -> None:
            message_box = MessageBox(Localizer.get().alert, Localizer.get().alert_reset_translation, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            # 点击取消，则不触发开始翻译事件
            if not message_box.exec():
                return None

            # 生成翻译数据
            project, items_single, error_message = self.process_single()
            if error_message != "":
                self.emit(Base.Event.APP_TOAST_SHOW, {
                    "type": Base.ToastType.ERROR,
                    "message": error_message,
                })
                return None
            project, items_double, error_message = self.process_double()
            if error_message != "":
                self.emit(Base.Event.APP_TOAST_SHOW, {
                    "type": Base.ToastType.ERROR,
                    "message": error_message,
                })
                return None

            # 合并翻译数据
            items = items_single + items_double

            # 有效性检查
            items_lenght = len([v for v in items if v.get_status() == Base.TranslationStatus.UNTRANSLATED])
            if items_lenght == 0:
                self.emit(Base.Event.APP_TOAST_SHOW, {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().alert_no_data,
                })
                return None

            # 设置项目数据
            project.set_status(Base.TranslationStatus.TRANSLATING)
            project.set_extras({
                "start_time": time.time(),
                "total_line": len([item for item in items if item.get_status() == Base.TranslationStatus.UNTRANSLATED]),
                "line": 0,
                "total_tokens": 0,
                "total_output_tokens": 0,
                "time": 0,
            })

            # 写入缓存文件
            CacheManager(tick = False).save_to_file(
                project = project,
                items = items,
                output_folder = config.get("output_folder"),
            )

            window.switchTo(window.translation_page)
            self.emit(Base.Event.TRANSLATION_START, {
                "status": Base.TranslationStatus.TRANSLATING,
            })

        parent.add_action(
            Action(
                FluentIcon.PLAY,
                Localizer.get().start,
                parent,
                triggered = triggered,
            ),
        )

    # WiKi
    def add_command_bar_action_wiki(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:
        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki")))
        parent.add_widget(push_button)

    # 处理单文件部分
    def process_single(self) -> tuple[CacheProject, list[CacheItem], str]:
        # 读取译文
        config = self.load_config()
        config["input_folder"] = f"{config.get("input_folder")}/dst"
        project, items_dst = FileManager(config).read_from_path()
        items_dst = [
            v for v in items_dst
            if v.get_file_type() in (
                CacheItem.FileType.XLSX,
                CacheItem.FileType.WOLFXLSX,
                CacheItem.FileType.RENPY,
                CacheItem.FileType.TRANS,
                CacheItem.FileType.KVJSON,
            )
        ]
        items_dst.sort(key = lambda item: (item.get_file_path(), item.get_tag(), item.get_row()))

        # 加载关键词
        keywords = [
            v.strip()
            for v in self.keyword_text_edit.toPlainText().splitlines()
            if v.strip() != ""
        ]

        # 生成翻译数据
        for item_dst in items_dst:
            if item_dst.get_status() != Base.TranslationStatus.EXCLUDED and any(keyword in item_dst.get_src() for keyword in keywords):
                item_dst.set_status(Base.TranslationStatus.UNTRANSLATED)
            elif item_dst.get_status() != Base.TranslationStatus.EXCLUDED:
                item_dst.set_status(Base.TranslationStatus.TRANSLATED_IN_PAST)
            else:
                item_dst.set_status(Base.TranslationStatus.EXCLUDED)

        return project, items_dst, ""

    # 处理双文件部分
    def process_double(self) -> tuple[CacheProject, list[CacheItem], str]:
        # 读取译文
        config = self.load_config()
        config["input_folder"] = f"{config.get("input_folder")}/dst"
        project, items_dst = FileManager(config).read_from_path()
        items_dst = [
            v for v in items_dst
            if v.get_file_type() in (
                CacheItem.FileType.MD,
                CacheItem.FileType.TXT,
                CacheItem.FileType.ASS,
                CacheItem.FileType.SRT,
                CacheItem.FileType.EPUB,
                CacheItem.FileType.MESSAGEJSON,
            )
        ]
        items_dst.sort(key = lambda item: (item.get_file_path(), item.get_tag(), item.get_row()))

        # 读取原文
        config = self.load_config()
        config["input_folder"] = f"{config.get("input_folder")}/src"
        project, items_src = FileManager(config).read_from_path()
        items_src = [
            v for v in items_src
            if v.get_file_type() in (
                CacheItem.FileType.MD,
                CacheItem.FileType.TXT,
                CacheItem.FileType.ASS,
                CacheItem.FileType.SRT,
                CacheItem.FileType.EPUB,
                CacheItem.FileType.MESSAGEJSON,
            )
        ]
        items_src.sort(key = lambda item: (item.get_file_path(), item.get_tag(), item.get_row()))

        # 有效性检查
        items_src_length = len([v for v in items_src if v.get_status() == Base.TranslationStatus.UNTRANSLATED])
        items_dst_length = len([v for v in items_dst if v.get_status() == Base.TranslationStatus.UNTRANSLATED])
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
            if item_src.get_status() != Base.TranslationStatus.EXCLUDED and any(keyword in item_src.get_src() for keyword in keywords):
                item_src.set_status(Base.TranslationStatus.UNTRANSLATED)
            elif item_dst.get_status() != Base.TranslationStatus.EXCLUDED:
                item_src.set_dst(item_dst.get_dst())
                item_src.set_name_dst(item_dst.get_name_dst())
                item_src.set_status(Base.TranslationStatus.TRANSLATED_IN_PAST)
            else:
                item_src.set_dst(item_dst.get_dst())
                item_src.set_name_dst(item_dst.get_name_dst())
                item_src.set_status(Base.TranslationStatus.EXCLUDED)

        return project, items_src, ""