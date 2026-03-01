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
    AUTO_GLOSSARY_URL_ZH: str = "https://github.com/neavo/LinguaGacha/wiki/AutoGlossary"
    AUTO_GLOSSARY_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/AutoGlossaryEN"
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
        self.add_widget_mtool(self.root, config, window)
        self.add_widget_force_thinking(self.root, config, window)
        self.add_widget_auto_glossary(self.root, config, window)

        # 填充
        self.root.addStretch(1)

        # 翻译过程中禁用影响过滤/翻译语义的选项，避免与翻译写库产生竞态。
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_translation_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_translation_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.on_translation_status_changed
        )
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_status_changed)
        self.on_translation_status_changed(Base.Event.TRANSLATION_DONE, {})

    def on_translation_status_changed(self, event: Base.Event, data: dict) -> None:
        if event == Base.Event.TRANSLATION_RESET:
            sub_event: Base.TranslationResetSubEvent = data["sub_event"]
            if sub_event not in (
                Base.TranslationResetSubEvent.DONE,
                Base.TranslationResetSubEvent.ERROR,
            ):
                return

        status = Engine.get().get_status()
        locked = status in (Base.TaskStatus.TRANSLATING, Base.TaskStatus.STOPPING)
        if hasattr(self, "mtool_switch") and self.mtool_switch is not None:
            self.mtool_switch.setEnabled(not locked)
        if (
            hasattr(self, "force_thinking_switch")
            and self.force_thinking_switch is not None
        ):
            self.force_thinking_switch.setEnabled(not locked)

    # MTool 优化器
    def add_widget_mtool(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def checked_changed(button: SwitchButton) -> None:
            config = Config().load()
            config.mtool_optimizer_enable = button.isChecked()
            config.save()
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["mtool_optimizer_enable"]})

        # 问号链接走 UI 语言适配，保持中英文说明一致。
        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=self.MTOOL_OPTIMIZER_URL_ZH,
                en=self.MTOOL_OPTIMIZER_URL_EN,
            )
        )
        card = SettingCard(
            title=Localizer.get().laboratory_page_mtool_optimizer_enable,
            description=Localizer.get().laboratory_page_mtool_optimizer_enable_desc,
            help_spec=help_spec,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(config.mtool_optimizer_enable)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        self.mtool_switch = switch_button
        parent.addWidget(card)

    # 强制思考
    def add_widget_force_thinking(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def checked_changed(button: SwitchButton) -> None:
            config = Config().load()
            config.force_thinking_enable = button.isChecked()
            config.save()

        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=self.FORCE_THINKING_URL_ZH,
                en=self.FORCE_THINKING_URL_EN,
            )
        )
        card = SettingCard(
            title=Localizer.get().laboratory_page_force_thinking_enable,
            description=Localizer.get().laboratory_page_force_thinking_enable_desc,
            help_spec=help_spec,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(config.force_thinking_enable)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        self.force_thinking_switch = switch_button
        parent.addWidget(card)

    # 自动补全术语表
    def add_widget_auto_glossary(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def checked_changed(button: SwitchButton) -> None:
            config = Config().load()
            config.auto_glossary_enable = button.isChecked()
            config.save()

        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=self.AUTO_GLOSSARY_URL_ZH,
                en=self.AUTO_GLOSSARY_URL_EN,
            )
        )
        card = SettingCard(
            title=Localizer.get().laboratory_page_auto_glossary_enable,
            description=Localizer.get().laboratory_page_auto_glossary_enable_desc,
            help_spec=help_spec,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(config.auto_glossary_enable)
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)
