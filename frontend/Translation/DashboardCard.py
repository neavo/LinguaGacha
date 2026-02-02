from typing import Callable

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QGraphicsOpacityEffect
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import IconWidget
from qfluentwidgets import LargeTitleLabel
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import SubtitleLabel

from base.BaseIcon import BaseIcon
from widget.Separator import Separator

# ==================== 图标常量 ====================

ICON_SWITCH_MODE: BaseIcon = BaseIcon.REPEAT_2  # 卡片：提示可切换显示模式


class DashboardCard(CardWidget):
    def __init__(
        self,
        parent: QWidget,
        title: str,
        value: str,
        unit: str,
        init: Callable = None,
        clicked: Callable = None,
    ) -> None:
        super().__init__(parent)

        # 设置容器
        self.setBorderRadius(4)
        self.root = QVBoxLayout(self)
        self.root.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 标题栏容器（支持右侧图标）
        self.title_hbox_container = QWidget(self)
        self.title_hbox = QHBoxLayout(self.title_hbox_container)
        self.title_hbox.setContentsMargins(0, 0, 0, 0)
        self.title_hbox.setSpacing(8)

        self.title_label = SubtitleLabel(title, self)
        self.title_hbox.addWidget(self.title_label)
        self.title_hbox.addStretch(1)
        self.root.addWidget(self.title_hbox_container)

        # 添加分割线
        self.root.addWidget(Separator(self))

        # 添加控件
        self.body_hbox_container = QWidget(self)
        self.body_hbox = QHBoxLayout(self.body_hbox_container)
        self.body_hbox.setSpacing(0)
        self.body_hbox.setContentsMargins(0, 0, 0, 0)

        self.unit_vbox_container = QWidget(self)
        self.unit_vbox = QVBoxLayout(self.unit_vbox_container)
        self.unit_vbox.setSpacing(0)
        self.unit_vbox.setContentsMargins(0, 0, 0, 0)

        self.unit_label = StrongBodyLabel(unit, self)
        self.unit_label.setAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft
        )
        self.unit_vbox.addSpacing(20)
        self.unit_vbox.addWidget(self.unit_label)

        self.value_label = LargeTitleLabel(value, self)
        self.value_label.setAlignment(
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight
        )

        self.body_hbox.addStretch(1)
        self.body_hbox.addWidget(self.value_label, 1)
        self.body_hbox.addSpacing(6)
        self.body_hbox.addWidget(self.unit_vbox_container)
        self.body_hbox.addStretch(1)
        self.root.addWidget(self.body_hbox_container, 1)

        # 如果是可点击卡片，添加一个切换提示图标（采用绝对定位，不占用布局空间）
        if callable(clicked):
            self.footer_hbox_container = QWidget(self)
            self.footer_hbox = QHBoxLayout(self.footer_hbox_container)
            self.footer_hbox.setContentsMargins(0, 0, 0, 0)
            self.footer_hbox.addStretch(1)

            self.switch_icon = IconWidget(ICON_SWITCH_MODE, self)
            self.switch_icon.setFixedSize(14, 14)
            # 设置较浅的颜色，保持视觉轻量
            self.opacity_effect = QGraphicsOpacityEffect(self.switch_icon)
            self.opacity_effect.setOpacity(0.5)
            self.switch_icon.setGraphicsEffect(self.opacity_effect)

            self.footer_hbox.addWidget(self.switch_icon)
            self.footer_hbox_container.setFixedSize(14, 14)

        if callable(init):
            init(self)

        if callable(clicked):
            self.clicked.connect(lambda: clicked(self))

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        # 将切换图标固定在右下角
        if hasattr(self, "footer_hbox_container"):
            margin = 16
            self.footer_hbox_container.move(
                self.width() - self.footer_hbox_container.width() - margin,
                self.height() - self.footer_hbox_container.height() - margin,
            )

    def set_unit(self, unit: str) -> None:
        self.unit_label.setText(unit)

    def set_value(self, value: str) -> None:
        self.value_label.setText(value)
