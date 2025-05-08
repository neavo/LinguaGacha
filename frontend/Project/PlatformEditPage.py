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
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.EmptyCard import EmptyCard
from widget.GroupCard import GroupCard
from widget.LineEditCard import LineEditCard
from widget.SwitchButtonCard import SwitchButtonCard
from widget.LineEditMessageBox import LineEditMessageBox
from frontend.Project.ModelListPage import ModelListPage

class PlatformEditPage(MessageBoxBase, Base):

    def __init__(self, id: int, window: FluentWindow) -> None:
        super().__init__(window)

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置框体
        self.widget.setFixedSize(960, 720)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 获取平台配置
        self.id = id
        self.platform = config.get_platform(id)

        # 设置主布局
        self.viewLayout.setContentsMargins(0, 0, 0, 0)

        # 设置滚动器
        self.scroller = SingleDirectionScrollArea(self, orient = Qt.Orientation.Vertical)
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
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.GOOGLE, Base.APIFormat.ANTHROPIC, Base.APIFormat.SAKURALLM):
            self.add_widget_api_key(self.vbox, config, window)

        # 模型名称
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.GOOGLE, Base.APIFormat.ANTHROPIC, Base.APIFormat.SAKURALLM):
            self.add_widget_model(self.vbox, config, window)

        # 思考模式
        if self.platform.get("api_format") in (Base.APIFormat.OPENAI, Base.APIFormat.GOOGLE, Base.APIFormat.ANTHROPIC):
            self.add_widget_thinking(self.vbox, config, window)

        # 填充
        self.vbox.addStretch(1)

    # 接口名称
    def add_widget_name(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: LineEditCard) -> None:
            widget.get_line_edit().setText(self.platform.get("name"))
            widget.get_line_edit().setFixedWidth(256)
            widget.get_line_edit().setPlaceholderText(Localizer.get().platform_edit_page_name)

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = Config().load()
            self.platform["name"] = text.strip()
            config.set_platform(self.platform)
            config.save()

        parent.addWidget(
            LineEditCard(
                Localizer.get().platform_edit_page_name_title,
                Localizer.get().platform_edit_page_name_content,
                init = init,
                text_changed = text_changed,
            )
        )

    # 接口地址
    def add_widget_api_url(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: LineEditCard) -> None:
            widget.get_line_edit().setText(self.platform.get("api_url"))
            widget.get_line_edit().setFixedWidth(384)
            widget.get_line_edit().setPlaceholderText(Localizer.get().platform_edit_page_api_url)

        def text_changed(widget: LineEditCard, text: str) -> None:
            config = Config().load()
            self.platform["api_url"] = text.strip()
            config.set_platform(self.platform)
            config.save()

        parent.addWidget(
            LineEditCard(
                Localizer.get().platform_edit_page_api_url_title,
                Localizer.get().platform_edit_page_api_url_content,
                init = init,
                text_changed = text_changed,
            )
        )

    # 接口密钥
    def add_widget_api_key(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def text_changed(widget: PlainTextEdit) -> None:
            config = Config().load()
            self.platform["api_key"] = [
                v.strip() for v in widget.toPlainText().strip().splitlines()
                if v.strip() != ""
            ]
            config.set_platform(self.platform)
            config.save()

        def init(widget: GroupCard) -> None:
            plain_text_edit = PlainTextEdit(self)
            plain_text_edit.setPlainText("\n".join(self.platform.get("api_key")))
            plain_text_edit.setPlaceholderText(Localizer.get().platform_edit_page_api_key)
            plain_text_edit.textChanged.connect(lambda: text_changed(plain_text_edit))
            widget.add_widget(plain_text_edit)

        parent.addWidget(
            GroupCard(
                parent = self,
                title = Localizer.get().platform_edit_page_api_key_title,
                description = Localizer.get().platform_edit_page_api_key_content,
                init = init,
            )
        )

    # 模型名称
    def add_widget_model(self, parent: QLayout, config: Config, window: FluentWindow) -> None:
        # 定义变量
        empty_card = None

        def message_box_close(widget: LineEditMessageBox, text: str) -> None:
            config = Config().load()
            self.platform["model"] = text.strip()
            config.set_platform(self.platform)
            config.save()

            empty_card.get_description_label().setText(
                Localizer.get().platform_edit_page_model_content.replace("{MODEL}", self.platform.get("model"))
            )

        def triggered_edit() -> None:
            message_box = LineEditMessageBox(
                window,
                Localizer.get().platform_edit_page_model,
                message_box_close = message_box_close
            )
            message_box.get_line_edit().setText(self.platform.get("model"))
            message_box.exec()

        def triggered_sync() -> None:
            # 弹出页面
            ModelListPage(self.id, window).exec()

            # 更新 UI 文本
            self.platform = Config().load().get_platform(self.id)
            empty_card.get_description_label().setText(
                Localizer.get().platform_edit_page_model_content.replace("{MODEL}", self.platform.get("model"))
            )

        empty_card = EmptyCard(
            Localizer.get().platform_edit_page_model_title,
            Localizer.get().platform_edit_page_model_content.replace("{MODEL}", self.platform.get("model")),
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
                Localizer.get().platform_edit_page_model_edit,
                triggered = lambda _: triggered_edit(),
            )
        )
        menu.addSeparator()
        menu.addAction(
            Action(
                FluentIcon.SYNC,
                Localizer.get().platform_edit_page_model_sync,
                triggered = lambda _: triggered_sync(),
            )
        )
        drop_down_push_button.setMenu(menu)

    # 思考模式
    def add_widget_thinking(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(
                self.platform.get("thinking", False)
            )

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            self.platform["thinking"] = widget.get_switch_button().isChecked()
            config.set_platform(self.platform)
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().platform_edit_page_thinking_title,
                description = Localizer.get().platform_edit_page_thinking_content,
                init = init,
                checked_changed = checked_changed,
            )
        )