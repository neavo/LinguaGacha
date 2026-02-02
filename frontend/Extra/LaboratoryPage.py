from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentWindow

from base.Base import Base
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from widget.SwitchButtonCard import SwitchButtonCard


class LaboratoryPage(QWidget, Base):
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
        del event
        del data
        status = Engine.get().get_status()
        locked = status in (Base.TaskStatus.TRANSLATING, Base.TaskStatus.STOPPING)
        if hasattr(self, "mtool_card") and self.mtool_card is not None:
            self.mtool_card.get_switch_button().setEnabled(not locked)

    # MTool 优化器
    def add_widget_mtool(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.mtool_optimizer_enable)

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            config.mtool_optimizer_enable = widget.get_switch_button().isChecked()
            config.save()
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["mtool_optimizer_enable"]})

        self.mtool_card = SwitchButtonCard(
            title=Localizer.get().laboratory_page_mtool_optimizer_enable,
            description=Localizer.get().laboratory_page_mtool_optimizer_enable_desc,
            init=init,
            checked_changed=checked_changed,
        )
        parent.addWidget(self.mtool_card)

    # 自动补全术语表
    def add_widget_auto_glossary(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.auto_glossary_enable)

        def checked_changed(widget: SwitchButtonCard) -> None:
            config = Config().load()
            config.auto_glossary_enable = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title=Localizer.get().laboratory_page_auto_glossary_enable,
                description=Localizer.get().laboratory_page_auto_glossary_enable_desc,
                init=init,
                checked_changed=checked_changed,
            )
        )
