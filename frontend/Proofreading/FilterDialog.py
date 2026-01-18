from collections import Counter

from PyQt5.QtCore import QModelIndex
from PyQt5.QtCore import QPointF
from PyQt5.QtCore import QRect
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPen
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QListWidgetItem
from PyQt5.QtWidgets import QStyleOptionViewItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import BodyLabel
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FlowLayout
from qfluentwidgets import ListItemDelegate
from qfluentwidgets import ListWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import PillPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomLineEdit import CustomSearchLineEdit

class FilterListItemWidget(QWidget):
    """自定义列表项 widget：悬浮背景 + 手绘 checkbox + CaptionLabel 文本 + 计数"""

    def __init__(self, text: str, parent: QWidget = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(40)
        # 启用鼠标追踪以接收 enterEvent/leaveEvent
        self.setMouseTracking(True)

        self._checked = True
        self._count = 0
        self._hovered = False

        # 布局参数
        self._checkbox_size = 18
        self._left_padding = 12

        # 使用 CaptionLabel 显示文本（12px 字体，QFluentWidgets 内置控件处理好渲染）
        self.text_label = CaptionLabel(text, self)
        self.text_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self.text_label.setAttribute(Qt.WA_TransparentForMouseEvents)

        # 使用 CaptionLabel 显示计数
        self.count_label = CaptionLabel("0", self)
        self.count_label.setMinimumWidth(32)
        self.count_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.count_label.setAttribute(Qt.WA_TransparentForMouseEvents)

        # 布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(
            self._left_padding + self._checkbox_size + 8, 0, 12, 0
        )
        layout.addWidget(self.text_label, 1)
        layout.addWidget(self.count_label)

    def set_checked(self, checked: bool) -> None:
        self._checked = checked
        self.update()

    def is_checked(self) -> bool:
        return self._checked

    def set_count(self, count: int) -> None:
        self._count = count
        self.count_label.setText(str(count))

    def get_count(self) -> int:
        return self._count

    def set_tooltip(self, tooltip: str) -> None:
        """使用 QFluentWidgets 的 ToolTipFilter 设置 tooltip（300ms 延迟）"""
        self.setToolTip(tooltip)
        self.installEventFilter(ToolTipFilter(self, 300, ToolTipPosition.TOP))

    def enterEvent(self, event) -> None:
        """鼠标进入时设置悬浮状态"""
        self._hovered = True
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        """鼠标离开时取消悬浮状态"""
        self._hovered = False
        self.update()
        super().leaveEvent(event)

    def paintEvent(self, event) -> None:
        """绘制悬浮背景 + Fluent 风格 checkbox"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)

        # 1. 绘制悬浮背景（Fluent 风格圆角矩形）
        if self._hovered:
            hover_color = (
                QColor(255, 255, 255, 20) if isDarkTheme() else QColor(0, 0, 0, 10)
            )
            painter.setBrush(hover_color)
            painter.setPen(Qt.NoPen)
            # 不留左右边距，与搜索框对齐
            bg_rect = self.rect().adjusted(0, 2, 0, -2)
            painter.drawRoundedRect(bg_rect, 5, 5)

        # 2. Checkbox 垂直居中
        cy = self.height() // 2
        checkbox_rect = QRect(
            self._left_padding,
            cy - self._checkbox_size // 2,
            self._checkbox_size,
            self._checkbox_size,
        )

        if self._checked:
            # 选中状态：主题色背景 + 白色勾
            painter.setBrush(themeColor())
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(checkbox_rect, 5, 5)

            # 绘制白色对勾
            check_pen = QPen(Qt.white, 2)
            check_pen.setCapStyle(Qt.RoundCap)
            check_pen.setJoinStyle(Qt.RoundJoin)
            painter.setPen(check_pen)

            origin = checkbox_rect.topLeft()
            w = self._checkbox_size
            p1 = origin + QPointF(w * 0.27, w * 0.5)
            p2 = origin + QPointF(w * 0.44, w * 0.68)
            p3 = origin + QPointF(w * 0.75, w * 0.34)
            painter.drawPolyline([p1, p2, p3])
        else:
            # 未选中状态：边框 + 透明背景
            painter.setBrush(Qt.NoBrush)
            border_c = (
                QColor(255, 255, 255, 138) if isDarkTheme() else QColor(0, 0, 0, 110)
            )
            painter.setPen(QPen(border_c, 1))
            painter.drawRoundedRect(checkbox_rect, 5, 5)


class FilterListDelegate(ListItemDelegate):
    """简化的列表项委托：只控制高度，不绘制任何内容"""

    def sizeHint(self, option: QStyleOptionViewItem, index: QModelIndex) -> QSize:
        return QSize(option.rect.width(), 40)

    def paint(
        self, painter: QPainter, option: QStyleOptionViewItem, index: QModelIndex
    ):
        # 不绘制任何内容，由 itemWidget 负责全部渲染
        pass

    def updateEditorGeometry(
        self, editor: QWidget, option: QStyleOptionViewItem, index: QModelIndex
    ) -> None:
        editor.setGeometry(option.rect)


class FilterDialog(MessageBoxBase):
    """双栏式筛选对话框：左栏文件范围，右栏筛选条件与术语明细，全联动刷新"""

    NO_WARNING_TAG = "NO_WARNING"

    # 筛选选项字典 Key 定义
    KEY_WARNING_TYPES = "warning_types"
    KEY_STATUSES = "statuses"
    KEY_FILE_PATHS = "file_paths"
    KEY_GLOSSARY_TERMS = "glossary_terms"

    def __init__(
        self,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        result_checker: ResultChecker,
        parent: QWidget,
    ) -> None:
        super().__init__(parent)

        # 仅针对可见状态进行筛选
        self.items = [
            i
            for i in items
            if i.get_status()
            not in (Base.ProjectStatus.EXCLUDED, Base.ProjectStatus.DUPLICATED)
        ]
        self.warning_map = warning_map
        self.result_checker = result_checker

        # 预计算术语错误明细：{ (src, dst): [item, ...] }
        self.glossary_error_map: dict[tuple[str, str], list[Item]] = {}
        self._build_glossary_error_map()

        self._init_ui()
        # 初始化后刷新一次联动数据
        self._refresh_all()

    def _build_glossary_error_map(self) -> None:
        """构建术语错误明细映射"""
        for item in self.items:
            if WarningType.GLOSSARY not in self.warning_map.get(id(item), []):
                continue
            failed_terms = self.result_checker.get_failed_glossary_terms(item)
            for term in failed_terms:
                if term not in self.glossary_error_map:
                    self.glossary_error_map[term] = []
                self.glossary_error_map[term].append(item)

    def _init_ui(self) -> None:
        """初始化双栏布局 UI"""
        self.widget.setMinimumWidth(900)
        self.viewLayout.setSpacing(16)
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        # 双栏容器
        body = QWidget()
        body_layout = QHBoxLayout(body)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(16)

        # 左栏：文件范围
        left_card = self._create_left_panel()
        left_card.setFixedWidth(300)
        body_layout.addWidget(left_card)

        # 右栏：筛选条件 + 术语明细
        right_container = self._create_right_panel()
        body_layout.addWidget(right_container, 1)

        self.viewLayout.addWidget(body)

        # 使用默认按钮
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

    def _create_left_panel(self) -> CardWidget:
        """创建左栏：文件范围选择"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        # 标题行
        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(8)
        title_label = BodyLabel(Localizer.get().proofreading_page_filter_file_scope)
        title_row.addWidget(title_label)
        title_row.addStretch(1)

        btn_select_all = PushButton(Localizer.get().proofreading_page_filter_select_all)
        btn_clear = PushButton(Localizer.get().proofreading_page_filter_clear)

        for btn in (btn_select_all, btn_clear):
            btn.setFixedHeight(26)
            font = btn.font()
            font.setPixelSize(12)
            btn.setFont(font)

        btn_select_all.clicked.connect(self._select_all_files)
        btn_clear.clicked.connect(self._deselect_all_files)
        title_row.addWidget(btn_select_all)
        title_row.addWidget(btn_clear)
        layout.addLayout(title_row)
        layout.addSpacing(8)

        # 搜索框
        self.file_search = CustomSearchLineEdit()
        self.file_search.setPlaceholderText(
            Localizer.get().proofreading_page_filter_search_file
        )
        self.file_search.textChanged.connect(self._filter_file_list)
        layout.addWidget(self.file_search)

        layout.addSpacing(8)

        # 文件列表
        self.file_list = ListWidget()
        self.file_list.setMinimumHeight(400)
        # 禁用默认的选中高亮行为，通过点击事件切换激活状态
        self.file_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.file_list.setItemDelegate(FilterListDelegate(self.file_list))
        # 禁用水平滚动条，确保 itemWidget 不会超出可见区域
        self.file_list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        # 让 items 随 viewport 调整大小
        self.file_list.setResizeMode(ListWidget.Adjust)
        # 完整覆盖 qfluentwidgets 的样式表，移除所有 padding
        self.file_list.setStyleSheet("""
            ListWidget, QListWidget, QListView {
                background: transparent;
                outline: none;
                border: none;
                selection-background-color: transparent;
                alternate-background-color: transparent;
                padding-left: 0px;
                padding-right: 0px;
                margin: 0px;
            }
            ListWidget::item, QListWidget::item, QListView::item {
                background: transparent;
                border: 0px;
                padding-left: 0px;
                padding-right: 0px;
                margin-left: 0px;
                margin-right: 0px;
                height: 40px;
            }
        """)
        # 绑定点击事件用于切换激活状态
        self.file_list.itemClicked.connect(self._on_file_item_clicked)

        # 统计每个文件的条目数，按路径排序
        file_item_counts = Counter(item.get_file_path() for item in self.items)
        file_paths = sorted(file_item_counts.keys())
        self.file_list_items: dict[str, QListWidgetItem] = {}
        self.file_list_widgets: dict[str, FilterListItemWidget] = {}

        for path in file_paths:
            display_name = path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]

            list_item = QListWidgetItem()
            list_item.setSizeHint(QSize(-1, 40))
            list_item.setData(Qt.UserRole, path)  # 存储路径

            self.file_list.addItem(list_item)

            # 创建自定义 widget 并设置
            item_widget = FilterListItemWidget(display_name, self.file_list)
            item_widget.set_checked(True)
            item_widget.set_count(0)
            item_widget.set_tooltip(path)
            self.file_list.setItemWidget(list_item, item_widget)

            self.file_list_items[path] = list_item
            self.file_list_widgets[path] = item_widget

        layout.addWidget(self.file_list, 1)

        return card

    def _create_right_panel(self) -> QWidget:
        """创建右栏：筛选条件 + 术语明细"""
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(16)

        # 上部：翻译状态卡片
        status_card = self._create_status_card()
        layout.addWidget(status_card)

        # 中部：质量检查卡片
        warning_card = self._create_warning_card()
        layout.addWidget(warning_card)

        # 下部：术语明细卡片（常驻，固定高度）
        self.term_card = self._create_term_card()
        self.term_card.setFixedHeight(384)
        layout.addWidget(self.term_card)

        # 选中信息（与卡片保持间距）
        layout.addSpacing(20)
        self.selected_info_label = CaptionLabel()
        layout.addWidget(self.selected_info_label)

        return container

    def _create_status_card(self) -> CardWidget:
        """创建翻译状态卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        layout.addWidget(BodyLabel(Localizer.get().proofreading_page_filter_status))
        layout.addSpacing(8)

        status_row = FlowLayout(needAni=False)
        status_row.setSpacing(8)
        status_row.setContentsMargins(0, 0, 0, 0)

        self.status_buttons: dict[Base.ProjectStatus, PillPushButton] = {}
        status_types = [
            (Base.ProjectStatus.NONE, Localizer.get().proofreading_page_status_none),
            (
                Base.ProjectStatus.PROCESSED,
                Localizer.get().proofreading_page_status_processed,
            ),
            (
                Base.ProjectStatus.PROCESSED_IN_PAST,
                Localizer.get().proofreading_page_status_processed_in_past,
            ),
        ]

        for status, label in status_types:
            btn = PillPushButton(f"{label} • 0")
            btn.setCheckable(True)
            btn.setChecked(True)
            btn.setFixedHeight(26)
            font = btn.font()
            font.setPixelSize(12)
            btn.setFont(font)
            btn.clicked.connect(self._on_filter_changed)
            self.status_buttons[status] = btn
            status_row.addWidget(btn)

        layout.addLayout(status_row)

        return card

    def _create_warning_card(self) -> CardWidget:
        """创建质量检查卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        layout.addWidget(
            BodyLabel(Localizer.get().proofreading_page_filter_warning_type)
        )
        layout.addSpacing(8)

        warning_row = FlowLayout(needAni=False)
        warning_row.setSpacing(8)
        warning_row.setContentsMargins(0, 0, 0, 0)

        self.warning_buttons: dict[str | WarningType, PillPushButton] = {}
        warning_types = [
            (self.NO_WARNING_TAG, Localizer.get().proofreading_page_filter_no_warning),
            (WarningType.KANA, Localizer.get().proofreading_page_warning_kana),
            (WarningType.HANGEUL, Localizer.get().proofreading_page_warning_hangeul),
            (
                WarningType.TEXT_PRESERVE,
                Localizer.get().proofreading_page_warning_text_preserve,
            ),
            (
                WarningType.SIMILARITY,
                Localizer.get().proofreading_page_warning_similarity,
            ),
            (WarningType.GLOSSARY, Localizer.get().proofreading_page_warning_glossary),
            (
                WarningType.RETRY_THRESHOLD,
                Localizer.get().proofreading_page_warning_retry,
            ),
        ]

        for warning_type, label in warning_types:
            btn = PillPushButton(f"{label} • 0")
            btn.setCheckable(True)
            btn.setChecked(True)
            btn.setFixedHeight(26)
            font = btn.font()
            font.setPixelSize(12)
            btn.setFont(font)
            btn.clicked.connect(self._on_filter_changed)
            self.warning_buttons[warning_type] = btn
            warning_row.addWidget(btn)

        layout.addLayout(warning_row)

        return card

    def _create_term_card(self) -> CardWidget:
        """创建术语明细卡片（常驻显示）"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        # 标题行
        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(8)
        self.term_title = BodyLabel(
            Localizer.get().proofreading_page_filter_glossary_detail
        )
        title_row.addWidget(self.term_title)
        title_row.addStretch(1)

        self.btn_select_all_terms = PushButton(
            Localizer.get().proofreading_page_filter_select_all
        )
        self.btn_clear_terms = PushButton(
            Localizer.get().proofreading_page_filter_clear
        )

        for btn in (self.btn_select_all_terms, self.btn_clear_terms):
            btn.setFixedHeight(26)
            font = btn.font()
            font.setPixelSize(12)
            btn.setFont(font)

        self.btn_select_all_terms.clicked.connect(self._select_all_terms)
        self.btn_clear_terms.clicked.connect(self._deselect_all_terms)
        title_row.addWidget(self.btn_select_all_terms)
        title_row.addWidget(self.btn_clear_terms)
        layout.addLayout(title_row)
        layout.addSpacing(8)

        # 搜索框
        self.term_search = CustomSearchLineEdit()
        self.term_search.setPlaceholderText(
            Localizer.get().proofreading_page_filter_search_term
        )
        self.term_search.textChanged.connect(self._filter_term_list)
        layout.addWidget(self.term_search)

        layout.addSpacing(8)

        # 术语列表
        self.term_list = ListWidget()
        self.term_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.term_list.setItemDelegate(FilterListDelegate(self.term_list))
        # 禁用水平滚动条
        self.term_list.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        # 让 items 随 viewport 调整大小
        self.term_list.setResizeMode(ListWidget.Adjust)
        # 完整覆盖 qfluentwidgets 的样式表，移除所有 padding
        self.term_list.setStyleSheet("""
            ListWidget, QListWidget, QListView {
                background: transparent;
                outline: none;
                border: none;
                selection-background-color: transparent;
                alternate-background-color: transparent;
                padding-left: 0px;
                padding-right: 0px;
                margin: 0px;
            }
            ListWidget::item, QListWidget::item, QListView::item {
                background: transparent;
                border: 0px;
                padding-left: 0px;
                padding-right: 0px;
                margin-left: 0px;
                margin-right: 0px;
                height: 40px;
            }
        """)
        self.term_list.itemClicked.connect(self._on_term_item_clicked)
        layout.addWidget(self.term_list, 1)

        # 空状态/禁用状态提示
        self.term_empty_label = CaptionLabel(
            Localizer.get().proofreading_page_filter_no_glossary_error
        )
        self.term_empty_label.setAlignment(Qt.AlignCenter)
        self.term_empty_label.hide()
        layout.addWidget(self.term_empty_label)

        self.term_list_items: dict[tuple[str, str], QListWidgetItem] = {}

        return card

    # =========================================
    # 事件处理
    # =========================================

    def _on_file_item_clicked(self, item: QListWidgetItem) -> None:
        """处理文件列表项点击：切换激活状态，刷新列表"""
        widget = self.file_list.itemWidget(item)
        if isinstance(widget, FilterListItemWidget):
            widget.set_checked(not widget.is_checked())
        self._refresh_all()

    def _on_term_item_clicked(self, item: QListWidgetItem) -> None:
        """处理术语列表项点击：切换激活状态，刷新信息"""
        widget = self.term_list.itemWidget(item)
        if isinstance(widget, FilterListItemWidget):
            widget.set_checked(not widget.is_checked())
        self._update_selected_info()

    def _on_filter_changed(self) -> None:
        """任意筛选条件变化时触发全局联动刷新"""
        self._refresh_all()

    def _filter_file_list(self, keyword: str) -> None:
        """过滤文件列表"""
        keyword = keyword.lower()
        for path, list_item in self.file_list_items.items():
            visible = keyword in path.lower()
            list_item.setHidden(not visible)

    def _filter_term_list(self, keyword: str) -> None:
        """过滤术语列表"""
        keyword = keyword.lower()
        for term, list_item in self.term_list_items.items():
            src, dst = term
            visible = keyword in src.lower() or keyword in dst.lower()
            list_item.setHidden(not visible)

    def _select_all_files(self) -> None:
        for widget in self.file_list_widgets.values():
            widget.set_checked(True)
        self._refresh_all()

    def _deselect_all_files(self) -> None:
        for widget in self.file_list_widgets.values():
            widget.set_checked(False)
        self._refresh_all()

    def _select_all_terms(self) -> None:
        for widget in getattr(self, "term_list_widgets", {}).values():
            widget.set_checked(True)
        self._update_selected_info()

    def _deselect_all_terms(self) -> None:
        for widget in getattr(self, "term_list_widgets", {}).values():
            widget.set_checked(False)
        self._update_selected_info()

    # =========================================
    # 全量联动刷新
    # =========================================

    def _get_current_filtered_items(self) -> list[Item]:
        """根据当前所有筛选条件获取符合条件的条目列表"""
        # 根据 widget 的选中状态判断文件是否激活
        selected_files = {
            path
            for path, widget in self.file_list_widgets.items()
            if widget.is_checked()
        }

        selected_statuses = {
            s for s, btn in self.status_buttons.items() if btn.isChecked()
        }
        selected_warnings = {
            w for w, btn in self.warning_buttons.items() if btn.isChecked()
        }

        result = []
        for item in self.items:
            # 文件筛选
            if item.get_file_path() not in selected_files:
                continue
            # 状态筛选
            if item.get_status() not in selected_statuses:
                continue
            # 警告筛选
            item_warnings = self.warning_map.get(id(item), [])
            if item_warnings:
                if not any(w in selected_warnings for w in item_warnings):
                    continue
            else:
                if self.NO_WARNING_TAG not in selected_warnings:
                    continue
            result.append(item)
        return result

    def _refresh_all(self) -> None:
        """全量联动刷新：所有模块的计数都基于当前筛选结果"""
        filtered_items = self._get_current_filtered_items()

        # 更新文件列表计数
        file_counts = Counter(item.get_file_path() for item in filtered_items)
        for path, widget in self.file_list_widgets.items():
            count = file_counts.get(path, 0)
            if widget.get_count() != count:
                widget.set_count(count)

        # 更新状态标签计数
        status_counts = Counter(item.get_status() for item in filtered_items)
        for status, btn in self.status_buttons.items():
            count = status_counts.get(status, 0)
            base_label = btn.text().rsplit(" • ", 1)[0]
            btn.setText(f"{base_label} • {count}")

        # 更新警告标签计数
        warning_counts: dict[str | WarningType, int] = {}
        no_warning_count = 0
        for item in filtered_items:
            item_warnings = self.warning_map.get(id(item), [])
            if item_warnings:
                for w in item_warnings:
                    warning_counts[w] = warning_counts.get(w, 0) + 1
            else:
                no_warning_count += 1

        for warning_type, btn in self.warning_buttons.items():
            count = (
                no_warning_count
                if warning_type == self.NO_WARNING_TAG
                else warning_counts.get(warning_type, 0)
            )
            base_label = btn.text().rsplit(" • ", 1)[0]
            btn.setText(f"{base_label} • {count}")

        # 更新术语明细
        glossary_active = self.warning_buttons[WarningType.GLOSSARY].isChecked()
        self._refresh_term_list(filtered_items, glossary_active)
        self._update_selected_info()

    def _refresh_term_list(self, filtered_items: list[Item], active: bool) -> None:
        """刷新术语明细列表"""

        # 记录当前激活的术语，以便在重建列表时维持状态
        previous_checked = set()
        for term, widget in getattr(self, "term_list_widgets", {}).items():
            if widget.is_checked():
                previous_checked.add(term)

        self.term_list.clear()
        self.term_list_items.clear()
        self.term_list_widgets: dict[tuple[str, str], FilterListItemWidget] = {}

        # 更新控件启用状态
        self.term_search.setEnabled(active)
        self.btn_select_all_terms.setEnabled(active)
        self.btn_clear_terms.setEnabled(active)
        self.term_list.setEnabled(active)

        if not active:
            # 未激活状态：显示禁用提示
            self.term_empty_label.setText(
                Localizer.get().proofreading_page_filter_no_glossary_error
            )
            self.term_empty_label.show()
            self.term_list.hide()
            return

        # 计算当前筛选结果中的术语错误频次
        filtered_set = set(id(i) for i in filtered_items)
        term_counts: dict[tuple[str, str], int] = {}

        for term, items in self.glossary_error_map.items():
            count = sum(1 for i in items if id(i) in filtered_set)
            if count > 0:
                term_counts[term] = count

        # 按频次降序排列
        sorted_terms = sorted(term_counts.items(), key=lambda x: x[1], reverse=True)

        if not sorted_terms:
            self.term_empty_label.setText(
                Localizer.get().proofreading_page_filter_no_glossary_error
            )
            self.term_empty_label.show()
            self.term_list.hide()
            return

        self.term_empty_label.hide()
        self.term_list.show()

        for term, count in sorted_terms:
            src, dst = term
            display_text = f"{src} → {dst}"

            list_item = QListWidgetItem()
            list_item.setSizeHint(QSize(-1, 40))
            list_item.setData(Qt.UserRole, term)  # 存储术语 Key

            self.term_list.addItem(list_item)

            # 创建自定义 widget 并设置
            item_widget = FilterListItemWidget(display_text, self.term_list)
            item_widget.set_checked(True)
            item_widget.set_count(count)
            item_widget.set_tooltip(display_text)
            self.term_list.setItemWidget(list_item, item_widget)

            self.term_list_items[term] = list_item
            self.term_list_widgets[term] = item_widget

    def _update_selected_info(self) -> None:
        """更新底部选中信息"""
        filtered_items = self._get_current_filtered_items()

        # 如果术语筛选激活，进一步过滤
        glossary_active = self.warning_buttons[WarningType.GLOSSARY].isChecked()
        term_widgets = getattr(self, "term_list_widgets", {})
        if glossary_active and term_widgets:
            selected_terms = {
                term for term, widget in term_widgets.items() if widget.is_checked()
            }

            final_items = []
            for item in filtered_items:
                item_warnings = self.warning_map.get(id(item), [])
                if WarningType.GLOSSARY in item_warnings:
                    item_terms = self.result_checker.get_failed_glossary_terms(item)
                    if any(t in selected_terms for t in item_terms):
                        final_items.append(item)
                else:
                    final_items.append(item)
            filtered_items = final_items

        count = len(filtered_items)
        files_with_items = len(set(i.get_file_path() for i in filtered_items))

        self.selected_info_label.setText(
            Localizer.get().proofreading_page_filter_selected_info.format(
                count=count, files=files_with_items
            )
        )

    # =========================================
    # 公共接口
    # =========================================

    def get_filter_options(self) -> dict:
        selected_warnings = {
            w for w, btn in self.warning_buttons.items() if btn.isChecked()
        }
        selected_statuses = {
            s for s, btn in self.status_buttons.items() if btn.isChecked()
        }
        selected_files = {
            path
            for path, widget in self.file_list_widgets.items()
            if widget.is_checked()
        }

        selected_terms = None
        term_widgets = getattr(self, "term_list_widgets", {})
        if WarningType.GLOSSARY in selected_warnings and term_widgets:
            checked_terms = {
                term for term, widget in term_widgets.items() if widget.is_checked()
            }

            if len(checked_terms) < len(term_widgets):
                selected_terms = checked_terms

        return {
            self.KEY_WARNING_TYPES: selected_warnings
            if len(selected_warnings) < len(self.warning_buttons)
            else None,
            self.KEY_STATUSES: selected_statuses
            if len(selected_statuses) < len(self.status_buttons)
            else None,
            self.KEY_FILE_PATHS: selected_files
            if len(selected_files) < len(self.file_list_items)
            else None,
            self.KEY_GLOSSARY_TERMS: selected_terms,
        }

    def set_filter_options(self, options: dict) -> None:
        warning_types = options.get(self.KEY_WARNING_TYPES)
        for warning_type, btn in self.warning_buttons.items():
            btn.setChecked(warning_types is None or warning_type in warning_types)

        statuses = options.get(self.KEY_STATUSES)
        for status, btn in self.status_buttons.items():
            btn.setChecked(statuses is None or status in statuses)

        file_paths = options.get(self.KEY_FILE_PATHS)
        for path, widget in self.file_list_widgets.items():
            widget.set_checked(file_paths is None or path in file_paths)

        self._refresh_all()

        # 刷新后再尝试恢复术语激活状态
        glossary_terms = options.get(self.KEY_GLOSSARY_TERMS)
        term_widgets = getattr(self, "term_list_widgets", {})
        if glossary_terms and term_widgets:
            for term, widget in term_widgets.items():
                widget.set_checked(term in glossary_terms)
            self._update_selected_info()
