from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PlainTextEdit
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import isDarkTheme

from module.Localizer.Localizer import Localizer
from widget.Separator import Separator

class TextEditDialog(MessageBoxBase):
    """使用统一风格重构的多行文本编辑对话框"""

    def __init__(self, src_text: str, dst_text: str, file_path: str, parent: QWidget) -> None:
        super().__init__(parent)

        self.src_text = src_text
        self.dst_text = dst_text
        self.file_path = file_path
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化 UI"""
        # 略微减小尺寸以提升动画性能
        self.widget.setMinimumWidth(768)
        self.widget.setMinimumHeight(640)
        self.viewLayout.setSpacing(16)

        if self.file_path:
            file_card = CardWidget(self.widget)
            file_card.setBorderRadius(4)

            file_layout = QHBoxLayout(file_card)
            file_layout.setContentsMargins(12, 8, 12, 8)
            file_layout.setSpacing(8)

            icon = IconWidget(FluentIcon.FOLDER)
            icon.setFixedSize(16, 16)
            file_layout.addWidget(icon)

            label = CaptionLabel(self.file_path)
            label.setTextColor("#808080", "#808080")
            file_layout.addWidget(label)
            file_layout.addStretch(1)

            self.viewLayout.addWidget(file_card)

        # ========== Source Card (Read-only) ==========
        self.src_card = self.create_group_card(Localizer.get().proofreading_page_col_src)

        # 根据主题确定字体颜色
        text_color = "white" if isDarkTheme() else "black"

        self.src_text_edit = PlainTextEdit(self.src_card)
        self.src_text_edit.setPlainText(self.src_text)
        self.src_text_edit.setReadOnly(True)
        self.src_text_edit.setMinimumHeight(128)
        # 扁平化样式：原文作为参考，去框去背景，融入卡片
        self.src_text_edit.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: transparent;
                border: none;
                padding: 0px;
                color: {text_color};
                font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
            }}
        """)

        self.src_card.layout().addWidget(self.src_text_edit)
        self.viewLayout.addWidget(self.src_card)

        self.dst_card = self.create_group_card(Localizer.get().proofreading_page_col_dst)

        self.dst_text_edit = PlainTextEdit(self.dst_card)
        self.dst_text_edit.setPlainText(self.dst_text)
        self.dst_text_edit.setMinimumHeight(128)
        # 扁平化样式：译文区域半透明背景，无边框，简约风格
        self.dst_text_edit.setStyleSheet(f"""
            QPlainTextEdit {{
                background-color: rgba(0, 0, 0, 0.035);
                border: none;
                border-radius: 6px;
                padding: 8px;
                color: {text_color};
                font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
            }}
        """)

        self.dst_card.layout().addWidget(self.dst_text_edit)
        self.viewLayout.addWidget(self.dst_card, 1)

        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

        self.dst_text_edit.setFocus()

    def create_group_card(self, title: str) -> CardWidget:
        """创建风格类似于 GroupCard 但更轻量的卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(12, 8, 12, 12)

        # 手动编排元素间距
        layout.setSpacing(0)

        # 标题
        layout.addWidget(StrongBodyLabel(title, card))
        layout.addSpacing(6)

        # 分割线
        layout.addWidget(Separator(card))
        layout.addSpacing(8)

        return card

    def get_dst_text(self) -> str:
        """获取编辑后的翻译文本"""
        return self.dst_text_edit.toPlainText()
