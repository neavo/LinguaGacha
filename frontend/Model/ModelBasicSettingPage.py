from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import ComboBox
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Model.ModelSelectorPage import ModelSelectorPage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.CustomTextEdit import CustomTextEdit
from widget.EmptyCard import EmptyCard
from widget.GroupCard import GroupCard
from widget.LineEditCard import LineEditCard
from widget.LineEditMessageBox import LineEditMessageBox


# ==================== 图标常量 ====================

ICON_MODEL_ID_MENU: BaseIcon = BaseIcon.PENCIL  # 模型 ID：下拉菜单按钮
ICON_MODEL_ID_EDIT: BaseIcon = BaseIcon.PENCIL_LINE  # 模型 ID：编辑/修改
ICON_MODEL_ID_SYNC: BaseIcon = BaseIcon.REFRESH_CW  # 模型 ID：同步/更新


class ModelBasicSettingPage(Base, MessageBoxBase):
    def __init__(self, model_id: str, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取模型配置
        self.model_id = model_id
        self.model = config.get_model(model_id)

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
        self.add_widget_name(self.vbox, config, window)

        # 模型地址
        api_format = self.model.get("api_format", "")
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_api_url(self.vbox, config, window)

        # 模型密钥
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_api_key(self.vbox, config, window)

        # 模型标识
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
            Base.APIFormat.SAKURALLM,
        ):
            self.add_widget_model_id(self.vbox, config, window)

        # 思考挡位
        if api_format in (
            Base.APIFormat.OPENAI,
            Base.APIFormat.GOOGLE,
            Base.APIFormat.ANTHROPIC,
        ):
            self.add_widget_thinking_level(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 模型名称
    def add_widget_name(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: LineEditCard) -> None:
            widget.get_line_edit().setText(self.model.get("name", ""))
            widget.get_line_edit().setFixedWidth(256)
            widget.get_line_edit().setPlaceholderText(
                Localizer.get().model_basic_setting_page_name
            )

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = Config().load()
            self.model["name"] = text.strip()
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            LineEditCard(
                Localizer.get().model_basic_setting_page_name_title,
                Localizer.get().model_basic_setting_page_name_content,
                init=init,
                text_changed=text_changed,
            )
        )

    # 模型地址
    def add_widget_api_url(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: LineEditCard) -> None:
            widget.get_line_edit().setText(self.model.get("api_url", ""))
            widget.get_line_edit().setFixedWidth(384)
            widget.get_line_edit().setPlaceholderText(
                Localizer.get().model_basic_setting_page_api_url
            )

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = Config().load()
            self.model["api_url"] = text.strip()
            config.set_model(self.model)
            config.save()

        parent.addWidget(
            LineEditCard(
                Localizer.get().api_url,
                Localizer.get().model_basic_setting_page_api_url_content,
                init=init,
                text_changed=text_changed,
            )
        )

    # 模型密钥
    def add_widget_api_key(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def text_changed(widget: PlainTextEdit) -> None:
            config = Config().load()
            self.model["api_key"] = widget.toPlainText().strip()
            config.set_model(self.model)
            config.save()

        def init(widget: GroupCard) -> None:
            api_key = self.model.get("api_key", "")
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
    def add_widget_model_id(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        empty_card = None

        def message_box_close(widget: LineEditMessageBox, text: str) -> None:
            config = Config().load()
            self.model["model_id"] = text.strip()
            config.set_model(self.model)
            config.save()

            empty_card.get_description_label().setText(
                Localizer.get().model_basic_setting_page_model_id_content.replace(
                    "{MODEL}", self.model.get("model_id", "")
                )
            )

        def triggered_edit() -> None:
            message_box = LineEditMessageBox(
                window,
                Localizer.get().model_basic_setting_page_model_id,
                message_box_close=message_box_close,
            )
            message_box.get_line_edit().setText(self.model.get("model_id", ""))
            message_box.exec()

        def triggered_sync() -> None:
            # 弹出页面
            ModelSelectorPage(self.model_id, window).exec()

            # 更新 UI 文本
            self.model = Config().load().get_model(self.model_id)
            empty_card.get_description_label().setText(
                Localizer.get().model_basic_setting_page_model_id_content.replace(
                    "{MODEL}", self.model.get("model_id", "")
                )
            )

        empty_card = EmptyCard(
            Localizer.get().model_basic_setting_page_model_id_title,
            Localizer.get().model_basic_setting_page_model_id_content.replace(
                "{MODEL}", self.model.get("model_id", "")
            ),
        )
        parent.addWidget(empty_card)

        drop_down_push_button = DropDownPushButton(Localizer.get().edit)
        drop_down_push_button.setIcon(ICON_MODEL_ID_MENU)
        drop_down_push_button.setFixedWidth(128)
        drop_down_push_button.setContentsMargins(4, 0, 4, 0)
        empty_card.add_widget(drop_down_push_button)

        menu = RoundMenu("", drop_down_push_button)
        menu.addAction(
            Action(
                ICON_MODEL_ID_EDIT,
                Localizer.get().model_basic_setting_page_model_id_edit,
                triggered=lambda _: triggered_edit(),
            )
        )
        menu.addSeparator()
        menu.addAction(
            Action(
                ICON_MODEL_ID_SYNC,
                Localizer.get().model_basic_setting_page_model_id_sync,
                triggered=lambda _: triggered_sync(),
            )
        )
        drop_down_push_button.setMenu(menu)

    # 思考挡位
    def add_widget_thinking_level(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        empty_card = EmptyCard(
            Localizer.get().model_basic_setting_page_thinking_title,
            Localizer.get().model_basic_setting_page_thinking_content,
        )
        parent.addWidget(empty_card)

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
        thinking = self.model.get("thinking", {})
        current_level = thinking.get("level", "OFF")
        level_to_index = {"OFF": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}
        combo_box.setCurrentIndex(level_to_index.get(current_level, 0))

        def on_current_index_changed(index: int) -> None:
            config = Config().load()
            index_to_level = {0: "OFF", 1: "LOW", 2: "MEDIUM", 3: "HIGH"}
            if "thinking" not in self.model:
                self.model["thinking"] = {}
            self.model["thinking"]["level"] = index_to_level.get(index, "OFF")
            config.set_model(self.model)
            config.save()

        combo_box.currentIndexChanged.connect(on_current_index_changed)
        empty_card.add_widget(combo_box)
