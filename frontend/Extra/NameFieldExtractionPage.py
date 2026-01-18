import time

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import PushButton
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import TransparentPushButton

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.Storage.ItemStore import ItemStore
from module.Storage.ProjectStore import ProjectStore
from widget.CommandBarCard import CommandBarCard
from widget.EmptyCard import EmptyCard


class NameFieldExtractionPage(QWidget, Base):
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
                title=Localizer.get().name_field_extraction_page,
                description=Localizer.get().name_field_extraction_page_desc,
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

        # 添加控件
        self.add_step_01(scroll_area_vbox, config, window)
        self.add_step_02(scroll_area_vbox, config, window)
        scroll_area_vbox.addStretch(1)

    # 底部
    def add_widget_foot(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.add_stretch(1)
        self.add_command_bar_action_wiki(self.command_bar_card, config, window)

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

    # 第一步
    def add_step_01(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: EmptyCard) -> None:
            push_button = PushButton(FluentIcon.PLAY, Localizer.get().start)
            push_button.clicked.connect(lambda: self.step_01_clicked(window))
            widget.add_widget(push_button)

        widget = EmptyCard(
            title=Localizer.get().name_field_extraction_page_step_01,
            description=Localizer.get().name_field_extraction_page_step_01_desc,
            init=init,
        )
        parent.addWidget(widget)

    # 第一步
    def add_step_02(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: EmptyCard) -> None:
            push_button = PushButton(FluentIcon.SAVE_AS, Localizer.get().generate)
            push_button.clicked.connect(lambda: self.step_02_clicked(window))
            widget.add_widget(push_button)

        parent.addWidget(
            EmptyCard(
                title=Localizer.get().name_field_extraction_page_step_02,
                description=Localizer.get().name_field_extraction_page_step_02_desc,
                init=init,
            )
        )

    # 第一步点击事件
    def step_01_clicked(self, window: FluentWindow) -> None:
        message_box = MessageBox(
            Localizer.get().alert, Localizer.get().alert_reset_translation, window
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        # 点击取消，则不触发开始翻译事件
        if not message_box.exec():
            return None

        # 读取文件
        config = Config().load()
        project, items = FileManager(config).read_from_path()
        items = [
            v
            for v in items
            if v.get_file_type() in (Item.FileType.MESSAGEJSON, Item.FileType.RENPY)
        ]

        # 构建姓名字典
        name_src_dict: dict[str, str] = {}
        for item in items:
            name: str = item.get_name_src()
            if (
                isinstance(name, str)
                and name != ""
                and len(name_src_dict.get(name, "")) < len(item.get_src())
            ):
                name_src_dict[name] = item.get_src()

        items: list[Item] = []
        for name, src in name_src_dict.items():
            items.append(
                Item.from_dict(
                    {
                        "src": f"【{name}】\n{src}",
                        "dst": f"【{name}】\n{src}",
                        "row": len(items) + 1,
                        "file_type": Item.FileType.XLSX,
                        "file_path": Localizer.get().path_result_name_field_extraction,
                        "status": Base.ProjectStatus.NONE,
                    }
                )
            )

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

        # 写入缓存文件
        item_store = ItemStore.get(config.output_folder)
        project_store = ProjectStore.get(config.output_folder)
        item_store.set_items(items)
        project_store.set_project(project)

        window.switchTo(window.task_page)
        self.emit(
            Base.Event.TRANSLATION_RUN,
            {
                "status": Base.ProjectStatus.PROCESSING,
            },
        )

    # 第二步点击事件
    def step_02_clicked(self, window: FluentWindow) -> None:
        # 读取文件
        config = Config().load()
        config.input_folder = config.output_folder
        _, items = FileManager(config).read_from_path()
        items = [
            v
            for v in items
            if v.get_file_path() == Localizer.get().path_result_name_field_extraction
        ]

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

            if src != "" and dst != "":
                names[src] = dst

        # 有效性检查
        if len(names) == 0 or len(items) == 0:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().alert_no_data,
                },
            )
            return None

        # 写入配置文件
        config = Config().load()
        config.glossary_data = config.glossary_data + [
            {
                "src": src,
                "dst": dst,
                "info": "",
                "regex": False,
            }
            for src, dst in names.items()
        ]
        config.glossary_data = list(
            {v.get("src"): v for v in config.glossary_data}.values()
        )
        config.save()

        # 术语表刷新事件
        self.emit(Base.Event.GLOSSARY_REFRESH, {})

        # 切换页面
        window.switchTo(window.glossary_page)

        # 提示
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().task_success,
            },
        )
