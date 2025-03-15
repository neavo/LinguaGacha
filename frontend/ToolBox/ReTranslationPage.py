import os
import time
import random
from datetime import datetime

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
from module.File.MD import MD
from module.File.SRT import SRT
from module.File.TXT import TXT
from module.File.ASS import ASS
from module.File.EPUB import EPUB
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
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)
        scroll_area = SingleDirectionScrollArea(orient = Qt.Vertical)
        scroll_area.setWidgetResizable(True)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.enableTransparentBackground()
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
            message_box = MessageBox(Localizer.get().alert, Localizer.get().re_translation_page_alert_start, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            # 点击取消，则不触发开始翻译事件
            if not message_box.exec():
                return None

            # 加载译文
            config = self.load_config()
            config["input_folder"] = f"{config.get("input_folder")}/dst"
            project, items_dst = self.read_from_path(config)
            items_dst.sort(key = lambda item: (item.get_file_path(), item.get_tag(), item.get_row()))

            # 加载原文
            config = self.load_config()
            config["input_folder"] = f"{config.get("input_folder")}/src"
            project, items_src = self.read_from_path(config)
            items_src.sort(key = lambda item: (item.get_file_path(), item.get_tag(), item.get_row()))

            # 有效性检查
            if len(items_src) != len(items_dst):
                self.emit(Base.Event.APP_TOAST_SHOW, {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().re_translation_page_alert_not_equal,
                })
                return None

            # 加载关键词
            keywords = [
                v.strip()
                for v in self.keyword_text_edit.toPlainText().splitlines()
                if v.strip() != ""
            ]

            # 生成翻译数据
            for item_src, item_dst in zip(items_src, items_dst):
                if item_src.get_status() == Base.TranslationStatus.UNTRANSLATED and any(keyword in item_src.get_src() for keyword in keywords):
                    item_src.set_status(Base.TranslationStatus.UNTRANSLATED)
                else:
                    item_src.set_dst(item_dst.get_dst())
                    item_src.set_status(Base.TranslationStatus.EXCLUDED)

            # 设置项目数据
            project.set_status(Base.TranslationStatus.TRANSLATING)
            project.set_extras({
                "start_time": time.time(),
                "total_line": len([item for item in items_dst if item.get_status() == Base.TranslationStatus.UNTRANSLATED]),
                "line": 0,
                "token": 0,
                "total_completion_tokens": 0,
                "time": 0,
            })

            # 写入缓存文件
            CacheManager(tick = False).save_to_file(
                project = project,
                items = items_src,
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
        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().pre_translation_replacement_page_wiki)
        push_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki")))
        parent.add_widget(push_button)

    # 读
    def read_from_path(self, config: dict) -> tuple[CacheProject, list[CacheItem]]:
        project: CacheProject = CacheProject({
            "id": f"{datetime.now().strftime("%Y%m%d_%H%M%S")}_{random.randint(100000, 999999)}",
        })

        items: list[CacheItem] = []
        try:
            paths: list[str] = []
            input_folder: str = config.get("input_folder")
            if os.path.isfile(input_folder):
                paths = [input_folder]
            elif os.path.isdir(input_folder):
                for root, _, files in os.walk(input_folder):
                    paths.extend([f"{root}/{file}".replace("\\", "/") for file in files])

            items.extend(MD(config).read_from_path([path for path in paths if path.lower().endswith(".md")]))
            items.extend(TXT(config).read_from_path([path for path in paths if path.lower().endswith(".txt")]))
            items.extend(ASS(config).read_from_path([path for path in paths if path.lower().endswith(".ass")]))
            items.extend(SRT(config).read_from_path([path for path in paths if path.lower().endswith(".srt")]))
            items.extend(EPUB(config).read_from_path([path for path in paths if path.lower().endswith(".epub")]))
        except Exception as e:
            self.error(f"{Localizer.get().log_read_file_fail}", e)

        return project, items