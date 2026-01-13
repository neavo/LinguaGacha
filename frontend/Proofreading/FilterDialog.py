from PyQt5.QtWidgets import QGridLayout
from PyQt5.QtWidgets import QScrollArea
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import CheckBox
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SubtitleLabel

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ErrorType

class FilterDialog(MessageBoxBase):
    """筛选对话框"""

    NO_ERROR_TAG = "NO_ERROR"

    def __init__(self, items: list[Item], parent: QWidget) -> None:
        super().__init__(parent)

        self.items = items
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化 UI"""
        # 设置宽度
        self.widget.setMinimumWidth(540)  # 稍微加宽以容纳卡片 padding
        self.viewLayout.setSpacing(16)    # 卡片之间的间距

        # ========== 错误类型分组 ==========
        self.error_checkboxes: dict = {}
        error_card = self._create_section_card(Localizer.get().proofreading_page_filter_error_type)

        # 网格布局
        error_grid = QGridLayout()
        error_grid.setContentsMargins(0, 0, 0, 0)
        error_grid.setSpacing(12)

        # 移除了 UNTRANSLATED，只保留真正的错误类型
        error_types = [
            (self.NO_ERROR_TAG, "无错误"),
            (ErrorType.KANA, Localizer.get().proofreading_page_error_kana),
            (ErrorType.HANGEUL, Localizer.get().proofreading_page_error_hangeul),
            (ErrorType.TEXT_PRESERVE, Localizer.get().proofreading_page_error_text_preserve),
            (ErrorType.SIMILARITY, Localizer.get().proofreading_page_error_similarity),
            (ErrorType.GLOSSARY, Localizer.get().proofreading_page_error_glossary),
            (ErrorType.RETRY_THRESHOLD, Localizer.get().proofreading_page_error_retry),
        ]

        for i, (error_type, label) in enumerate(error_types):
            checkbox = CheckBox(label)
            checkbox.setChecked(True)
            self.error_checkboxes[error_type] = checkbox
            error_grid.addWidget(checkbox, i // 2, i % 2)

        # 将网格添加到卡片布局中（标题之后）
        error_card.layout().addLayout(error_grid)
        self.viewLayout.addWidget(error_card)

        # ========== 翻译状态分组 ==========
        self.status_checkboxes: dict[Base.ProjectStatus, CheckBox] = {}
        status_card = self._create_section_card(Localizer.get().proofreading_page_filter_status)

        status_layout = QGridLayout()
        status_layout.setContentsMargins(0, 0, 0, 0)
        status_layout.setSpacing(12)

        status_types = [
            (Base.ProjectStatus.NONE, Localizer.get().proofreading_page_status_none),
            (Base.ProjectStatus.PROCESSING, Localizer.get().proofreading_page_status_processing),
            (Base.ProjectStatus.PROCESSED, Localizer.get().proofreading_page_status_processed),
            (Base.ProjectStatus.PROCESSED_IN_PAST, Localizer.get().proofreading_page_status_processed_in_past),
            (Base.ProjectStatus.EXCLUDED, Localizer.get().proofreading_page_status_excluded),
            (Base.ProjectStatus.DUPLICATED, Localizer.get().proofreading_page_status_duplicated),
        ]

        for i, (status, label) in enumerate(status_types):
            checkbox = CheckBox(label)
            checkbox.setChecked(True)
            self.status_checkboxes[status] = checkbox
            status_layout.addWidget(checkbox, i // 2, i % 2)

        status_card.layout().addLayout(status_layout)
        self.viewLayout.addWidget(status_card)

        # ========== 所属文件分组 ==========
        self.file_checkboxes: dict[str, CheckBox] = {}
        file_card = self._create_section_card(Localizer.get().proofreading_page_filter_file)

        file_paths = sorted(set(item.get_file_path() for item in self.items))

        # 创建滚动区域
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setMaximumHeight(200)
        scroll_area.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        # 文件列表容器
        file_container = QWidget()
        file_layout = QVBoxLayout(file_container)
        file_layout.setContentsMargins(0, 0, 0, 0)
        file_layout.setSpacing(8)

        for path in file_paths:
            display_name = path.split("/")[-1] if "/" in path else path.split("\\")[-1] if "\\" in path else path
            checkbox = CheckBox(display_name)
            checkbox.setChecked(True)
            checkbox.setToolTip(path)
            self.file_checkboxes[path] = checkbox
            file_layout.addWidget(checkbox)

        file_layout.addStretch()
        scroll_area.setWidget(file_container)

        file_card.layout().addWidget(scroll_area)
        self.viewLayout.addWidget(file_card)

        # 设置按钮文本
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

    def _create_section_card(self, title_text: str) -> CardWidget:
        """创建带标题的分组卡片"""
        card = CardWidget()
        card.setBorderRadius(8)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        title = SubtitleLabel(title_text)
        layout.addWidget(title)

        return card

    def get_filter_options(self) -> dict:
        """获取当前筛选选项"""
        selected_errors = {e for e, cb in self.error_checkboxes.items() if cb.isChecked()}
        selected_statuses = {s for s, cb in self.status_checkboxes.items() if cb.isChecked()}
        selected_files = {f for f, cb in self.file_checkboxes.items() if cb.isChecked()}

        return {
            "error_types": selected_errors,  # 即使全选也不返回 None，确保全选时过滤掉无错误的条目；全不选时为空集合，被视为不筛选
            "statuses": selected_statuses if selected_statuses != set(self.status_checkboxes.keys()) else None,
            "file_paths": selected_files if selected_files != set(self.file_checkboxes.keys()) else None,
        }

    def set_filter_options(self, options: dict) -> None:
        """设置筛选选项"""
        error_types = options.get("error_types")
        for error_type, checkbox in self.error_checkboxes.items():
            checkbox.setChecked(error_types is None or error_type in error_types)

        statuses = options.get("statuses")
        for status, checkbox in self.status_checkboxes.items():
            checkbox.setChecked(statuses is None or status in statuses)

        file_paths = options.get("file_paths")
        for path, checkbox in self.file_checkboxes.items():
            checkbox.setChecked(file_paths is None or path in file_paths)
