from functools import partial

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import PrimaryDropDownPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Model.ModelAdvancedSettingPage import ModelAdvancedSettingPage
from frontend.Model.ModelBasicSettingPage import ModelBasicSettingPage
from frontend.Model.ModelTaskSettingPage import ModelTaskSettingPage
from model.Model import ModelType
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.ModelManager import ModelManager
from widget.FlowCard import FlowCard


# ==================== 图标常量 ====================

ICON_ADD_MODEL: BaseIcon = BaseIcon.PLUS  # 添加模型按钮
ICON_ACTIVATE_MODEL: BaseIcon = BaseIcon.CHECK  # 模型操作：激活
ICON_OPEN_BASIC_SETTINGS: BaseIcon = BaseIcon.SETTINGS  # 模型操作：打开基础设置
ICON_OPEN_TASK_SETTINGS: BaseIcon = BaseIcon.LIST_TODO  # 模型操作：打开任务设置
ICON_OPEN_ADVANCED_SETTINGS: BaseIcon = BaseIcon.CODE  # 模型操作：打开高级设置
ICON_RESET_MODEL: BaseIcon = BaseIcon.REFRESH_CW  # 预设模型操作：重置到初始状态
ICON_DELETE_MODEL: BaseIcon = BaseIcon.TRASH_2  # 自定义模型操作：删除
ICON_REORDER_MODEL: BaseIcon = BaseIcon.ARROW_DOWN_UP  # 模型操作：排序
ICON_MOVE_UP: BaseIcon = BaseIcon.CHEVRON_UP  # 模型操作：上移
ICON_MOVE_DOWN: BaseIcon = BaseIcon.CHEVRON_DOWN  # 模型操作：下移
ICON_MOVE_TOP: BaseIcon = BaseIcon.CHEVRON_FIRST  # 模型操作：置顶
ICON_MOVE_BOTTOM: BaseIcon = BaseIcon.CHEVRON_LAST  # 模型操作：置底


