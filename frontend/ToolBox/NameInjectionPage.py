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

from qfluentwidgets import PushButton
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import TransparentPushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.File.XLSX import XLSX
from module.File.RENPY import RENPY
from module.File.MESSAGEJSON import MESSAGEJSON
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheManager import CacheManager
from module.Cache.CacheProject import CacheProject
from module.Localizer.Localizer import Localizer
from widget.Separator import Separator
from widget.EmptyCard import EmptyCard
from widget.CommandBarCard import CommandBarCard

class NameInjectionPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入配置文件
        config = self.load_config()

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
        parent.addWidget(
            EmptyCard(
                title = Localizer.get().name_injection_page,
                description = Localizer.get().name_injection_page_desc,
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
        parent.addWidget(scroll_area_vbox_widget)

        # 添加控件
        scroll_area_vbox.addWidget(Separator())
        self.add_step_01(scroll_area_vbox, config, window)
        self.add_step_02(scroll_area_vbox, config, window)
        scroll_area_vbox.addStretch(1)

    # 底部
    def add_widget_foot(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

    # WiKi
    def add_command_bar_action_wiki(self, parent: CommandBarCard, config: dict, window: FluentWindow) -> None:
        push_button = TransparentPushButton(FluentIcon.HELP, Localizer.get().wiki)
        push_button.clicked.connect(lambda: QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha/wiki")))
        parent.add_widget(push_button)

    # 第一步
    def add_step_01(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def init(widget: EmptyCard) -> None:
            push_button = PushButton(FluentIcon.PLAY, Localizer.get().start)
            push_button.clicked.connect(lambda: self.step_01_clicked(window))
            widget.add_widget(push_button)

        widget = EmptyCard(
            title = Localizer.get().name_injection_page_step_01,
            description = Localizer.get().name_injection_page_step_01_desc,
            init = init,
        )
        widget.setFixedHeight(96)
        parent.addWidget(widget)

    # 第一步
    def add_step_02(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def init(widget: EmptyCard) -> None:
            push_button = PushButton(FluentIcon.SAVE_AS, Localizer.get().inject)
            push_button.clicked.connect(lambda: self.step_02_clicked(window))
            widget.add_widget(push_button)
            widget.setFixedHeight(128)

        parent.addWidget(EmptyCard(
            title = Localizer.get().name_injection_page_step_02,
            description = Localizer.get().name_injection_page_step_02_desc,
            init = init,
        ))

    # 第一步点击事件
    def step_01_clicked(self, window: FluentWindow) -> None:
        message_box = MessageBox(Localizer.get().alert, Localizer.get().alert_reset_translation, window)
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        # 点击取消，则不触发开始翻译事件
        if not message_box.exec():
            return None

        config = self.load_config()
        project, names, items = self.read_from_path_step_01(config)

        name_src_dict: dict[str, str] = {}
        for name, item in zip(names, items):
            if name != "" and len(name_src_dict.get(name, "")) < len(item.get_src()):
                name_src_dict[name] = item.get_src()

        items: list[CacheItem] = []
        for name, src in name_src_dict.items():
            items.append(CacheItem({
                "src": f"【{name}】\n{src}",
                "dst": f"【{name}】\n{src}",
                "row": len(items) + 1,
                "file_type": CacheItem.FileType.XLSX,
                "file_path": Localizer.get().path_result_name_injection,
                "translation_status": Base.TranslationStatus.UNTRANSLATED,
            }))

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
            "token": 0,
            "total_completion_tokens": 0,
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

    # 第二步点击事件
    def step_02_clicked(self, window: FluentWindow) -> None:
        # 读取角色姓名数据
        config = self.load_config()
        config["input_folder"] = config.get("output_folder")
        _, _, items = self.read_from_path_step_02(config)

        # 获取角色姓名映射表
        names: dict[str, str] = {}
        for item in items:
            src = ""
            for line in item.get_src().splitlines():
                line = line.strip()
                if line.startswith("【") and line.endswith("】"):
                    src = line.removeprefix("【").removesuffix("】")
                    break
                if line.startswith("[") and line.endswith("]"):
                    src = line.removeprefix("[").removesuffix("]")
                    break

            dst = ""
            for line in item.get_dst().splitlines():
                line = line.strip()
                if line.startswith("【") and line.endswith("】"):
                    dst = line.removeprefix("【").removesuffix("】")
                    break
                if line.startswith("[") and line.endswith("]"):
                    dst = line.removeprefix("[").removesuffix("]")
                    break

            if src != "" and dst != "" and src != dst:
                names[src] = dst

        # 有效性检查
        if len(names) == 0 or len(items) == 0:
            self.emit(Base.Event.APP_TOAST_SHOW, {
                "type": Base.ToastType.ERROR,
                "message": Localizer.get().alert_no_data,
            })
            return None

        # 读取游戏文本数据
        config = self.load_config()
        _, _, items = self.read_from_path_step_01(config)

        # 注入
        try:
            RENPY(config).write_name_and_items_to_path(names, items)
            MESSAGEJSON(config).write_name_and_items_to_path(names, items)
        except Exception as e:
            self.error(f"{Localizer.get().log_write_file_fail}", e)

        # 提示
        self.emit(Base.Event.APP_TOAST_SHOW, {
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().task_success,
        })

    # 读
    def read_from_path_step_01(self, config: dict) -> tuple[CacheProject, list[str], list[CacheItem]]:
        project: CacheProject = CacheProject({
            "id": f"{datetime.now().strftime("%Y%m%d_%H%M%S")}_{random.randint(100000, 999999)}",
        })

        names: list[str] = []
        items: list[CacheItem] = []
        try:
            paths: list[str] = []
            input_folder: str = config.get("input_folder")
            if os.path.isfile(input_folder):
                paths = [input_folder]
            elif os.path.isdir(input_folder):
                for root, _, files in os.walk(input_folder):
                    paths.extend([f"{root}/{file}".replace("\\", "/") for file in files])

            names_ex, items_ex = RENPY(config).read_name_and_items_from_path([path for path in paths if path.lower().endswith(".rpy")])
            names.extend(names_ex)
            items.extend(items_ex)
            names_ex, items_ex = MESSAGEJSON(config).read_name_and_items_from_path([path for path in paths if path.lower().endswith(".json")])
            names.extend(names_ex)
            items.extend(items_ex)
        except Exception as e:
            self.error(f"{Localizer.get().log_read_file_fail}", e)

        return project, names, items

    # 读
    def read_from_path_step_02(self, config: dict) -> tuple[CacheProject, list[str], list[CacheItem]]:
        project: CacheProject = CacheProject({
            "id": f"{datetime.now().strftime("%Y%m%d_%H%M%S")}_{random.randint(100000, 999999)}",
        })

        names: list[str] = []
        items: list[CacheItem] = []
        try:
            paths: list[str] = []
            input_folder: str = config.get("input_folder")
            if os.path.isfile(input_folder):
                paths = [input_folder]
            elif os.path.isdir(input_folder):
                for root, _, files in os.walk(input_folder):
                    paths.extend([f"{root}/{file}".replace("\\", "/") for file in files])

            items.extend(XLSX(config).read_from_path([path for path in paths if path.lower().endswith(".xlsx")]))
        except Exception as e:
            self.error(f"{Localizer.get().log_read_file_fail}", e)

        items = [
            v for v in items
            if v.get_file_path() == Localizer.get().path_result_name_injection
        ]

        return project, names, items