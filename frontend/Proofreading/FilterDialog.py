from collections import Counter

from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QListWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import CheckBox
from qfluentwidgets import FlowLayout
from qfluentwidgets import ListWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PillPushButton
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

    def __init__(self, items: list[Item], warning_map: dict[int, list[WarningType]], parent: QWidget) -> None:
        super().__init__(parent)
        # 仅针对可见状态进行筛选
        self.items = [i for i in items if i.get_status() not in (Base.ProjectStatus.EXCLUDED, Base.ProjectStatus.DUPLICATED)]
        self.warning_map = warning_map
        self._init_ui()

    def _init_ui(self) -> None:
        """初始化 UI"""
        self.widget.setMinimumWidth(680)
        # 调整 Dialog 内部间距
        self.viewLayout.setSpacing(16)
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        # ========== 1. 翻译任务模块 ==========
        # 统计每个状态的条目数
        status_counts = Counter(item.get_status() for item in self.items)

        self.status_buttons: dict[Base.ProjectStatus, PillPushButton] = {}
        status_types = [
            (Base.ProjectStatus.NONE, Localizer.get().proofreading_page_status_none),
            (Base.ProjectStatus.PROCESSED, Localizer.get().proofreading_page_status_processed),
            (Base.ProjectStatus.PROCESSED_IN_PAST, Localizer.get().proofreading_page_status_processed_in_past),
        ]

        self.status_card, status_layout, _ = self._create_section_card(
            Localizer.get().proofreading_page_filter_status
        )

        for status, label in status_types:
            count = status_counts.get(status, 0)
            btn = PillPushButton(f"{label} ({count})")
            btn.setCheckable(True)
            btn.setChecked(True)
            self.status_buttons[status] = btn
            status_layout.addWidget(btn)

        self.viewLayout.addWidget(self.status_card)

        # ========== 2. 结果检查模块 ==========
        # 统计每个警告类型的条目数
        warning_counts: dict[str | WarningType, int] = {}
        no_warning_count = 0
        for item in self.items:
            item_warnings = self.warning_map.get(id(item), [])
            if item_warnings:
                for w in item_warnings:
                    warning_counts[w] = warning_counts.get(w, 0) + 1
            else:
                no_warning_count += 1

        self.warning_buttons: dict[str | WarningType, PillPushButton] = {}
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
            # 无警告使用专门统计的数量
            count = no_warning_count if warning_type == self.NO_WARNING_TAG else warning_counts.get(warning_type, 0)
            btn = PillPushButton(f"{label} ({count})")
            btn.setCheckable(True)
            btn.setChecked(True)
            self.warning_buttons[warning_type] = btn
            warning_layout.addWidget(btn)

        self.viewLayout.addWidget(self.warning_card)


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

        # 统计每个文件的条目数
        file_item_counts = Counter(item.get_file_path() for item in self.items)
        file_paths = sorted(file_item_counts.keys())
        self.file_checkboxes: dict[str, CheckBox] = {}

        for path in file_paths:
            display_name = path.split("/")[-1] if "/" in path else path.split("\\")[-1] if "\\" in path else path
            item_count = file_item_counts[path]

            list_item = QListWidgetItem()
            list_item.setSizeHint(QSize(0, 36))
            list_item.setData(Qt.UserRole, path)
            self.file_list.addItem(list_item)

            # 创建行容器，包含 CheckBox 和条目数标签
            row_widget = QWidget()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 0, 8, 0)
            row_layout.setSpacing(8)

            cb = CheckBox(display_name)
            cb.setChecked(True)
            cb.setToolTip(path)
            cb.setAttribute(Qt.WA_TransparentForMouseEvents)
            row_layout.addWidget(cb)

            row_layout.addStretch(1)

            count_label = CaptionLabel(str(item_count))
            count_label.setStyleSheet("color: rgba(0, 0, 0, 0.5);")
            count_label.setAttribute(Qt.WA_TransparentForMouseEvents)
            row_layout.addWidget(count_label)

            self.file_list.setItemWidget(list_item, row_widget)
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
        path = item.data(Qt.UserRole)
        if path in self.file_checkboxes:
            cb = self.file_checkboxes[path]
            cb.setChecked(not cb.isChecked())

    def _select_all_files(self) -> None:
        for cb in self.file_checkboxes.values():
            cb.setChecked(True)

    def _deselect_all_files(self) -> None:
        for cb in self.file_checkboxes.values():
            cb.setChecked(False)

    def get_filter_options(self) -> dict:
        selected_warnings = {e for e, btn in self.warning_buttons.items() if btn.isChecked()}
        selected_statuses = {s for s, btn in self.status_buttons.items() if btn.isChecked()}
        selected_files = {path for path, cb in self.file_checkboxes.items() if cb.isChecked()}

        # 统一风格：全选时返回 None 表示无筛选，否则返回选中集合
        return {
            self.KEY_WARNING_TYPES: selected_warnings if len(selected_warnings) < len(self.warning_buttons) else None,
            self.KEY_STATUSES: selected_statuses if len(selected_statuses) < len(self.status_buttons) else None,
            self.KEY_FILE_PATHS: selected_files if len(selected_files) < len(self.file_checkboxes) else None,
        }

    def set_filter_options(self, options: dict) -> None:
        warning_types = options.get(self.KEY_WARNING_TYPES)
        for warning_type, btn in self.warning_buttons.items():
            btn.setChecked(warning_types is None or warning_type in warning_types)

        statuses = options.get(self.KEY_STATUSES)
        for status, btn in self.status_buttons.items():
            btn.setChecked(statuses is None or status in statuses)

        file_paths = options.get(self.KEY_FILE_PATHS)
        for path, cb in self.file_checkboxes.items():
            cb.setChecked(file_paths is None or path in file_paths)
