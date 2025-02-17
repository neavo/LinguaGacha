from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import Action
from qfluentwidgets import RoundMenu
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import DropDownPushButton
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Localizer.Localizer import Localizer
from widget.EmptyCard import EmptyCard
from widget.GroupCard import GroupCard
from widget.ComboBoxCard import ComboBoxCard
from widget.LineEditCard import LineEditCard
from widget.LineEditMessageBox import LineEditMessageBox
from frontend.Project.ModelListPage import ModelListPage

class PlatformEditPage(MessageBoxBase, Base):

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入配置文件
        config = self.load_config()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取平台配置
        self.get_platform_from_config(id, config)

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroller = SingleDirectionScrollArea(self, orient = Qt.Vertical)
        self.scroller.setWidgetResizable(True)
        self.scroller.setStyleSheet("QScrollArea { border: none; background: transparent; }")
        self.viewLayout.addWidget(self.scroller)

        # 设置滚动控件
        self.vbox_parent = QWidget(self)
        self.vbox_parent.setStyleSheet("QWidget { background: transparent; }")
        self.vbox = QVBoxLayout(self.vbox_parent)
        self.vbox.setSpacing(8)
        self.vbox.setContentsMargins(24, 24, 24, 24) # 左、上、右、下
        self.scroller.setWidget(self.vbox_parent)

        # 接口名称
        self.add_widget_name(self.vbox, config, window)

        # 接口地址
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.ANTHROPIC, Base.APIFormat.SAKURALLM):
            self.add_widget_api_url(self.vbox, config, window)

        # 接口密钥
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.GOOGLE, Base.APIFormat.ANTHROPIC):
            self.add_widget_api_key(self.vbox, config, window)

        # 接口格式
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.ANTHROPIC):
            self.add_widget_format(self.vbox, config, window)

        # 模型名称
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.GOOGLE, Base.APIFormat.ANTHROPIC):
            self.add_widget_model(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 获取平台配置
    def get_platform_from_config(self, id: int, config: dict) -> None:
        for platform in config.get("platforms", []):
            if platform.get("id", 0) == id:
                self.platform: dict = platform
                break

    # 更新平台配置
    def update_platform_to_config(self, platform: dict, config: dict) -> None:
        for i, item in enumerate(config.get("platforms", [])):
            if item.get("id", 0) == platform.get("id", 0):
                config.get("platforms")[i] = platform
                break

    # 接口名称
    def add_widget_name(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: LineEditCard) -> None:
            widget.set_text(self.platform.get("name"))
            widget.set_fixed_width(256)
            widget.set_placeholder_text(Localizer.get().platform_edit_page_widget_name)

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = self.load_config()
            self.platform["name"] = text.strip()
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            LineEditCard(
                Localizer.get().platform_edit_page_widget_name_title,
                Localizer.get().platform_edit_page_widget_name_content,
                init = init,
                text_changed = text_changed,
            )
        )

    # 接口地址
    def add_widget_api_url(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: LineEditCard) -> None:
            widget.set_text(self.platform.get("api_url"))
            widget.set_fixed_width(384)
            widget.set_placeholder_text(Localizer.get().platform_edit_page_widget_api_url)

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = self.load_config()
            self.platform["api_url"] = text.strip()
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            LineEditCard(
                Localizer.get().platform_edit_page_widget_api_url_title,
                Localizer.get().platform_edit_page_widget_api_url_content,
                init = init,
                text_changed = text_changed,
            )
        )

    # 接口密钥
    def add_widget_api_key(self, parent: QLayout, config: dict, window: FluentWindow) -> None:

        def text_changed(widget: GroupCard) -> None:
            config = self.load_config()

            self.platform["api_key"] = [
                v.strip() for v in widget.toPlainText().strip().splitlines()
                if v.strip() != ""
            ]
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        def init(widget: GroupCard) -> None:
            plain_text_edit = PlainTextEdit(self)
            plain_text_edit.setPlainText("\n".join(self.platform.get("api_key")))
            plain_text_edit.setPlaceholderText(Localizer.get().platform_edit_page_widget_api_key)
            plain_text_edit.textChanged.connect(lambda: text_changed(plain_text_edit))
            widget.addWidget(plain_text_edit)

        parent.addWidget(
            GroupCard(
                Localizer.get().platform_edit_page_widget_api_key_title,
                Localizer.get().platform_edit_page_widget_api_key_content,
                init = init,
            )
        )

    # 接口格式
    def add_widget_format(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        def init(widget: ComboBoxCard) -> None:
            widget.set_current_index(max(0, widget.find_text(self.platform.get("api_format"))))

        def current_changed(widget: ComboBoxCard) -> None:
            config = self.load_config()
            self.platform["api_format"] = widget.get_current_text()
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)

        parent.addWidget(
            ComboBoxCard(
                Localizer.get().platform_edit_page_widget_api_format_title,
                Localizer.get().platform_edit_page_widget_api_format_content,
                (Base.APIFormat.OPENAI, Base.APIFormat.ANTHROPIC),
                init = init,
                current_changed = current_changed,
            )
        )

    # 模型名称
    def add_widget_model(self, parent: QLayout, config: dict, window: FluentWindow) -> None:
        # 定义变量
        empty_card = None

        def message_box_close(widget: LineEditMessageBox, text: str) -> None:
            config = self.load_config()
            self.platform["model"] = text.strip()
            self.update_platform_to_config(self.platform, config)
            self.save_config(config)
            empty_card.set_description(
                Localizer.get().platform_edit_page_widget_model_content.replace("{MODEL}", self.platform.get("model"))
            )

        def triggered_edit() -> None:
            message_box = LineEditMessageBox(
                window,
                Localizer.get().platform_edit_page_widget_model,
                message_box_close = message_box_close
            )
            message_box.exec()

        def triggered_sync() -> None:
            # 弹出页面
            ModelListPage(self.platform.get("id", 0), window).exec()

            # 更新 UI 文本
            config = self.load_config()
            self.get_platform_from_config(self.platform.get("id"), config)
            empty_card.set_description(
                Localizer.get().platform_edit_page_widget_model_content.replace("{MODEL}", self.platform.get("model"))
            )

        empty_card = EmptyCard(
            Localizer.get().platform_edit_page_widget_model_title,
            Localizer.get().platform_edit_page_widget_model_content.replace("{MODEL}", self.platform.get("model")),
        )
        parent.addWidget(empty_card)

        drop_down_push_button = DropDownPushButton(Localizer.get().edit)
        drop_down_push_button.setIcon(FluentIcon.LABEL)
        drop_down_push_button.setFixedWidth(128)
        drop_down_push_button.setContentsMargins(4, 0, 4, 0) # 左、上、右、下
        empty_card.add_widget(drop_down_push_button)

        menu = RoundMenu("", drop_down_push_button)
        menu.addAction(
            Action(
                FluentIcon.EDIT,
                Localizer.get().platform_edit_page_widget_model_edit,
                triggered = lambda _: triggered_edit(),
            )
        )
        menu.addSeparator()
        menu.addAction(
            Action(
                FluentIcon.SYNC,
                Localizer.get().platform_edit_page_widget_model_sync,
                triggered = lambda _: triggered_sync(),
            )
        )
        drop_down_push_button.setMenu(menu)