from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import ComboBox
from qfluentwidgets import RoundMenu

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ErrorType

class FilterMenu(RoundMenu):
    """筛选菜单"""

    # 筛选变化信号
    filter_changed = pyqtSignal(dict)

    def __init__(self, parent: QWidget = None) -> None:
        super().__init__(parent=parent)

        # 创建容器组件
        self.container = QWidget()
        self.container.setMinimumWidth(250)
        layout = QVBoxLayout(self.container)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        # 错误类型筛选
        error_label = CaptionLabel(Localizer.get().proofreading_page_filter_error_type)
        layout.addWidget(error_label)

        self.error_combo = ComboBox()
        self._init_error_options()
        layout.addWidget(self.error_combo)

        # 翻译状态筛选
        status_label = CaptionLabel(Localizer.get().proofreading_page_filter_status)
        layout.addWidget(status_label)

        self.status_combo = ComboBox()
        self._init_status_options()
        layout.addWidget(self.status_combo)

        # 所属文件筛选
        file_label = CaptionLabel(Localizer.get().proofreading_page_filter_file)
        layout.addWidget(file_label)

        self.file_combo = ComboBox()
        self.file_combo.addItem(Localizer.get().proofreading_page_filter_all, userData=None)
        layout.addWidget(self.file_combo)

        # 添加到菜单
        self.addWidget(self.container)

        # 连接信号
        self.error_combo.currentIndexChanged.connect(self._on_filter_changed)
        self.status_combo.currentIndexChanged.connect(self._on_filter_changed)
        self.file_combo.currentIndexChanged.connect(self._on_filter_changed)

    def _init_error_options(self) -> None:
        """初始化错误类型选项"""
        self.error_combo.addItem(Localizer.get().proofreading_page_filter_all, userData=None)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_kana, userData=ErrorType.KANA)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_hangeul, userData=ErrorType.HANGEUL)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_text_preserve, userData=ErrorType.TEXT_PRESERVE)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_similarity, userData=ErrorType.SIMILARITY)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_glossary, userData=ErrorType.GLOSSARY)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_untranslated, userData=ErrorType.UNTRANSLATED)
        self.error_combo.addItem(Localizer.get().proofreading_page_error_retry, userData=ErrorType.RETRY_THRESHOLD)

    def _init_status_options(self) -> None:
        """初始化翻译状态选项"""
        self.status_combo.addItem(Localizer.get().proofreading_page_filter_all, userData=None)
        self.status_combo.addItem(Localizer.get().proofreading_page_status_processed, userData=Base.ProjectStatus.PROCESSED)
        self.status_combo.addItem(Localizer.get().proofreading_page_status_none, userData=Base.ProjectStatus.NONE)

    def update_file_options(self, items: list[Item]) -> None:
        """根据数据更新文件筛选选项"""
        # 保存当前选择
        current_data = self.file_combo.currentData()

        # 收集所有文件路径
        file_paths = sorted(set(item.get_file_path() for item in items))

        # 重新填充选项
        self.file_combo.blockSignals(True)
        self.file_combo.clear()
        self.file_combo.addItem(Localizer.get().proofreading_page_filter_all, userData=None)
        for path in file_paths:
            # 显示简短的文件名
            display_name = path.split("/")[-1] if "/" in path else path.split("\\")[-1] if "\\" in path else path
            self.file_combo.addItem(display_name, userData=path)

        # 恢复选择
        for i in range(self.file_combo.count()):
            if self.file_combo.itemData(i) == current_data:
                self.file_combo.setCurrentIndex(i)
                break
        self.file_combo.blockSignals(False)

    def get_filter_options(self) -> dict:
        """获取当前筛选选项"""
        return {
            "error_type": self.error_combo.currentData(),
            "status": self.status_combo.currentData(),
            "file_path": self.file_combo.currentData(),
        }

    def _on_filter_changed(self, index: int) -> None:
        """筛选条件变化"""
        self.filter_changed.emit(self.get_filter_options())

    def reset(self) -> None:
        """重置筛选条件"""
        self.error_combo.setCurrentIndex(0)
        self.status_combo.setCurrentIndex(0)
        self.file_combo.setCurrentIndex(0)
