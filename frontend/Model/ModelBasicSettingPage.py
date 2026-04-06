from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import ComboBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import PushButton
from qfluentwidgets import SingleDirectionScrollArea

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ModelApiClient import ModelApiClient
from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Model.ModelSelectorPage import ModelSelectorPage
from model.Api.ModelModels import ModelEntrySnapshot
from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomLineEdit
from widget.CustomTextEdit import CustomTextEdit
from widget.GroupCard import GroupCard
from widget.LineEditMessageBox import LineEditMessageBox
from widget.SettingCard import CardHelpSpec
from widget.SettingCard import SettingCard

# ==================== 图标常量 ====================

ICON_MODEL_ID_EDIT: BaseIcon = BaseIcon.PENCIL_LINE  # 模型 ID：编辑/修改
ICON_MODEL_ID_SYNC: BaseIcon = BaseIcon.REFRESH_CW  # 模型 ID：同步/更新
ICON_MODEL_ID_TEST: BaseIcon = BaseIcon.SEND  # 模型 ID：测试
MODEL_ID_ACTION_BUTTON_WIDTH: int = 80  # 模型标识：操作按钮宽度


class ModelBasicSettingPage(Base, MessageBoxBase):
    THINKING_SUPPORT_URL_ZH: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupport"
    )
    THINKING_SUPPORT_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ThinkingLevelSupportEN"
    )

    def __init__(
        self,
        model: ModelEntrySnapshot,
        model_api_client: ModelApiClient,
        api_state_store: ApiStateStore,
        window: FluentWindow,
    ) -> None:
        super().__init__(window)

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取模型配置
        self.model = model
        self.model_id = model.id
        self.model_api_client = model_api_client
        self.api_state_store = api_state_store
        self.model_id_test_button: PushButton | None = None

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroll_area = SingleDirectionScrollArea(
            self, orient=Qt.Orientation.Vertical
        )
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.enableTransparentBackground()
        # self.scroll_area.setSmoothMode(SmoothMode.NO_SMOOTH)  # 禁用平滑滚动以提升性能
        self.viewLayout.addWidget(self.scroll_area)

        # 设置滚动控件
        self.vbox_parent = QWidget(self)
        self.vbox_parent.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.vbox_parent)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24)
        self.scroll_area.setWidget(self.vbox_parent)

        # 模型名称
        self.add_widget_name(self.vbox, window)

        # 模型地址
        api_format = self.model.api_format
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_api_url(self.vbox, window)

        # 模型密钥
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_api_key(self.vbox, window)

        # 模型标识
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_model_id(self.vbox, window)

        # 思考挡位
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
        ):
            self.add_widget_thinking_level(self.vbox)

        # 填充
        self.vbox.addStretch(1)

        # 注册事件
        self.subscribe(Base.Event.APITEST, self.update_test_button_status)
        self.subscribe(Base.Event.TRANSLATION_TASK, self.update_test_button_status)
        self.subscribe(
            Base.Event.TRANSLATION_REQUEST_STOP, self.update_test_button_status
        )
        self.subscribe(Base.Event.ANALYSIS_TASK, self.update_test_button_status)
        self.subscribe(
            Base.Event.ANALYSIS_REQUEST_STOP,
            self.update_test_button_status,
        )

    def refresh_model_from_snapshot(self, snapshot) -> None:
        """统一从最新快照回填当前模型，避免弹窗继续持有过期对象。"""

        self.model = next(
            (item for item in snapshot.models if item.id == self.model.id),
            self.model,
        )

    def update_model_fields(self, patch: dict[str, object]) -> None:
        """所有局部写入都走同一 API 入口，保证页面没有第二写口。"""

        snapshot = self.model_api_client.update_model(self.model.id, patch)
        self.refresh_model_from_snapshot(snapshot)

    # 模型名称
    def add_widget_name(self, parent: QLayout, window: FluentWindow) -> None:
        del window

        def text_changed(text: str) -> None:
            self.update_model_fields({"name": text.strip()})

        card = SettingCard(
            title=Localizer.get().model_basic_setting_page_name_title,
            description=Localizer.get().model_basic_setting_page_name_content,
            parent=self,
        )
        line_edit = CustomLineEdit(card)
        line_edit.setText(self.model.name)
        line_edit.setFixedWidth(256)
        line_edit.setClearButtonEnabled(True)
        line_edit.setPlaceholderText(Localizer.get().model_basic_setting_page_name)
        line_edit.textChanged.connect(text_changed)
        card.add_right_widget(line_edit)
        parent.addWidget(card)

    # 模型地址
    def add_widget_api_url(self, parent: QLayout, window: FluentWindow) -> None:
        del window

        def text_changed(text: str) -> None:
            self.update_model_fields({"api_url": text.strip()})

        card = SettingCard(
            title=Localizer.get().api_url,
            description=Localizer.get().model_basic_setting_page_api_url_content,
            parent=self,
        )
        line_edit = CustomLineEdit(card)
        line_edit.setText(self.model.api_url)
        line_edit.setFixedWidth(384)
        line_edit.setClearButtonEnabled(True)
        line_edit.setPlaceholderText(Localizer.get().model_basic_setting_page_api_url)
        line_edit.textChanged.connect(text_changed)
        card.add_right_widget(line_edit)
        parent.addWidget(card)

    # 模型密钥
    def add_widget_api_key(self, parent: QLayout, window: FluentWindow) -> None:
        del window

        def text_changed(widget: PlainTextEdit) -> None:
            self.update_model_fields({"api_key": widget.toPlainText().strip()})

        def init(widget: GroupCard) -> None:
            api_key = self.model.api_key
            plain_text_edit = CustomTextEdit(self, monospace=True)
            plain_text_edit.setPlainText(api_key)
            plain_text_edit.setFixedHeight(170)
            plain_text_edit.setPlaceholderText(
                Localizer.get().model_basic_setting_page_api_key
            )
            plain_text_edit.textChanged.connect(lambda: text_changed(plain_text_edit))
            widget.add_widget(plain_text_edit)

        parent.addWidget(
            GroupCard(
                parent=self,
                title=Localizer.get().model_basic_setting_page_api_key_title,
                description=Localizer.get().model_basic_setting_page_api_key_content,
                init=init,
            )
        )

    # 模型标识
    def add_widget_model_id(self, parent: QLayout, window: FluentWindow) -> None:
        card: SettingCard | None = None

        def message_box_close(widget: LineEditMessageBox, text: str) -> None:
            del widget
            self.update_model_fields({"model_id": text.strip()})

            if card is not None:
                card.set_description(
                    Localizer.get().model_basic_setting_page_model_id_content.replace(
                        "{MODEL}", self.model.model_id
                    )
                )

        def triggered_edit(checked: bool = False) -> None:
            del checked
            message_box = LineEditMessageBox(
                window,
                Localizer.get().model_basic_setting_page_model_id,
                message_box_close=message_box_close,
            )
            message_box.get_line_edit().setText(self.model.model_id)
            message_box.exec()

        def triggered_sync(checked: bool = False) -> None:
            del checked
            # 弹出页面
            selector = ModelSelectorPage(self.model, self.model_api_client, window)
            selector.exec()

            # 更新 UI 文本
            self.model = selector.model
            if card is not None:
                card.set_description(
                    Localizer.get().model_basic_setting_page_model_id_content.replace(
                        "{MODEL}", self.model.model_id
                    )
                )

        card = SettingCard(
            Localizer.get().model_basic_setting_page_model_id_title,
            Localizer.get().model_basic_setting_page_model_id_content.replace(
                "{MODEL}", self.model.model_id
            ),
            parent=self,
        )
        parent.addWidget(card)

        def triggered_test(checked: bool = False) -> None:
            del checked
            self.emit(
                Base.Event.APITEST,
                {
                    "sub_event": Base.SubEvent.REQUEST,
                    "model_id": self.model_id,
                },
            )

        input_button = PushButton(
            Localizer.get().model_basic_setting_page_model_id_input
        )
        input_button.setIcon(ICON_MODEL_ID_EDIT)
        input_button.setFixedWidth(MODEL_ID_ACTION_BUTTON_WIDTH)
        input_button.clicked.connect(triggered_edit)
        card.add_right_widget(input_button)

        fetch_button = PushButton(
            Localizer.get().model_basic_setting_page_model_id_fetch
        )
        fetch_button.setIcon(ICON_MODEL_ID_SYNC)
        fetch_button.setFixedWidth(MODEL_ID_ACTION_BUTTON_WIDTH)
        fetch_button.clicked.connect(triggered_sync)
        card.add_right_widget(fetch_button)

        test_button = PushButton(Localizer.get().model_basic_setting_page_model_id_test)
        test_button.setIcon(ICON_MODEL_ID_TEST)
        test_button.setFixedWidth(MODEL_ID_ACTION_BUTTON_WIDTH)
        test_button.clicked.connect(triggered_test)
        card.add_right_widget(test_button)
        self.model_id_test_button = test_button

        self.update_test_button_status(
            Base.Event.APITEST, {"sub_event": Base.SubEvent.DONE}
        )

    # 思考挡位
    def add_widget_thinking_level(self, parent: QLayout) -> None:
        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=self.THINKING_SUPPORT_URL_ZH,
                en=self.THINKING_SUPPORT_URL_EN,
            )
        )
        card = SettingCard(
            Localizer.get().model_basic_setting_page_thinking_title,
            Localizer.get().model_basic_setting_page_thinking_content,
            help_spec=help_spec,
            parent=self,
        )
        parent.addWidget(card)

        # 下拉框选择
        combo_box = ComboBox()
        combo_box.setFixedWidth(128)
        combo_box.addItems(
            [
                Localizer.get().model_basic_setting_page_thinking_off,
                Localizer.get().model_basic_setting_page_thinking_low,
                Localizer.get().model_basic_setting_page_thinking_medium,
                Localizer.get().model_basic_setting_page_thinking_high,
            ]
        )

        # 设置当前值
        current_level = self.model.thinking.level
        level_to_index = {"OFF": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
        combo_box.setCurrentIndex(level_to_index.get(current_level, 0))

        def on_current_index_changed(index: int) -> None:
            index_to_level = {0: "OFF", 1: "LOW", 2: "MEDIUM", 3: "HIGH"}
            self.update_model_fields(
                {
                    "thinking": {
                        "level": index_to_level.get(index, "OFF"),
                    }
                }
            )

        combo_box.currentIndexChanged.connect(on_current_index_changed)
        card.add_right_widget(combo_box)

    def update_test_button_status(self, event: Base.Event, data: dict) -> None:
        """同步测试按钮状态，避免任务运行时重复触发。"""
        del event, data
        if self.model_id_test_button is None:
            return
        task_snapshot = self.api_state_store.task_snapshot
        is_busy = False if task_snapshot is None else bool(task_snapshot.busy)
        self.model_id_test_button.setEnabled(not is_busy)
