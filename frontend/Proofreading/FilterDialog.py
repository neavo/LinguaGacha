from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QListWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import CheckBox
from qfluentwidgets import FlowLayout
from qfluentwidgets import ListWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PushButton
from qfluentwidgets import StrongBodyLabel

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import WarningType
from widget.Separator import Separator

class FilterDialog(MessageBoxBase):
    """高度定制化的筛选对话框，模仿接口列表样式"""

    NO_WARNING_TAG = "NO_WARNING"

    # 筛选选项字典 Key 定义
    KEY_WARNING_TYPES = "warning_types"
    KEY_STATUSES = "statuses"
    KEY_FILE_PATHS = "file_paths"

    def __init__(self, items: list[Item], parent: QWidget) -> None:
        super().__init__(parent)
        # 仅针对可见状态进行筛选
        self.items = [i for i in items if i.get_status() not in (Base.ProjectStatus.EXCLUDED, Base.ProjectStatus.DUPLICATED)]
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化 UI"""
        self.widget.setMinimumWidth(680)
        # 调整 Dialog 内部间距
        self.viewLayout.setSpacing(16)
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        # ========== 1. 警告类型模块 ==========
        self.warning_checkboxes = {}
        warning_types = [
            (self.NO_WARNING_TAG, Localizer.get().proofreading_page_filter_no_warning),
            (WarningType.KANA, Localizer.get().proofreading_page_warning_kana),
            (WarningType.HANGEUL, Localizer.get().proofreading_page_warning_hangeul),
            (WarningType.TEXT_PRESERVE, Localizer.get().proofreading_page_warning_text_preserve),
            (WarningType.SIMILARITY, Localizer.get().proofreading_page_warning_similarity),
            (WarningType.GLOSSARY, Localizer.get().proofreading_page_warning_glossary),
            (WarningType.RETRY_THRESHOLD, Localizer.get().proofreading_page_warning_retry),
        ]

        self.warning_card, warning_layout, _ = self._create_section_card(
            Localizer.get().proofreading_page_filter_warning_type
        )

        for warning_type, label in warning_types:
            cb = CheckBox(label)
            cb.setChecked(True)
            # 固定宽度以在 FlowLayout 中保持整齐
            cb.setFixedWidth(160)
            self.warning_checkboxes[warning_type] = cb
            warning_layout.addWidget(cb)

        self.viewLayout.addWidget(self.warning_card)

        # ========== 2. 翻译状态模块 ==========
        self.status_checkboxes = {}
        status_types = [
            (Base.ProjectStatus.NONE, Localizer.get().proofreading_page_status_none),
            (Base.ProjectStatus.PROCESSED, Localizer.get().proofreading_page_status_processed),
            (Base.ProjectStatus.PROCESSED_IN_PAST, Localizer.get().proofreading_page_status_processed_in_past),
        ]

        self.status_card, status_layout, _ = self._create_section_card(
            Localizer.get().proofreading_page_filter_status
        )

        for status, label in status_types:
            cb = CheckBox(label)
            cb.setChecked(True)
            cb.setFixedWidth(160)
            self.status_checkboxes[status] = cb
            status_layout.addWidget(cb)

        self.viewLayout.addWidget(self.status_card)

        # ========== 3. 所属文件模块 ==========
        self.file_list = ListWidget()
        self.file_list.setFixedHeight(280)
        # 禁用默认选中模式，自己处理点击
        self.file_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.file_list.setFocusPolicy(Qt.NoFocus)

        # 样式表
        self.file_list.setStyleSheet("""
            ListWidget {
                background: transparent;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 6px;
                outline: none;
            }
            ListWidget::item {
                background: transparent;
                border: none;
                padding-left: 4px;
                margin: 2px 4px;
                border-radius: 4px;
            }
            ListWidget::item:hover {
                background: rgba(0, 0, 0, 0.04);
            }
            ListWidget::item:selected {
                background: transparent;
            }
        """)

        file_paths = sorted(set(item.get_file_path() for item in self.items))
        self.file_checkboxes = {}

        for path in file_paths:
            display_name = path.split("/")[-1] if "/" in path else path.split("\\")[-1] if "\\" in path else path

            list_item = QListWidgetItem()
            list_item.setSizeHint(QSize(0, 36))
            list_item.setData(Qt.UserRole, path)
            self.file_list.addItem(list_item)

            cb = CheckBox(display_name)
            cb.setChecked(True)
            cb.setToolTip(path)
            cb.setAttribute(Qt.WA_TransparentForMouseEvents)
            self.file_list.setItemWidget(list_item, cb)
            self.file_checkboxes[path] = cb

        self.file_list.itemClicked.connect(self._on_file_item_clicked)

        self.file_card, file_layout, file_head_layout = self._create_section_card(
            Localizer.get().proofreading_page_filter_file,
            is_flow=False
        )

        # 文件模块头部按钮
        btn_select_all = PushButton(Localizer.get().proofreading_page_filter_select_all)
        btn_deselect_all = PushButton(Localizer.get().proofreading_page_filter_clear)
        for btn in (btn_select_all, btn_deselect_all):
            file_head_layout.addWidget(btn)

        btn_select_all.clicked.connect(self._select_all_files)
        btn_deselect_all.clicked.connect(self._deselect_all_files)

        self.file_list.setMinimumWidth(600)  # 保持宽度自适应但有最小限制
        file_layout.addWidget(self.file_list)

        self.viewLayout.addWidget(self.file_card)

        # 按钮文本
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

    def _create_section_card(self, title: str, is_flow: bool = True) -> tuple[CardWidget, QLayout, QHBoxLayout]:
        """创建统一样式的卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        root = QVBoxLayout(card)
        root.setContentsMargins(16, 16, 16, 16)

        # Head
        head_container = QWidget(card)
        head_layout = QHBoxLayout(head_container)
        head_layout.setContentsMargins(0, 0, 0, 0)
        head_layout.setSpacing(8)

        text_container = QWidget(head_container)
        text_layout = QVBoxLayout(text_container)
        text_layout.setContentsMargins(0, 0, 0, 0)
        text_layout.setSpacing(4) # 标题和描述紧凑一些

        title_label = StrongBodyLabel(title, card)
        text_layout.addWidget(title_label)

        head_layout.addWidget(text_container)
        head_layout.addStretch(1) # 左侧文本，右侧留空放按钮

        root.addWidget(head_container)

        # Separator (使用 widget.Separator)
        root.addWidget(Separator(card))

        # Content
        content_container = QWidget(card)
        if is_flow:
            content_layout = FlowLayout(content_container, needAni=False)
            content_layout.setContentsMargins(0, 0, 0, 0)
            content_layout.setSpacing(8)
        else:
            content_layout = QVBoxLayout(content_container)
            content_layout.setContentsMargins(0, 0, 0, 0)
            content_layout.setSpacing(0)

        root.addWidget(content_container)

        return card, content_layout, head_layout

    def _on_file_item_clicked(self, item: QListWidgetItem) -> None:
        """处理列表项点击：切换对应 CheckBox 的状态"""
        widget = self.file_list.itemWidget(item)
        if isinstance(widget, CheckBox):
            widget.setChecked(not widget.isChecked())

    def _select_all_files(self) -> None:
        for cb in self.file_checkboxes.values():
            cb.setChecked(True)

    def _deselect_all_files(self) -> None:
        for cb in self.file_checkboxes.values():
            cb.setChecked(False)

    def get_filter_options(self) -> dict:
        selected_warnings = {e for e, cb in self.warning_checkboxes.items() if cb.isChecked()}
        selected_statuses = {s for s, cb in self.status_checkboxes.items() if cb.isChecked()}

        selected_files = set()
        all_files = set(self.file_checkboxes.keys())
        for path, cb in self.file_checkboxes.items():
            if cb.isChecked():
                selected_files.add(path)

        # 如果选中的数量少于总数，则返回选中集合；否则返回 None 表示全选（无筛选）
        return {
            self.KEY_WARNING_TYPES: selected_warnings,
            self.KEY_STATUSES: selected_statuses if len(selected_statuses) < len(self.status_checkboxes) else None,
            self.KEY_FILE_PATHS: selected_files if len(selected_files) < len(all_files) else None,
        }

    def set_filter_options(self, options: dict) -> None:
        warning_types = options.get(self.KEY_WARNING_TYPES)
        for warning_type, cb in self.warning_checkboxes.items():
            cb.setChecked(warning_types is None or warning_type in warning_types)

        statuses = options.get(self.KEY_STATUSES)
        for status, cb in self.status_checkboxes.items():
            cb.setChecked(statuses is None or status in statuses)

        file_paths = options.get(self.KEY_FILE_PATHS)
        for path, cb in self.file_checkboxes.items():
            cb.setChecked(file_paths is None or path in file_paths)
