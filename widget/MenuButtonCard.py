import re
from typing import Callable

from PySide6.QtCore import QPoint
from PySide6.QtCore import QUrl
from PySide6.QtGui import QColor
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import HyperlinkLabel
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import StrongBodyLabel


class MenuButtonCard(CardWidget):
    def __init__(
        self,
        title: str,
        description: str,
        button_text: str,
        init: Callable = None,
        before_show_menu: Callable = None,
    ) -> None:
        super().__init__(None)

        self.before_show_menu = before_show_menu
        self.menu: RoundMenu | None = None

        # 设置容器
        self.setBorderRadius(4)
        self.hbox = QHBoxLayout(self)
        self.hbox.setContentsMargins(16, 16, 16, 16)  # 左、上、右、下

        # 文本控件
        self.vbox = QVBoxLayout()

        self.title_label = StrongBodyLabel(title, self)
        self.vbox.addWidget(self.title_label)

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
                self.vbox.addWidget(label)
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
                self.vbox.addWidget(line_container)

        self.hbox.addLayout(self.vbox)

        # 填充
        self.hbox.addStretch(1)

        # 添加控件
        self.push_button = PushButton(button_text)
        self.push_button.clicked.connect(self.on_push_button_clicked)
        self.hbox.addWidget(self.push_button)

        if callable(init):
            init(self)

    def set_menu(self, menu: RoundMenu) -> None:
        self.menu = menu

    def get_push_button(self) -> PushButton:
        return self.push_button

    def on_push_button_clicked(self) -> None:
        if callable(self.before_show_menu):
            self.before_show_menu(self)

        if self.menu is None:
            return

        global_pos = self.push_button.mapToGlobal(QPoint(0, self.push_button.height()))
        self.menu.exec(global_pos)
