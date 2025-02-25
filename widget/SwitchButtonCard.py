from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout

from qfluentwidgets import CardWidget
from qfluentwidgets import SwitchButton
from qfluentwidgets import CaptionLabel
from qfluentwidgets import StrongBodyLabel

class SwitchButtonCard(CardWidget):

    def __init__(self, title: str, description: str, init = None, checked_changed = None) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.hbox = QHBoxLayout(self)
        self.hbox.setContentsMargins(16, 16, 16, 16) # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.description_label = CaptionLabel(description, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))

        self.vbox.addWidget(self.title_label)
        self.vbox.addWidget(self.description_label)
        self.hbox.addLayout(self.vbox)

        # 填充
        self.hbox.addStretch(1)

        # 添加控件
        self.switch_button = SwitchButton()
        self.switch_button.setOnText("")
        self.switch_button.setOffText("")
        self.hbox.addWidget(self.switch_button)

        if callable(init):
            init(self)

        if callable(checked_changed):
            self.switch_button.checkedChanged.connect(lambda checked: checked_changed(self, checked))

    # 设置选中状态
    def set_checked(self, checked: bool) -> None:
        self.switch_button.setChecked(checked)