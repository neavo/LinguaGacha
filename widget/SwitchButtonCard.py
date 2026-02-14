import re
from typing import Callable

from PySide6.QtCore import QUrl
from PySide6.QtGui import QColor
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import SwitchButton


class SwitchButtonCard(CardWidget):
    def __init__(
        self,
        title: str,
        description: str,
        init: Callable = None,
        checked_changed: Callable = None,
    ) -> None:
        super().__init__(None)

        # 设置容器
        self.setBorderRadius(4)
        self.hbox = QHBoxLayout(self)
        self.hbox.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.vbox.addWidget(self.title_label)

        # 描述区单独容器：用更紧凑的 spacing，避免多行拆分导致行距过大。
        desc_container = QWidget(self)
        desc_layout = QVBoxLayout(desc_container)
        desc_layout.setContentsMargins(0, 0, 0, 0)
        desc_layout.setSpacing(2)

        # 按 <br> 分割为多行，然后每行单独处理超链接
        lines = re.split(r"<br\s*/?>", description)

        for line in lines:
            if not line.strip():
                continue

            # 使用正则表达式匹配超链接格式 [文本](URL)，支持文本内含方括号
            pattern = r"\[(.+?)\]\(([^)]+)\)"
            parts = re.split(pattern, line)

            # 如果没有找到超链接格式，使用普通的CaptionLabel
            if len(parts) == 1:
                label = CaptionLabel(line, self)
                label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
                desc_layout.addWidget(label)
            else:
                # 解析描述文本中的超链接
                line_container = QWidget()
                line_layout = QHBoxLayout(line_container)
                line_layout.setContentsMargins(0, 0, 0, 0)
                line_layout.setSpacing(0)

                # 处理包含超链接的文本
                link_text = ""
                for i, part in enumerate(parts):
                    if i % 3 == 0:  # 普通文本
                        if part:  # 非空字符串
                            label = CaptionLabel(part, self)
                            label.setTextColor(
                                QColor(96, 96, 96), QColor(160, 160, 160)
                            )
                            line_layout.addWidget(label)
                    elif i % 3 == 1:  # 超链接文本
                        link_text = part
                    elif i % 3 == 2:  # 超链接URL
                        url = part
                        link_label = HyperlinkLabel(link_text, self)
                        # 获取CaptionLabel的字体大小并应用到HyperlinkLabel
                        caption_font = CaptionLabel("", self).font()
                        link_label.setFont(caption_font)
                        link_label.setUrl(url)
                        link_label.clicked.connect(
                            lambda checked, u=url: QDesktopServices.openUrl(QUrl(u))
                        )
                        line_layout.addWidget(link_label)

                line_layout.addStretch(1)
                desc_layout.addWidget(line_container)

        self.vbox.addWidget(desc_container)

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
            self.switch_button.checkedChanged.connect(lambda _: checked_changed(self))

    def get_switch_button(self) -> SwitchButton:
        return self.switch_button
