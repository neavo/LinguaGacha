from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QSizePolicy
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FluentIcon
from qfluentwidgets import TransparentToolButton

from module.Localizer.Localizer import Localizer


class PaginationBar(QWidget):
    """简化版分页控件"""

    # 页码变化信号
    page_changed = pyqtSignal(int)

    # 固定每页100条
    PAGE_SIZE = 100

    UI_FONT_PX = 12
    UI_ICON_PX = 16
    UI_BTN_PX = 28

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent)

        # 初始化状态
        self.current_page: int = 1
        self.total_pages: int = 1
        self.total_items: int = 0

        self.init_ui()

    def init_ui(self) -> None:
        """初始化 UI"""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)  # 减小间距，使控件更紧凑
        layout.setAlignment(Qt.AlignLeft)  # 左对齐而非居中

        # 上一页按钮（使用扁平透明按钮）
        self.btn_prev = TransparentToolButton(FluentIcon.PAGE_LEFT, self)
        self.btn_prev.setIconSize(QSize(self.UI_ICON_PX, self.UI_ICON_PX))
        self.btn_prev.setFixedSize(self.UI_BTN_PX, self.UI_BTN_PX)
        self.btn_prev.clicked.connect(self.on_prev_clicked)
        layout.addWidget(self.btn_prev)

        # 页码信息标签
        self.page_info_label = CaptionLabel()
        font = QFont(self.page_info_label.font())
        font.setPixelSize(self.UI_FONT_PX)
        self.page_info_label.setFont(font)
        # 设置最小宽度以适应较长的页码文本（如"第 999 / 999 页"）
        self.page_info_label.setMinimumWidth(96)
        self.page_info_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(self.page_info_label)

        # 下一页按钮（使用扁平透明按钮）
        self.btn_next = TransparentToolButton(FluentIcon.PAGE_RIGHT, self)
        self.btn_next.setIconSize(QSize(self.UI_ICON_PX, self.UI_ICON_PX))
        self.btn_next.setFixedSize(self.UI_BTN_PX, self.UI_BTN_PX)
        self.btn_next.clicked.connect(self.on_next_clicked)
        layout.addWidget(self.btn_next)

        # 翻页按钮与页码文本使用同一字号，保证视觉一致。
        btn_font = QFont(self.btn_prev.font())
        btn_font.setPixelSize(self.UI_FONT_PX)
        self.btn_prev.setFont(btn_font)
        self.btn_next.setFont(btn_font)

        # 设置尺寸策略，确保控件不占用额外空间
        self.setSizePolicy(QSizePolicy.Minimum, QSizePolicy.Preferred)

        # 更新显示
        self.update_display()

    def on_prev_clicked(self) -> None:
        """上一页按钮点击"""
        if self.current_page > 1:
            self.current_page -= 1
            self.update_display()
            self.page_changed.emit(self.current_page)

    def on_next_clicked(self) -> None:
        """下一页按钮点击"""
        if self.current_page < self.total_pages:
            self.current_page += 1
            self.update_display()
            self.page_changed.emit(self.current_page)

    def update_display(self) -> None:
        """更新显示状态"""
        # 更新按钮状态
        self.btn_prev.setEnabled(self.current_page > 1)
        self.btn_next.setEnabled(self.current_page < self.total_pages)

        # 更新页码信息: "第 1/10 页"
        page_info = Localizer.get().proofreading_page_page_info
        page_info = page_info.replace("{CURRENT}", str(self.current_page))
        page_info = page_info.replace("{TOTAL}", str(self.total_pages))
        self.page_info_label.setText(page_info)

    def set_total(self, total: int) -> None:
        """设置总条目数"""
        self.total_items = total
        self.total_pages = max(1, (total + self.PAGE_SIZE - 1) // self.PAGE_SIZE)
        self.current_page = min(self.current_page, self.total_pages)
        self.update_display()

    def set_page(self, page: int) -> None:
        """设置当前页码"""
        if 1 <= page <= self.total_pages:
            self.current_page = page
            self.update_display()

    def get_page(self) -> int:
        """获取当前页码"""
        return self.current_page

    def get_page_size(self) -> int:
        """获取每页条数"""
        return self.PAGE_SIZE

    def get_total_items(self) -> int:
        """获取总条目数"""
        return self.total_items

    def reset(self) -> None:
        """重置到初始状态"""
        self.current_page = 1
        self.total_pages = 1
        self.total_items = 0
        self.update_display()
