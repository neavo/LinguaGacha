from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtCore import QUrl
from PySide6.QtGui import QColor
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import TeachingTip
from qfluentwidgets import TeachingTipTailPosition
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import TransparentToolButton

from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer
from module.Localizer.LocalizerText import LocalizerText


@dataclass(frozen=True)
class CardHelpSpec:
    # 统一问号帮助的配置载体，避免页面各自拼装导致行为不一致。
    url: str | None = None
    url_localized: LocalizerText | None = None
    tip_title: str | None = None
    tip_title_localized: LocalizerText | None = None
    tip_content: str | None = None
    tip_content_localized: LocalizerText | None = None
    tip_target: QWidget | None = None
    tip_parent: QWidget | None = None
    tip_duration_ms: int | None = None
    tip_tail_position: TeachingTipTailPosition | None = None

    def has_tip(self) -> bool:
        # 用于判断是否需要展示 TeachingTip，保持点击逻辑清晰。
        tip_title = self.resolve_tip_title()
        tip_content = self.resolve_tip_content()
        return bool(tip_title or tip_content)

    def has_link(self) -> bool:
        # 用于判断是否需要打开外链，避免空 URL 调用。
        return bool(self.resolve_url())

    def resolve_url(self) -> str | None:
        # 优先使用显式 URL，未提供时才按 UI 语言选择。
        if self.url is not None:
            return self.url
        if self.url_localized is None:
            return None
        return self.url_localized.resolve()

    def resolve_tip_title(self) -> str:
        # 保持调用方不需要处理空值分支。
        if self.tip_title is not None:
            return self.tip_title
        if self.tip_title_localized is None:
            return ""
        return self.tip_title_localized.resolve() or ""

    def resolve_tip_content(self) -> str:
        # TeachingTip 内容与标题统一处理语言分支。
        if self.tip_content is not None:
            return self.tip_content
        if self.tip_content_localized is None:
            return ""
        return self.tip_content_localized.resolve() or ""


class CardTextBlock(QWidget):
    # 统一标题 + 描述 + 帮助按钮布局，避免多处重复实现。

    DESCRIPTION_COLOR_LIGHT: QColor = QColor(96, 96, 96)
    DESCRIPTION_COLOR_DARK: QColor = QColor(160, 160, 160)
    DESCRIPTION_SPACING: int = 2
    TITLE_ROW_SPACING: int = 6
    TITLE_HELP_SPACING: int = 4
    HELP_ICON: BaseIcon = BaseIcon.BADGE_QUESTION_MARK
    HELP_ICON_SIZE: int = 14
    HELP_BUTTON_SIZE: int = 20
    HELP_TOOLTIP_DELAY_MS: int = 300
    DEFAULT_TIP_DURATION_MS: int = 3000
    DEFAULT_TIP_TAIL_POSITION: TeachingTipTailPosition = TeachingTipTailPosition.BOTTOM

    def __init__(
        self,
        title: str,
        description: str | None,
        help_spec: CardHelpSpec | None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)

        # 标题与描述作为同一块文本区域，便于在 SettingCard 内复用。
        self.title = title
        self.description = description or ""
        self.help_spec = help_spec
        self.description_label: CaptionLabel | None = None

        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(0, 0, 0, 0)
        self.root.setSpacing(self.DESCRIPTION_SPACING)

        self.title_container = QWidget(self)
        self.title_layout = QHBoxLayout(self.title_container)
        self.title_layout.setContentsMargins(0, 0, 0, 0)
        self.title_layout.setSpacing(0)
        self.root.addWidget(self.title_container)

        self.title_label = StrongBodyLabel(title, self)
        self.title_layout.addWidget(
            self.title_label,
            alignment=Qt.AlignmentFlag.AlignVCenter,
        )

        self.help_button: TransparentToolButton | None = None
        self.help_button_container: QWidget | None = None
        if help_spec is not None:
            self.help_button = TransparentToolButton(self.HELP_ICON, self)
            self.help_button.setFixedSize(
                QSize(self.HELP_BUTTON_SIZE, self.HELP_BUTTON_SIZE)
            )
            self.help_button.setIconSize(
                QSize(self.HELP_ICON_SIZE, self.HELP_ICON_SIZE)
            )
            # 通过外层容器下移按钮，避开 TransparentToolButton 的自绘对 padding 的影响。
            self.help_button_container = QWidget(self)
            help_button_layout = QVBoxLayout(self.help_button_container)
            help_button_layout.setContentsMargins(0, 0, 0, 0)
            help_button_layout.setSpacing(0)
            help_button_layout.addWidget(self.help_button)
            self.help_button.setToolTip(Localizer.get().view_more_info)
            self.help_button.installEventFilter(
                ToolTipFilter(
                    self.help_button,
                    self.HELP_TOOLTIP_DELAY_MS,
                    ToolTipPosition.TOP,
                )
            )
            self.help_button.clicked.connect(self.on_help_clicked)
            self.title_layout.addSpacing(self.TITLE_HELP_SPACING)
            self.title_layout.addWidget(
                self.help_button_container,
                alignment=Qt.AlignmentFlag.AlignTop,
            )

        self.title_layout.addStretch(1)

        self.description_container = QWidget(self)
        self.description_layout = QVBoxLayout(self.description_container)
        self.description_layout.setContentsMargins(0, 0, 0, 0)
        self.description_layout.setSpacing(self.DESCRIPTION_SPACING)
        self.root.addWidget(self.description_container)

        self.description_label = CaptionLabel(self.description, self)
        self.description_label.setTextColor(
            self.DESCRIPTION_COLOR_LIGHT, self.DESCRIPTION_COLOR_DARK
        )
        self.description_layout.addWidget(self.description_label)

        self.set_title(title)
        self.set_description(self.description)

    def set_title(self, title: str) -> None:
        # 标题为空时隐藏整行，避免描述文本上方出现无意义留白。
        self.title = title
        self.title_label.setText(title or "")
        self.title_container.setVisible(bool((title or "").strip()))

    def set_description(self, description: str) -> None:
        # 直接更新描述文本，保持渲染逻辑简单一致。
        self.description = description
        if self.description_label is not None:
            self.description_label.setText(description or "")
            self.description_label.setVisible(bool((description or "").strip()))
        self.description_container.setVisible(bool((description or "").strip()))

    def on_help_clicked(self, checked: bool = False) -> None:
        # 根据配置触发外链或 TeachingTip，集中处理问号逻辑。
        del checked
        if self.help_spec is None:
            return

        if self.help_spec.has_tip():
            self.show_teaching_tip(self.help_spec)
            return

        if self.help_spec.has_link():
            url = self.help_spec.resolve_url()
            if url is None:
                return
            QDesktopServices.openUrl(QUrl(url))

    def show_teaching_tip(self, spec: CardHelpSpec) -> None:
        # TeachingTip 统一默认参数，避免页面使用不一致。
        target = spec.tip_target or self.help_button
        if target is None:
            return

        parent = spec.tip_parent or self.window() or self
        duration = spec.tip_duration_ms or self.DEFAULT_TIP_DURATION_MS
        tail_position = spec.tip_tail_position or self.DEFAULT_TIP_TAIL_POSITION
        title = spec.resolve_tip_title()
        content = spec.resolve_tip_content()

        TeachingTip.create(
            target=target,
            title=title,
            content=content,
            icon=self.HELP_ICON,
            duration=duration,
            tailPosition=tail_position,
            parent=parent,
        )

    def get_title_label(self) -> StrongBodyLabel:
        # 暴露标题控件，便于少量场景需要直接调整样式。
        return self.title_label

    def get_description_label(self) -> CaptionLabel | None:
        # 暴露描述控件，便于少量场景需要动态更新样式。
        return self.description_label


