from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import PushButton

from module.Localizer.Localizer import Localizer

class PaginationBar(QWidget):
    """简化版分页控件"""

    # 页码变化信号
    page_changed = pyqtSignal(int)

    # 固定每页100条
    PAGE_SIZE = 100

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent)

        # 初始化状态
        self._current_page: int = 1
        self._total_pages: int = 1
        self._total_items: int = 0

        self._init_ui()

    def _init_ui(self) -> None:
        """初始化 UI"""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        # 上一页按钮
        self.btn_prev = PushButton("◀")
        self.btn_prev.setFixedWidth(36)
        self.btn_prev.clicked.connect(self._on_prev_clicked)
        layout.addWidget(self.btn_prev)

        # 页码信息标签
        self.page_info_label = CaptionLabel()
        layout.addWidget(self.page_info_label)

        # 下一页按钮
        self.btn_next = PushButton("▶")
        self.btn_next.setFixedWidth(36)
        self.btn_next.clicked.connect(self._on_next_clicked)
        layout.addWidget(self.btn_next)

        # 更新显示
        self._update_display()

    def _on_prev_clicked(self) -> None:
        """上一页按钮点击"""
        if self._current_page > 1:
            self._current_page -= 1
            self._update_display()
            self.page_changed.emit(self._current_page)

    def _on_next_clicked(self) -> None:
        """下一页按钮点击"""
        if self._current_page < self._total_pages:
            self._current_page += 1
            self._update_display()
            self.page_changed.emit(self._current_page)

    def _update_display(self) -> None:
        """更新显示状态"""
        # 更新按钮状态
        self.btn_prev.setEnabled(self._current_page > 1)
        self.btn_next.setEnabled(self._current_page < self._total_pages)

        # 更新页码信息: "第 1/10 页"
        page_info = Localizer.get().proofreading_page_page_info
        page_info = page_info.replace("{CURRENT}", str(self._current_page))
        page_info = page_info.replace("{TOTAL}", str(self._total_pages))
        self.page_info_label.setText(page_info)

    def set_total(self, total: int) -> None:
        """设置总条目数"""
        self._total_items = total
        self._total_pages = max(1, (total + self.PAGE_SIZE - 1) // self.PAGE_SIZE)
        self._current_page = min(self._current_page, self._total_pages)
        self._update_display()

    def set_page(self, page: int) -> None:
        """设置当前页码"""
        if 1 <= page <= self._total_pages:
            self._current_page = page
            self._update_display()

    def get_page(self) -> int:
        """获取当前页码"""
        return self._current_page

    def get_page_size(self) -> int:
        """获取每页条数"""
        return self.PAGE_SIZE

    def get_total_items(self) -> int:
        """获取总条目数"""
        return self._total_items

    def reset(self) -> None:
        """重置到初始状态"""
        self._current_page = 1
        self._total_pages = 1
        self._total_items = 0
        self._update_display()
