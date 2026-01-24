from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import MessageBoxBase

from module.Localizer.Localizer import Localizer
from widget.CustomTextEdit import CustomTextEdit
from widget.GroupCard import GroupCard


class TextEditDialog(MessageBoxBase):
    """使用统一风格重构的多行文本编辑对话框"""

    def __init__(
        self, src_text: str, dst_text: str, file_path: str, parent: QWidget
    ) -> None:
        super().__init__(parent)

        self.src_text = src_text
        self.dst_text = dst_text
        self.file_path = file_path
        self.init_ui()

    def init_ui(self) -> None:
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
        def init_src(widget: GroupCard) -> None:
            self.src_text_edit = CustomTextEdit(widget)
            self.src_text_edit.setPlainText(self.src_text)
            self.src_text_edit.setReadOnly(True)
            self.src_text_edit.setMinimumHeight(128)
            widget.add_widget(self.src_text_edit)

        self.src_card = GroupCard(
            parent=self.widget,
            title=Localizer.get().proofreading_page_col_src,
            init=init_src,
        )
        self.viewLayout.addWidget(self.src_card)

        # ========== Destination Card (Editable) ==========
        def init_dst(widget: GroupCard) -> None:
            self.dst_text_edit = CustomTextEdit(widget)
            self.dst_text_edit.setPlainText(self.dst_text)
            self.dst_text_edit.setMinimumHeight(128)
            widget.add_widget(self.dst_text_edit)
            # 延迟设置焦点
            self.dst_text_edit.setFocus()

        self.dst_card = GroupCard(
            parent=self.widget,
            title=Localizer.get().proofreading_page_col_dst,
            init=init_dst,
        )
        # 最后一个参数 1 表示拉伸因子，让译文卡片占据更多空间（如果不再垂直拉伸，可以为 0）
        # 这里原来的实现给 dst_card 加了 stretch 1，保持一致
        self.viewLayout.addWidget(self.dst_card, 1)

        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

    def get_dst_text(self) -> str:
        """获取编辑后的翻译文本"""
        return self.dst_text_edit.toPlainText()