class SettingCard(CardWidget):
    # 通用设置卡片：左侧文本块 + 右侧功能区，统一设置页布局。

    CARD_RADIUS: int = 4
    CARD_MARGIN: int = 16
    RIGHT_AREA_SPACING: int = 8

    def __init__(
        self,
        title: str,
        description: str,
        *,
        help_spec: CardHelpSpec | None = None,
        parent: QWidget | None = None,
        init: Callable[["SettingCard"], None] | None = None,
    ) -> None:
        super().__init__(parent)

        # 统一边距与圆角，确保多页面样式一致。
        self.setBorderRadius(self.CARD_RADIUS)
        self.root = QHBoxLayout(self)
        self.root.setContentsMargins(
            self.CARD_MARGIN,
            self.CARD_MARGIN,
            self.CARD_MARGIN,
            self.CARD_MARGIN,
        )

        self.text_block = CardTextBlock(title, description, help_spec, self)
        self.root.addWidget(self.text_block)

        self.root.addStretch(1)

        self.right_container = QWidget(self)
        self.right_layout = QHBoxLayout(self.right_container)
        self.right_layout.setContentsMargins(0, 0, 0, 0)
        self.right_layout.setSpacing(self.RIGHT_AREA_SPACING)
        self.right_layout.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        self.root.addWidget(self.right_container)

        if callable(init):
            init(self)

    def set_description(self, description: str) -> None:
        # 对外统一描述更新入口，保持多行拆分逻辑一致。
        self.text_block.set_description(description)

    def add_right_widget(self, widget: QWidget) -> None:
        # 右侧功能区注入控件，替代旧卡片的薄封装。
        self.right_layout.addWidget(widget)

    def add_right_spacing(self, spacing: int) -> None:
        # 与旧卡片保持能力一致，便于控制控件间距。
        self.right_layout.addSpacing(spacing)

    def clear_right_widgets(self) -> None:
        # 清理右侧控件，便于动态刷新卡片内容。
        for _ in range(self.right_layout.count()):
            item = self.right_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)
                widget.deleteLater()

    def get_text_block(self) -> CardTextBlock:
        # 暴露文本块以便少量场景需要直接访问标题/描述。
        return self.text_block
