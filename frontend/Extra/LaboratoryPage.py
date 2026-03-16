from typing import Callable

from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import SwitchButton

from base.Base import Base
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from widget.SettingCard import CardHelpSpec
from widget.SettingCard import SettingCard


class LaboratoryPage(Base, QWidget):
    MTOOL_OPTIMIZER_URL_ZH: str = (
        "https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer"
    )
    MTOOL_OPTIMIZER_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN"
    )
    FORCE_THINKING_URL_ZH: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ForceThinking"
    )
    FORCE_THINKING_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ForceThinkingEN"
    )

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
        self.add_widget_mtool(self.root, config)
        self.add_widget_force_thinking(self.root, config)

        # 填充
        self.root.addStretch(1)

        # 翻译过程中禁用影响过滤/翻译语义的选项，避免与翻译写库产生竞态。
        self.subscribe_busy_state_events(self.on_translation_status_changed)
        self.on_translation_status_changed(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.DONE,
            },
        )

    def on_translation_status_changed(self, event: Base.Event, data: dict) -> None:
        if event in Base.RESET_PROGRESS_EVENTS and not Base.is_terminal_reset_event(
            event, data
        ):
            return

        status = Engine.get().get_status()
        locked = Base.is_engine_busy(status)
        if hasattr(self, "mtool_switch") and self.mtool_switch is not None:
            self.mtool_switch.setEnabled(not locked)
        if (
            hasattr(self, "force_thinking_switch")
            and self.force_thinking_switch is not None
        ):
            self.force_thinking_switch.setEnabled(not locked)

    def add_switch_card(
        self,
        *,
        parent: QLayout,
        title: str,
        description: str,
        help_url_zh: str,
        help_url_en: str,
        checked: bool,
        on_checked_changed: Callable[[], None],
    ) -> SwitchButton:
        """统一创建实验室页面的开关卡片，避免每个选项重复搭 UI。"""
        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=help_url_zh,
                en=help_url_en,
            )
        )
        card = SettingCard(
            title=title,
            description=description,
            help_spec=help_spec,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(checked)
        switch_button.checkedChanged.connect(lambda _checked: on_checked_changed())
        card.add_right_widget(switch_button)
        parent.addWidget(card)
        return switch_button

    # MTool 优化器
    def add_widget_mtool(self, parent: QLayout, config: Config) -> None:
        def checked_changed() -> None:
            config = Config().load()
            config.mtool_optimizer_enable = self.mtool_switch.isChecked()
            config.save()
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["mtool_optimizer_enable"]})

        self.mtool_switch = self.add_switch_card(
            parent=parent,
            title=Localizer.get().laboratory_page_mtool_optimizer_enable,
            description=Localizer.get().laboratory_page_mtool_optimizer_enable_desc,
            help_url_zh=self.MTOOL_OPTIMIZER_URL_ZH,
            help_url_en=self.MTOOL_OPTIMIZER_URL_EN,
            checked=config.mtool_optimizer_enable,
            on_checked_changed=checked_changed,
        )

    # 强制思考
    def add_widget_force_thinking(self, parent: QLayout, config: Config) -> None:
        def checked_changed() -> None:
            config = Config().load()
            config.force_thinking_enable = self.force_thinking_switch.isChecked()
            config.save()

        self.force_thinking_switch = self.add_switch_card(
            parent=parent,
            title=Localizer.get().laboratory_page_force_thinking_enable,
            description=Localizer.get().laboratory_page_force_thinking_enable_desc,
            help_url_zh=self.FORCE_THINKING_URL_ZH,
            help_url_en=self.FORCE_THINKING_URL_EN,
            checked=config.force_thinking_enable,
            on_checked_changed=checked_changed,
        )
