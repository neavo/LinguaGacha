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

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ModelApiClient import ModelApiClient
from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Model.ModelAdvancedSettingPage import ModelAdvancedSettingPage
from frontend.Model.ModelBasicSettingPage import ModelBasicSettingPage
from frontend.Model.ModelTaskSettingPage import ModelTaskSettingPage
from model.Api.ModelModels import ModelEntrySnapshot
from model.Api.ModelModels import ModelPageSnapshot
from model.Model import ModelType
from module.Localizer.Localizer import Localizer
from widget.FlowCard import FlowCard

# ==================== 图标常量 ====================

ICON_ADD_MODEL: BaseIcon = BaseIcon.PLUS  # 添加模型按钮
ICON_ACTIVATE_MODEL: BaseIcon = BaseIcon.CHECK  # 模型操作：激活
ICON_OPEN_BASIC_SETTINGS: BaseIcon = BaseIcon.SETTINGS  # 模型操作：打开基础设置
ICON_OPEN_TASK_SETTINGS: BaseIcon = BaseIcon.LIST_TODO  # 模型操作：打开任务设置
ICON_OPEN_ADVANCED_SETTINGS: BaseIcon = BaseIcon.CODE  # 模型操作：打开高级设置
ICON_RESET_MODEL: BaseIcon = BaseIcon.RECYCLE  # 预设模型操作：重置到初始状态
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
    REORDER_OPERATION_MOVE_UP: str = "MOVE_UP"
    REORDER_OPERATION_MOVE_DOWN: str = "MOVE_DOWN"
    REORDER_OPERATION_MOVE_TOP: str = "MOVE_TOP"
    REORDER_OPERATION_MOVE_BOTTOM: str = "MOVE_BOTTOM"

    def __init__(
        self,
        text: str,
        model_api_client: ModelApiClient,
        api_state_store: ApiStateStore,
        window: FluentWindow,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.window = window
        self.model_api_client = model_api_client
        self.api_state_store = api_state_store

        # 存储各分类卡片的引用
        self.category_cards: dict[str, FlowCard] = {}
        self.current_snapshot: ModelPageSnapshot = self.model_api_client.get_snapshot()

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
        self.add_category_cards(self.vbox)

        # 填充
        self.vbox.addStretch(1)

        # 完成事件
        self.subscribe(Base.Event.APITEST, self.model_test_done)

    def add_category_cards(self, parent: QLayout) -> None:
        """添加4个分类卡片"""

        # 预设模型卡片
        self.category_cards[ModelType.PRESET.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.PRESET,
            title=Localizer.get().model_page_category_preset_title,
            description=Localizer.get().model_page_category_preset_desc,
            accent_color=self.BRAND_COLORS[ModelType.PRESET.value],
            show_add_button=False,  # 预设模型不能添加
        )

        # 自定义 Google 模型卡片
        self.category_cards[ModelType.CUSTOM_GOOGLE.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.CUSTOM_GOOGLE,
            title=Localizer.get().model_page_category_google_title,
            description=Localizer.get().model_page_category_google_desc,
            accent_color=self.BRAND_COLORS[ModelType.CUSTOM_GOOGLE.value],
            show_add_button=True,
        )

        # 自定义 OpenAI 模型卡片
        self.category_cards[ModelType.CUSTOM_OPENAI.value] = self.create_category_card(
            parent=parent,
            model_type=ModelType.CUSTOM_OPENAI,
            title=Localizer.get().model_page_category_openai_title,
            description=Localizer.get().model_page_category_openai_desc,
            accent_color=self.BRAND_COLORS[ModelType.CUSTOM_OPENAI.value],
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
        show_add_button: bool,
    ) -> FlowCard:
        """创建单个分类卡片"""

        def init(widget: FlowCard) -> None:
            if show_add_button:
                add_button = PushButton(Localizer.get().add)
                add_button.setIcon(ICON_ADD_MODEL)
                add_button.setContentsMargins(4, 0, 4, 0)
                add_button.clicked.connect(lambda: self.add_model(model_type))
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
        models = self.current_snapshot.models

        # 按类型分组
        models_by_type: dict[str, list[ModelEntrySnapshot]] = {
            ModelType.PRESET.value: [],
            ModelType.CUSTOM_GOOGLE.value: [],
            ModelType.CUSTOM_OPENAI.value: [],
            ModelType.CUSTOM_ANTHROPIC.value: [],
        }

        for model_data in models:
            model_type = model_data.type
            if model_type in models_by_type:
                models_by_type[model_type].append(model_data)

        # 更新各分类卡片
        for model_type, card in self.category_cards.items():
            self.update_category_card(
                card,
                model_type,
                models_by_type[model_type],
                self.current_snapshot.active_model_id,
            )

    def refresh_snapshot(self, snapshot: ModelPageSnapshot | None = None) -> None:
        """统一刷新页面快照，避免各动作重复写回与重绘。"""

        if snapshot is None:
            self.current_snapshot = self.model_api_client.get_snapshot()
        else:
            self.current_snapshot = snapshot
        self.refresh_all_categories()

    def find_model(self, model_id: str) -> ModelEntrySnapshot | None:
        """从当前快照查找模型，保证各弹窗入口只读同一份页面状态。"""

        return next(
            (item for item in self.current_snapshot.models if item.id == model_id),
            None,
        )

    def update_category_card(
        self,
        card: FlowCard,
        model_type: str,
        models: list[ModelEntrySnapshot],
        active_model_id: str,
    ) -> None:
        """更新单个分类卡片的模型列表"""
        card.take_all_widgets()

        for row_index, model_data in enumerate(models):
            model_id = model_data.id
            model_name = model_data.name
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
                model_id=model_id,
                row_index=row_index,
                total_count=len(models),
            )

            button.setMenu(menu)
            card.add_widget(button)

    def add_reorder_actions_to_menu(
        self,
        menu: RoundMenu,
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
                model_id,
                self.REORDER_OPERATION_MOVE_UP,
            ),
        )
        move_up_action.setEnabled(can_move_up)
        reorder_menu.addAction(move_up_action)

        move_down_action = Action(
            ICON_MOVE_DOWN,
            Localizer.get().move_down,
            triggered=partial(
                self.reorder_model_in_group,
                model_id,
                self.REORDER_OPERATION_MOVE_DOWN,
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
                model_id,
                self.REORDER_OPERATION_MOVE_TOP,
            ),
        )
        move_top_action.setEnabled(can_move_up)
        reorder_menu.addAction(move_top_action)

        move_bottom_action = Action(
            ICON_MOVE_BOTTOM,
            Localizer.get().move_bottom,
            triggered=partial(
                self.reorder_model_in_group,
                model_id,
                self.REORDER_OPERATION_MOVE_BOTTOM,
            ),
        )
        move_bottom_action.setEnabled(can_move_down)
        reorder_menu.addAction(move_bottom_action)

        menu.addMenu(reorder_menu)

    # PySide6 下 QAction.triggered 会携带 checked 参数，回调需兼容以避免 TypeError。
    def reorder_model_in_group(
        self,
        model_id: str,
        operation: str,
        checked: bool = False,
    ) -> None:
        """执行组内排序并持久化。"""
        del checked
        self.refresh_snapshot(
            self.model_api_client.reorder_model(
                model_id,
                operation,
            )
        )

    def model_test_done(self, event: Base.Event, data: dict) -> None:
        """接口测试完成"""
        sub_event = data.get("sub_event")
        if sub_event not in (
            Base.SubEvent.DONE,
            Base.SubEvent.ERROR,
        ):
            return
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS
                if data.get("result", True)
                else Base.ToastType.ERROR,
                "message": data.get("result_msg", ""),
            },
        )

    def add_model(self, model_type: ModelType) -> None:
        """添加模型"""
        self.refresh_snapshot(self.model_api_client.add_model(model_type.value))

    def delete_model(self, model_id: str, checked: bool = False) -> None:
        """删除模型"""
        del checked
        target_model = self.find_model(model_id)
        if target_model is not None:
            same_type_count = sum(
                1
                for model in self.current_snapshot.models
                if model.type == target_model.type
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

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().alert_confirm_delete_data,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        self.refresh_snapshot(self.model_api_client.delete_model(model_id))

    def activate_model(self, model_id: str, checked: bool = False) -> None:
        """激活模型"""
        del checked
        self.refresh_snapshot(self.model_api_client.activate_model(model_id))

    def show_model_basic_setting_page(
        self, model_id: str, checked: bool = False
    ) -> None:
        """显示基础设置对话框"""
        del checked
        model = self.find_model(model_id)
        if model is None:
            return
        ModelBasicSettingPage(
            model,
            self.model_api_client,
            self.api_state_store,
            self.window,
        ).exec()

        self.refresh_snapshot()

    def show_model_task_setting_page(
        self, model_id: str, checked: bool = False
    ) -> None:
        """显示任务设置对话框"""
        del checked
        model = self.find_model(model_id)
        if model is None:
            return
        ModelTaskSettingPage(
            model,
            self.model_api_client,
            self.window,
        ).exec()

        self.refresh_snapshot()

    def show_advanced_edit_page(self, model_id: str, checked: bool = False) -> None:
        """显示编辑参数对话框"""
        del checked
        model = self.find_model(model_id)
        if model is None:
            return
        ModelAdvancedSettingPage(
            model,
            self.model_api_client,
            self.window,
        ).exec()
        self.refresh_snapshot()

    def reset_preset_model(self, model_id: str, checked: bool = False) -> None:
        """重置预设模型"""
        del checked

        message_box = MessageBox(
            Localizer.get().confirm,
            Localizer.get().alert_confirm_reset_data,
            self.window,
        )
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)
        if not message_box.exec():
            return

        snapshot = self.model_api_client.reset_preset_model(model_id)
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().model_page_reset_success_toast,
            },
        )
        self.refresh_snapshot(snapshot)
