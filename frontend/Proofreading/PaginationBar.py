from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import ComboBox
from qfluentwidgets import PushButton
from qfluentwidgets import SpinBox

from module.Localizer.Localizer import Localizer

class PaginationBar(QWidget):
    """分页控件"""

    # 页码变化信号
    page_changed = pyqtSignal(int)

    # 每页条数选项
    PAGE_SIZE_OPTIONS = [50, 100, 200]

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent)

        # 初始化状态
        self._current_page: int = 1
        self._total_pages: int = 1
        self._page_size: int = 50
        self._total_items: int = 0

        self._init_ui()
        self._connect_signals()

    def _init_ui(self) -> None:
        """初始化 UI"""
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 8, 0, 8)
        layout.setSpacing(12)

        # 上一页按钮
        self.btn_prev = PushButton(Localizer.get().proofreading_page_prev_page)
        self.btn_prev.setFixedWidth(80)
        layout.addWidget(self.btn_prev)

        # 页码输入框
        self.page_input = SpinBox()
        self.page_input.setRange(1, 1)
        self.page_input.setFixedWidth(80)
        layout.addWidget(self.page_input)

        # 页码信息标签
        self.page_info_label = CaptionLabel()
        self.page_info_label.setFixedWidth(100)
        layout.addWidget(self.page_info_label)

        # 下一页按钮
        self.btn_next = PushButton(Localizer.get().proofreading_page_next_page)
        self.btn_next.setFixedWidth(80)
        layout.addWidget(self.btn_next)

        # 弹性空间
        layout.addStretch()

        # 每页条数选择
        self.per_page_label = CaptionLabel(Localizer.get().proofreading_page_per_page)
        layout.addWidget(self.per_page_label)

        self.page_size_combo = ComboBox()
        for size in self.PAGE_SIZE_OPTIONS:
            self.page_size_combo.addItem(f"{size} {Localizer.get().proofreading_page_items}", userData=size)
        self.page_size_combo.setCurrentIndex(0)
        self.page_size_combo.setFixedWidth(100)
        layout.addWidget(self.page_size_combo)

        # 总条目数标签
        self.total_label = CaptionLabel()
        layout.addWidget(self.total_label)

        # 更新显示
        self._update_display()

    def _connect_signals(self) -> None:
        """连接信号"""
        self.btn_prev.clicked.connect(self._on_prev_clicked)
        self.btn_next.clicked.connect(self._on_next_clicked)
        self.page_input.valueChanged.connect(self._on_page_input_changed)
        self.page_size_combo.currentIndexChanged.connect(self._on_page_size_changed)

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

    def _on_page_input_changed(self, value: int) -> None:
        """页码输入变化"""
        if 1 <= value <= self._total_pages and value != self._current_page:
            self._current_page = value
            self._update_display()
            self.page_changed.emit(self._current_page)

    def _on_page_size_changed(self, index: int) -> None:
        """每页条数变化"""
        new_size = self.page_size_combo.itemData(index)
        if new_size and new_size != self._page_size:
            self._page_size = new_size
            # 重新计算总页数和当前页
            self._total_pages = max(1, (self._total_items + self._page_size - 1) // self._page_size)
            self._current_page = min(self._current_page, self._total_pages)
            self._update_display()
            self.page_changed.emit(self._current_page)

    def _update_display(self) -> None:
        """更新显示状态"""
        # 更新按钮状态
        self.btn_prev.setEnabled(self._current_page > 1)
        self.btn_next.setEnabled(self._current_page < self._total_pages)

        # 更新页码输入框
        self.page_input.blockSignals(True)
        self.page_input.setRange(1, max(1, self._total_pages))
        self.page_input.setValue(self._current_page)
        self.page_input.blockSignals(False)

        # 更新页码信息
        page_info = Localizer.get().proofreading_page_page_info
        page_info = page_info.replace("{CURRENT}", str(self._current_page))
        page_info = page_info.replace("{TOTAL}", str(self._total_pages))
        self.page_info_label.setText(page_info)

        # 更新总条目数
        self.total_label.setText(f"{self._total_items} {Localizer.get().proofreading_page_items}")

    def set_total(self, total: int) -> None:
        """设置总条目数"""
        self._total_items = total
        self._total_pages = max(1, (total + self._page_size - 1) // self._page_size)
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
        return self._page_size

    def reset(self) -> None:
        """重置到初始状态"""
        self._current_page = 1
        self._total_pages = 1
        self._total_items = 0
        self._update_display()
