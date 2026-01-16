from functools import partial

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import PrimaryDropDownPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from frontend.Model.ModelAdvancedSettingPage import ModelAdvancedSettingPage
from frontend.Model.ModelEditPage import ModelEditPage
from model.Model import ModelType
from model.ModelManager import ModelManager
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard

class ModelPage(QWidget, Base):
    """模型管理页面，将模型分为4类显示在不同卡片中"""

    # 各模型类型的品牌色
    BRAND_COLORS = {
        ModelType.PRESET.value: "#6B7280",          # 灰色 - 预设模型
        ModelType.CUSTOM_GOOGLE.value: "#4285F4",   # Google 蓝
        ModelType.CUSTOM_OPENAI.value: "#10A37F",   # OpenAI 绿
        ModelType.CUSTOM_ANTHROPIC.value: "#D97757", # Anthropic 橙
    }

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.window = window

        # 存储各分类卡片的引用
        self.category_cards: dict[str, FlowCard] = {}

        # 载入配置并初始化模型
        config = Config().load()
        migrated_count = config.initialize_models()
        config.save()

        if migrated_count > 0:
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.INFO,
                "message": Localizer.get().model_page_migrated_toast.replace("{COUNT}", str(migrated_count)),
            })

        # 设置滚动区域
        self.scroll_area = SingleDirectionScrollArea(self, orient=Qt.Orientation.Vertical)
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        # 设置主容器
        self.scroll_widget = QWidget()
        self.scroll_widget.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.scroll_widget)
        self.vbox.setSpacing(12)
        self.vbox.setContentsMargins(24, 24, 24, 24)
        self.scroll_area.setWidget(self.scroll_widget)

        # 设置主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(self.scroll_area)

        # 添加4个分类卡片
        self.add_category_cards(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

        # 完成事件
        self.subscribe(Base.Event.APITEST_DONE, self.model_test_done)

    def add_category_cards(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        """添加4个分类卡片"""

        # 预设模型卡片
        self.category_cards[ModelType.PRESET.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.PRESET,
            title=Localizer.get().model_page_category_preset_title,
            description=Localizer.get().model_page_category_preset_desc,
            accent_color=self.BRAND_COLORS[ModelType.PRESET.value],
            window=window,
            show_add_button=False,  # 预设模型不能添加
        )

        # 自定义 Google 模型卡片
        self.category_cards[ModelType.CUSTOM_GOOGLE.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.CUSTOM_GOOGLE,
            title=Localizer.get().model_page_category_google_title,
            description=Localizer.get().model_page_category_google_desc,
            accent_color=self.BRAND_COLORS[ModelType.CUSTOM_GOOGLE.value],
            window=window,
            show_add_button=True,
        )

        # 自定义 OpenAI 模型卡片
        self.category_cards[ModelType.CUSTOM_OPENAI.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.CUSTOM_OPENAI,
            title=Localizer.get().model_page_category_openai_title,
            description=Localizer.get().model_page_category_openai_desc,
            accent_color=self.BRAND_COLORS[ModelType.CUSTOM_OPENAI.value],
            window=window,
            show_add_button=True,
        )

        # 自定义 Anthropic 模型卡片
        self.category_cards[ModelType.CUSTOM_ANTHROPIC.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.CUSTOM_ANTHROPIC,
            title=Localizer.get().model_page_category_anthropic_title,
            description=Localizer.get().model_page_category_anthropic_desc,
            accent_color=self.BRAND_COLORS[ModelType.CUSTOM_ANTHROPIC.value],
            window=window,
            show_add_button=True,
        )

        # 刷新所有分类的模型列表
        self.refresh_all_categories()

    def create_category_card(
        self,
        parent: QLayout,
        model_type: ModelType,
        title: str,
        description: str,
        accent_color: str,
        window: FluentWindow,
        show_add_button: bool,
    ) -> FlowCard:
        """创建单个分类卡片"""

        def init(widget: FlowCard) -> None:
            if show_add_button:
                add_button = PushButton(Localizer.get().add)
                add_button.setIcon(FluentIcon.ADD_TO)
                add_button.setContentsMargins(4, 0, 4, 0)
                add_button.clicked.connect(lambda: self.add_model(model_type, window))
                widget.add_widget_to_head(add_button)

        card = FlowCard(
            parent=self,
            title=title,
            description=description,
            accent_color=accent_color,
            init=init,
        )
        parent.addWidget(card)
        return card

    def refresh_all_categories(self) -> None:
        """刷新所有分类的模型列表"""
        config = Config().load()
        models = config.models or []

        # 按类型分组
        models_by_type: dict[str, list[dict]] = {
            ModelType.PRESET.value: [],
            ModelType.CUSTOM_GOOGLE.value: [],
            ModelType.CUSTOM_OPENAI.value: [],
            ModelType.CUSTOM_ANTHROPIC.value: [],
        }

        for model_data in models:
            model_type = model_data.get("type", ModelType.PRESET.value)
            if model_type in models_by_type:
                models_by_type[model_type].append(model_data)

        # 更新各分类卡片
        for model_type, card in self.category_cards.items():
            self.update_category_card(card, models_by_type[model_type], config.activate_model_id)

    def update_category_card(self, card: FlowCard, models: list[dict], active_model_id: str) -> None:
        """更新单个分类卡片的模型列表"""
        card.take_all_widgets()

        for model_data in models:
            model_id = model_data.get("id", "")
            model_name = model_data.get("name", "")
            model_type = model_data.get("type", "PRESET")
            is_active = model_id == active_model_id

            # 根据激活状态选择按钮类型
            if is_active:
                button = PrimaryDropDownPushButton(model_name)
            else:
                button = DropDownPushButton(model_name)

            button.setFixedWidth(192)
            button.setContentsMargins(4, 0, 4, 0)

            # 创建菜单
            menu = RoundMenu("", button)

            # 激活
            menu.addAction(
                Action(
                    FluentIcon.EXPRESSIVE_INPUT_ENTRY,
                    Localizer.get().model_page_activate,
                    triggered=partial(self.activate_model, model_id),
                )
            )
            menu.addSeparator()

            # 基础设置
            menu.addAction(
                Action(
                    FluentIcon.SETTING,
                    Localizer.get().model_page_edit,
                    triggered=partial(self.show_model_edit_page, model_id),
                )
            )
            menu.addSeparator()

            # 高级设置
            menu.addAction(
                Action(
                    FluentIcon.DEVELOPER_TOOLS,
                    Localizer.get().model_page_advanced,
                    triggered=partial(self.show_advanced_edit_page, model_id),
                )
            )
            menu.addSeparator()

            # 测试模型
            menu.addAction(
                Action(
                    FluentIcon.SEND,
                    Localizer.get().model_page_test,
                    triggered=partial(self.model_test_start, model_id),
                )
            )
            menu.addSeparator()

            # 重置模型/删除模型
            if model_type == ModelType.PRESET.value:
                menu.addAction(
                    Action(
                        FluentIcon.SYNC,
                        Localizer.get().model_page_reset,
                        triggered=partial(self.reset_preset_model, model_id),
                    )
                )
            else:
                menu.addAction(
                    Action(
                        FluentIcon.DELETE,
                        Localizer.get().model_page_delete,
                        triggered=partial(self.delete_model, model_id),
                    )
                )

            button.setMenu(menu)
            card.add_widget(button)

    def model_test_start(self, model_id: str) -> None:
        """执行接口测试"""
        self.emit(Base.Event.APITEST_RUN, {"model_id": model_id})

    def model_test_done(self, event: Base.Event, data: dict) -> None:
        """接口测试完成"""
        self.emit(Base.Event.TOAST, {
            "type": Base.ToastType.SUCCESS if data.get("result", True) else Base.ToastType.ERROR,
            "message": data.get("result_msg", "")
        })

    def add_model(self, model_type: ModelType, window: FluentWindow) -> None:
        """添加模型"""
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 添加新模型
        manager.add_model(model_type)

        # 同步回 Config
        config.models = manager.get_models_as_dict()
        config.save()

        # 刷新显示
        self.refresh_all_categories()

    def delete_model(self, model_id: str) -> None:
        """删除模型"""
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 检查是否为最后一个该类型的模型
        target_model_data = config.get_model(model_id)
        if target_model_data:
            model_type = target_model_data.get("type", "")
            # 统计同类型模型数量
            same_type_count = sum(1 for m in (config.models or []) if m.get("type") == model_type)
            if same_type_count <= 1:
                self.emit(Base.Event.TOAST, {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().model_page_delete_last_one_toast,
                })
                return

        # 删除模型
        if manager.delete_model(model_id):
            # 如果删除的是激活模型，更新激活 ID
            if config.activate_model_id == model_id:
                active_model = manager.get_active_model()
                config.activate_model_id = active_model.id if active_model else ""

            # 同步回 Config
            config.models = manager.get_models_as_dict()
            config.save()

        # 刷新显示
        self.refresh_all_categories()

    def activate_model(self, model_id: str) -> None:
        """激活模型"""
        config = Config().load()
        config.set_active_model_id(model_id)
        config.save()

        # 刷新显示
        self.refresh_all_categories()

    def show_model_edit_page(self, model_id: str) -> None:
        """显示编辑模型对话框"""
        ModelEditPage(model_id, self.window).exec()

        # 激活模型
        config = Config().load()
        config.set_active_model_id(model_id)
        config.save()

        # 刷新显示
        self.refresh_all_categories()

    def show_advanced_edit_page(self, model_id: str) -> None:
        """显示编辑参数对话框"""
        ModelAdvancedSettingPage(model_id, self.window).exec()

    def reset_preset_model(self, model_id: str) -> None:
        """重置预设模型"""
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 重置模型
        if manager.reset_preset_model(model_id):
            # 同步回 Config
            config.models = manager.get_models_as_dict()
            config.save()

            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().model_page_reset_success_toast,
            })

        # 刷新显示
        self.refresh_all_categories()
