import json
from functools import partial

from frontend.Project.ModelEditPage import ModelEditPage
from PyQt5.QtCore import QMimeData
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QDrag
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import PrimaryDropDownPushButton
from qfluentwidgets import RoundMenu

from base.Base import Base
from frontend.Project.ArgsEditPage import ArgsEditPage
from model.Model import ModelType
from model.ModelManager import ModelManager
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard

class ModelPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入配置并初始化模型
        config = Config().load()
        config.initialize_models()
        config.save()

        # 设置主容器
        self.vbox = QVBoxLayout(self)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24)

        # 添加控件
        self.add_widget(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

        # 完成事件
        self.subscribe(Base.Event.APITEST_DONE, self.model_test_done)

    # 执行接口测试
    def model_test_start(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        self.emit(Base.Event.APITEST_RUN, {
            "model_id": model_id,
        })

    # 接口测试完成
    def model_test_done(self, event: Base.Event, data: dict) -> None:
        self.emit(Base.Event.TOAST, {
            "type": Base.ToastType.SUCCESS if data.get("result", True) else Base.ToastType.ERROR,
            "message": data.get("result_msg", "")
        })

    # 添加模型
    def add_model(self, model_type: ModelType, widget: FlowCard, window: FluentWindow) -> None:
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 添加新模型
        new_model = manager.add_model(model_type)

        # 同步回 Config
        config.models = manager.get_models_as_dict()
        config.save()

        # 更新控件
        self.update_model_widgets(widget, window)

    # 删除模型
    def delete_model(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 删除模型
        if manager.delete_model(model_id):
            # 如果删除的是激活模型，更新激活 ID
            if config.activate_model_id == model_id:
                active_model = manager.get_active_model()
                config.activate_model_id = active_model.id if active_model else ""

            # 同步回 Config
            config.models = manager.get_models_as_dict()
            config.save()

        # 更新控件
        self.update_model_widgets(widget, window)

    # 激活模型
    def activate_model(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        config = Config().load()
        config.set_active_model_id(model_id)
        config.save()

        # 更新控件
        self.update_model_widgets(widget, window)

    # 显示编辑模型对话框
    def show_model_edit_page(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        ModelEditPage(model_id, window).exec()

        # 激活模型
        config = Config().load()
        config.set_active_model_id(model_id)
        config.save()

        # 更新控件
        self.update_model_widgets(widget, window)

    # 显示编辑参数对话框
    def show_args_edit_page(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        ArgsEditPage(model_id, window).exec()

    # 重置预设模型
    def reset_preset_model(self, model_id: str, widget: FlowCard, window: FluentWindow) -> None:
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 重置模型
        if manager.reset_preset_model(model_id):
            # 同步回 Config
            config.models = manager.get_models_as_dict()
            config.save()

        # 更新控件
        self.update_model_widgets(widget, window)

    # 根据模型类型获取按钮样式类
    def get_button_style(self, model_type: str, is_active: bool) -> str:
        """根据模型类型和激活状态返回样式"""
        # 基础样式由 QFluentWidget 处理，这里不做额外处理
        return ""

    # 更新模型控件
    def update_model_widgets(self, widget: FlowCard, window: FluentWindow) -> None:
        config = Config().load()
        models = config.models or []

        widget.take_all_widgets()
        for model_data in models:
            model_id = model_data.get("id", "")
            model_name = model_data.get("name", "")
            model_type = model_data.get("type", "PRESET")
            is_active = model_id == config.activate_model_id

            # 根据激活状态选择按钮类型
            if is_active:
                drop_down_push_button = PrimaryDropDownPushButton(model_name)
            else:
                drop_down_push_button = DropDownPushButton(model_name)

            drop_down_push_button.setFixedWidth(192)
            drop_down_push_button.setContentsMargins(4, 0, 4, 0)
            widget.add_widget(drop_down_push_button)

            menu = RoundMenu("", drop_down_push_button)

            # 激活
            menu.addAction(
                Action(
                    FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                    Localizer.get().model_page_activate,
                    triggered=partial(self.activate_model, model_id, widget, window),
                )
            )
            menu.addSeparator()

            # 编辑
            menu.addAction(
                Action(
                    FluentIcon.EDIT,
                    Localizer.get().model_page_edit,
                    triggered=partial(self.show_model_edit_page, model_id, widget, window),
                )
            )
            menu.addSeparator()

            # 参数
            menu.addAction(
                Action(
                    FluentIcon.DEVELOPER_TOOLS,
                    Localizer.get().model_page_args,
                    triggered=partial(self.show_args_edit_page, model_id, widget, window),
                )
            )
            menu.addSeparator()

            # 测试
            menu.addAction(
                Action(
                    FluentIcon.SEND,
                    Localizer.get().model_page_test,
                    triggered=partial(self.model_test_start, model_id, widget, window),
                )
            )
            menu.addSeparator()

            # 预设模型：重置；自定义模型：删除
            if model_type == ModelType.PRESET.value:
                menu.addAction(
                    Action(
                        FluentIcon.SYNC,
                        Localizer.get().model_page_reset,
                        triggered=partial(self.reset_preset_model, model_id, widget, window),
                    )
                )
            else:
                menu.addAction(
                    Action(
                        FluentIcon.DELETE,
                        Localizer.get().model_page_delete,
                        triggered=partial(self.delete_model, model_id, widget, window),
                    )
                )

            drop_down_push_button.setMenu(menu)

    # 添加控件
    def add_widget(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: FlowCard) -> None:
            # 添加新增按钮
            add_button = DropDownPushButton(Localizer.get().add)
            add_button.setIcon(FluentIcon.ADD_TO)
            add_button.setContentsMargins(4, 0, 4, 0)
            widget.add_widget_to_head(add_button)

            menu = RoundMenu("", add_button)
            menu.addAction(
                Action(
                    Localizer.get().model_page_add_google,
                    triggered=partial(self.add_model, ModelType.CUSTOM_GOOGLE, widget, window)
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    Localizer.get().model_page_add_openai,
                    triggered=partial(self.add_model, ModelType.CUSTOM_OPENAI, widget, window)
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    Localizer.get().model_page_add_anthropic,
                    triggered=partial(self.add_model, ModelType.CUSTOM_ANTHROPIC, widget, window)
                )
            )
            add_button.setMenu(menu)

            # 更新控件
            self.update_model_widgets(widget, window)

        self.flow_card = FlowCard(
            parent=self,
            title=Localizer.get().model_page_widget_title,
            description=Localizer.get().model_page_widget_content,
            init=init,
        )
        parent.addWidget(self.flow_card)