class ModelPage(Base, QWidget):
    """模型管理页面，将模型分为4类显示在不同卡片中"""

    # 各模型类型的品牌色
    BRAND_COLORS = {
        ModelType.PRESET.value: "#6B7280",  # 灰色 - 预设模型
        ModelType.CUSTOM_GOOGLE.value: "#4285F4",  # Google 蓝
        ModelType.CUSTOM_OPENAI.value: "#10A37F",  # OpenAI 绿
        ModelType.CUSTOM_ANTHROPIC.value: "#D97757",  # Anthropic 橙
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
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.INFO,
                    "message": Localizer.get().model_page_migrated_toast.replace(
                        "{COUNT}", str(migrated_count)
                    ),
                },
            )

        # 设置滚动区域
        self.scroll_area = SingleDirectionScrollArea(
            self, orient=Qt.Orientation.Vertical
        )
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.enableTransparentBackground()
        # self.scroll_area.setSmoothMode(SmoothMode.NO_SMOOTH)  # 禁用平滑滚动以提升性能

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

    def add_category_cards(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
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
        self.category_cards[ModelType.CUSTOM_ANTHROPIC.value] = (
            self.create_category_card(
                parent=parent,
                model_type=ModelType.CUSTOM_ANTHROPIC,
                title=Localizer.get().model_page_category_anthropic_title,
                description=Localizer.get().model_page_category_anthropic_desc,
                accent_color=self.BRAND_COLORS[ModelType.CUSTOM_ANTHROPIC.value],
                window=window,
                show_add_button=True,
            )
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
                add_button.setIcon(ICON_ADD_MODEL)
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
            self.update_category_card(
                card,
                model_type,
                models_by_type[model_type],
                config.activate_model_id,
            )

    def update_category_card(
        self,
        card: FlowCard,
        model_type: str,
        models: list[dict],
        active_model_id: str,
    ) -> None:
        """更新单个分类卡片的模型列表"""
        card.take_all_widgets()

        for row_index, model_data in enumerate(models):
            model_id = model_data.get("id", "")
            model_name = model_data.get("name", "")
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
                    ICON_ACTIVATE_MODEL,
                    Localizer.get().model_page_activate,
                    triggered=partial(self.activate_model, model_id),
                )
            )
            menu.addSeparator()

            # 基础设置
            menu.addAction(
                Action(
                    ICON_OPEN_BASIC_SETTINGS,
                    Localizer.get().basic_settings,
                    triggered=partial(self.show_model_basic_setting_page, model_id),
                )
            )
            menu.addSeparator()

            # 任务设置
            menu.addAction(
                Action(
                    ICON_OPEN_TASK_SETTINGS,
                    Localizer.get().model_page_task_setting,
                    triggered=partial(self.show_model_task_setting_page, model_id),
                )
            )
            menu.addSeparator()

            # 高级设置
            menu.addAction(
                Action(
                    ICON_OPEN_ADVANCED_SETTINGS,
                    Localizer.get().model_page_advanced_setting,
                    triggered=partial(self.show_advanced_edit_page, model_id),
                )
            )
            menu.addSeparator()

            # 重置模型/删除模型
            if model_type == ModelType.PRESET.value:
                menu.addAction(
                    Action(
                        ICON_RESET_MODEL,
                        Localizer.get().model_page_reset,
                        triggered=partial(self.reset_preset_model, model_id),
                    )
                )
            else:
                menu.addAction(
                    Action(
                        ICON_DELETE_MODEL,
                        Localizer.get().model_page_delete,
                        triggered=partial(self.delete_model, model_id),
                    )
                )

            menu.addSeparator()
            self.add_reorder_actions_to_menu(
                menu=menu,
                model_type=model_type,
                model_id=model_id,
                row_index=row_index,
                total_count=len(models),
            )

            button.setMenu(menu)
            card.add_widget(button)

    def add_reorder_actions_to_menu(
        self,
        menu: RoundMenu,
        model_type: str,
        model_id: str,
        row_index: int,
        total_count: int,
    ) -> None:
        """向模型菜单添加排序子菜单。"""
        can_move_up = row_index > 0
        can_move_down = row_index < total_count - 1

        reorder_menu = RoundMenu(Localizer.get().model_page_adjust_order, menu)
        reorder_menu.setIcon(ICON_REORDER_MODEL)

        move_up_action = Action(
            ICON_MOVE_UP,
            Localizer.get().move_up,
            triggered=partial(
                self.reorder_model_in_group,
                model_type,
                model_id,
                ModelManager.ReorderOperation.MOVE_UP,
            ),
        )
        move_up_action.setEnabled(can_move_up)
        reorder_menu.addAction(move_up_action)

        move_down_action = Action(
            ICON_MOVE_DOWN,
            Localizer.get().move_down,
            triggered=partial(
                self.reorder_model_in_group,
                model_type,
                model_id,
                ModelManager.ReorderOperation.MOVE_DOWN,
            ),
        )
        move_down_action.setEnabled(can_move_down)
        reorder_menu.addAction(move_down_action)
        reorder_menu.addSeparator()

        move_top_action = Action(
            ICON_MOVE_TOP,
            Localizer.get().move_top,
            triggered=partial(
                self.reorder_model_in_group,
                model_type,
                model_id,
                ModelManager.ReorderOperation.MOVE_TOP,
            ),
        )
        move_top_action.setEnabled(can_move_up)
        reorder_menu.addAction(move_top_action)

        move_bottom_action = Action(
            ICON_MOVE_BOTTOM,
            Localizer.get().move_bottom,
            triggered=partial(
                self.reorder_model_in_group,
                model_type,
                model_id,
                ModelManager.ReorderOperation.MOVE_BOTTOM,
            ),
        )
        move_bottom_action.setEnabled(can_move_down)
        reorder_menu.addAction(move_bottom_action)

        menu.addMenu(reorder_menu)

    @staticmethod
    def collect_group_model_ids(models: list[dict], model_type: str) -> list[str]:
        """
        提取指定分组的模型 ID 列表。
        为什么要单独提取：后续重排只允许作用于单一分组。
        """
        result: list[str] = []
        for model_data in models:
            current_type = model_data.get("type", ModelType.PRESET.value)
            if current_type == model_type:
                model_id = model_data.get("id", "")
                if model_id:
                    result.append(model_id)
        return result

    # PySide6 下 QAction.triggered 会携带 checked 参数，回调需兼容以避免 TypeError。
    def model_test_start(self, model_id: str, checked: bool = False) -> None:
        """执行接口测试"""
        del checked
        self.emit(Base.Event.APITEST_RUN, {"model_id": model_id})

    # PySide6 下 QAction.triggered 会携带 checked 参数，回调需兼容以避免 TypeError。
    def reorder_model_in_group(
        self,
        model_type: str,
        model_id: str,
        operation: ModelManager.ReorderOperation,
        checked: bool = False,
    ) -> None:
        """执行组内排序并持久化。"""
        del checked
        config = Config().load()
        models = config.models or []
        group_ids = self.collect_group_model_ids(models, model_type)
        reordered_group_ids = ModelManager.build_group_reordered_ids(
            group_ids,
            model_id,
            operation,
        )
        if reordered_group_ids == group_ids:
            return

        ordered_ids = ModelManager.build_global_ordered_ids_for_group(
            models,
            model_type,
            reordered_group_ids,
        )
        manager = ModelManager.get()
        manager.set_models(models)
        manager.reorder_models(ordered_ids)
        config.models = manager.get_models_as_dict()
        config.save()
        self.refresh_all_categories()

    def model_test_done(self, event: Base.Event, data: dict) -> None:
        """接口测试完成"""
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS
                if data.get("result", True)
                else Base.ToastType.ERROR,
                "message": data.get("result_msg", ""),
            },
        )

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

    def delete_model(self, model_id: str, checked: bool = False) -> None:
        """删除模型"""
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        # 检查是否为最后一个该类型的模型
        target_model_data = config.get_model(model_id)
        if target_model_data:
            model_name = str(target_model_data.get("name", "")).strip() or model_id
            model_type = target_model_data.get("type", "")
            # 统计同类型模型数量
            same_type_count = sum(
                1 for m in (config.models or []) if m.get("type") == model_type
            )
            if same_type_count <= 1:
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.WARNING,
                        "message": Localizer.get().model_page_delete_last_one_toast,
                    },
                )
                return
        else:
            model_name = model_id

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().alert_confirm_delete_data,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
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

    def activate_model(self, model_id: str, checked: bool = False) -> None:
        """激活模型"""
        config = Config().load()
        config.set_active_model_id(model_id)
        config.save()

        # 刷新显示
        self.refresh_all_categories()

    def show_model_basic_setting_page(
        self, model_id: str, checked: bool = False
    ) -> None:
        """显示基础设置对话框"""
        ModelBasicSettingPage(model_id, self.window).exec()

        # 刷新显示
        self.refresh_all_categories()

    def show_model_task_setting_page(
        self, model_id: str, checked: bool = False
    ) -> None:
        """显示任务设置对话框"""
        ModelTaskSettingPage(model_id, self.window).exec()

        # 刷新显示
        self.refresh_all_categories()

    def show_advanced_edit_page(self, model_id: str, checked: bool = False) -> None:
        """显示编辑参数对话框"""
        ModelAdvancedSettingPage(model_id, self.window).exec()

    def reset_preset_model(self, model_id: str, checked: bool = False) -> None:
        """重置预设模型"""
        del checked
        config = Config().load()
        manager = ModelManager.get()
        manager.set_models(config.models or [])

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().alert_confirm_reset_data,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        # 重置模型
        if manager.reset_preset_model(model_id):
            # 同步回 Config
            config.models = manager.get_models_as_dict()
            config.save()

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().model_page_reset_success_toast,
                },
            )

        # 刷新显示
        self.refresh_all_categories()
