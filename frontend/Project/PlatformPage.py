import os
from functools import partial

import rapidjson as json
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import PrimaryDropDownPushButton

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard
from frontend.Project.PlatformEditPage import PlatformEditPage
from frontend.Project.ArgsEditPage import ArgsEditPage

class PlatformPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 默认配置
        self.default = {
            "activate_platform": 0,
            "platforms": self.load_default_platforms(),
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 添加控件
        self.add_widget(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

        # 完成事件
        self.subscribe(Base.Event.PLATFORM_TEST_DONE, self.platform_test_done)

    # 执行接口测试
    def platform_test_start(self, id: int, widget: FlowCard, window: FluentWindow) -> None:
        # 载入配置文件
        if Base.WORK_STATUS == Base.Status.IDLE:
            # 更新运行状态
            Base.WORK_STATUS = Base.Status.API_TEST

            # 触发事件
            self.emit(Base.Event.PLATFORM_TEST_START, {
                "id": id,
            })
        else:
            self.emit(Base.Event.TOAST_SHOW, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().platform_page_api_test_doing,
            })

    # 接口测试完成
    def platform_test_done(self, event: int, data: dict) -> None:
        # 更新运行状态
        Base.WORK_STATUS = Base.Status.IDLE

        self.emit(Base.Event.TOAST_SHOW, {
            "type": Base.ToastType.SUCCESS if data.get("result", True) else Base.ToastType.ERROR,
            "message": data.get("result_msg", "")
        })

    # 加载默认平台数据
    def load_default_platforms(self) -> list[dict]:
        platforms = []
        platforms_path = f"./resource/platforms/{Localizer.get_app_language().lower()}/"
        for path in [file.path for file in os.scandir(platforms_path) if file.is_file() and file.name.endswith(".json")]:
            with open(path, "r", encoding = "utf-8-sig") as reader:
                platforms.append(json.load(reader))

        return sorted(platforms, key = lambda x: x.get("id"))

    # 添加接口
    def add_platform(self, item: dict, widget: FlowCard, window: FluentWindow) -> None:
        # 载入配置文件
        config = self.load_config()

        # 添加指定条目
        item["id"] = len(config.get("platforms", []))
        config["platforms"].append(item)

        # 保存配置文件
        self.save_config(config)

        # 更新控件
        self.update_custom_platform_widgets(widget, window)

    # 删除接口
    def delete_platform(self, id: int, widget: FlowCard, window: FluentWindow) -> None:
        # 载入配置文件
        config = self.load_config()

        # 删除指定条目
        for i, platform in enumerate(config.get("platforms", [])):
            if platform.get("id") == id:
                del config["platforms"][i]

                # 修正激活接口的ID
                if config.get("activate_platform", 0) == i:
                    config["activate_platform"] = 0
                elif config["activate_platform"] > i:
                    config["activate_platform"] = config["activate_platform"] - 1
                break

        # 修正条目id
        for i, platform in enumerate(sorted(config.get("platforms", []), key = lambda x: x.get("id"))):
            config["platforms"][i]["id"] = i

        # 保存配置文件
        self.save_config(config)

        # 更新控件
        self.update_custom_platform_widgets(widget, window)

    # 激活接口
    def activate_platform(self, id: int, widget: FlowCard, window: FluentWindow) -> None:
        config = self.load_config()
        config["activate_platform"] = id
        self.save_config(config)

        # 更新控件
        self.update_custom_platform_widgets(widget, window)

    # 显示编辑接口对话框
    def show_api_edit_page(self, id: int, widget: FlowCard, window: FluentWindow) -> None:
        PlatformEditPage(id, window).exec()

        # 更新控件
        self.update_custom_platform_widgets(widget, window)

    # 显示编辑参数对话框
    def show_args_edit_page(self, id: int, widget: FlowCard, window: FluentWindow) -> None:
        ArgsEditPage(id, window).exec()

    # 更新自定义平台控件
    def update_custom_platform_widgets(self, widget: FlowCard, window: FluentWindow) -> None:
        config = self.load_config()
        platforms = sorted(config.get("platforms"), key = lambda x: x.get("id", 0))

        widget.take_all_widgets()
        for item in platforms:
            if item.get("id", 0) != config.get("activate_platform", 0):
                drop_down_push_button = DropDownPushButton(item.get("name"))
            else:
                drop_down_push_button = PrimaryDropDownPushButton(item.get("name"))
            drop_down_push_button.setFixedWidth(192)
            drop_down_push_button.setContentsMargins(4, 0, 4, 0) # 左、上、右、下
            widget.add_widget(drop_down_push_button)

            menu = RoundMenu("", drop_down_push_button)
            menu.addAction(
                Action(
                    FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                    Localizer.get().platform_page_api_activate,
                    triggered = partial(self.activate_platform, item.get("id", 0), widget, window),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.EDIT,
                    Localizer.get().platform_page_api_edit,
                    triggered = partial(self.show_api_edit_page, item.get("id", 0), widget, window),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.DEVELOPER_TOOLS,
                    Localizer.get().platform_page_api_args,
                    triggered = partial(self.show_args_edit_page, item.get("id", 0), widget, window),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.SEND,
                    Localizer.get().platform_page_api_test,
                    triggered = partial(self.platform_test_start, item.get("id", 0), widget, window),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    FluentIcon.DELETE,
                    Localizer.get().platform_page_api_delete,
                    triggered = partial(self.delete_platform, item.get("id", 0), widget, window),
                )
            )
            drop_down_push_button.setMenu(menu)

    # 添加控件
    def add_widget(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: FlowCard) -> None:
            # 添加新增按钮
            add_button = DropDownPushButton(Localizer.get().add)
            add_button.setIcon(FluentIcon.ADD_TO)
            add_button.setContentsMargins(4, 0, 4, 0)
            widget.add_widget_to_head(add_button)

            menu = RoundMenu("", add_button)
            platforms = self.load_default_platforms()
            for i, item in enumerate(platforms):
                menu.addAction(Action(item.get("name"), triggered = partial(self.add_platform, item, widget, window)))
                menu.addSeparator() if i < len(platforms) - 1 else None
            add_button.setMenu(menu)

            # 更新控件
            self.update_custom_platform_widgets(widget, window)

        self.flow_card = FlowCard(
            Localizer.get().platform_page_widget_add_title,
            Localizer.get().platform_page_widget_add_content,
            init = init,
        )
        parent.addWidget(self.flow_card)