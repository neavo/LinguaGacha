from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import threading
from typing import Any
from typing import cast

from PyQt5.QtCore import QModelIndex
from PyQt5.QtCore import QPointF
from PyQt5.QtCore import QRect
from PyQt5.QtCore import QSize
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QHideEvent
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPolygonF
from PyQt5.QtGui import QPen
from PyQt5.QtGui import QShowEvent
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
from qfluentwidgets import InfoBar
from qfluentwidgets import InfoBarPosition
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
from base.LogManager import LogManager
from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain
from frontend.Proofreading.ProofreadingDomain import ProofreadingFilterOptions
from frontend.Proofreading.ProofreadingLabels import ProofreadingLabels
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomLineEdit import CustomSearchLineEdit


class FilterListItemWidget(QWidget):
    """自定义列表项 widget：悬浮背景 + 手绘 checkbox + CaptionLabel 文本 + 计数"""

    def __init__(self, text: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(40)
        # 启用鼠标追踪以接收 enterEvent/leaveEvent
        self.setMouseTracking(True)

        self.checked = True
        self.count = 0
        self.hovered = False

        # 布局参数
        self.checkbox_size = 18
        self.left_padding = 12

        # 使用 CaptionLabel 显示文本（12px 字体，QFluentWidgets 内置控件处理好渲染）
        self.text_label = CaptionLabel(text, self)
        self.text_label.setAlignment(
            cast(Any, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        )
        self.text_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)

        # 使用 CaptionLabel 显示计数
        self.count_label = CaptionLabel("0", self)
        self.count_label.setMinimumWidth(32)
        self.count_label.setAlignment(
            cast(Any, Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        )
        self.count_label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)

        # 布局
        layout = QHBoxLayout(self)
        layout.setContentsMargins(self.left_padding + self.checkbox_size + 8, 0, 12, 0)
        layout.addWidget(self.text_label, 1)
        layout.addWidget(self.count_label)

    def set_checked(self, checked: bool) -> None:
        self.checked = checked
        self.update()

    def is_checked(self) -> bool:
        return self.checked

    def set_count(self, count: int) -> None:
        self.count = count
        self.count_label.setText(str(count))

    def get_count(self) -> int:
        return self.count

    def set_tooltip(self, tooltip: str) -> None:
        """使用 QFluentWidgets 的 ToolTipFilter 设置 tooltip（300ms 延迟）"""
        self.setToolTip(tooltip)
        self.installEventFilter(ToolTipFilter(self, 300, ToolTipPosition.TOP))

    def enterEvent(self, a0) -> None:
        """鼠标进入时设置悬浮状态"""
        self.hovered = True
        self.update()
        super().enterEvent(a0)

    def leaveEvent(self, a0) -> None:
        """鼠标离开时取消悬浮状态"""
        self.hovered = False
        self.update()
        super().leaveEvent(a0)

    def get_check_color(self) -> QColor:
        if not isDarkTheme():
            return QColor(255, 255, 255)

        color = themeColor()
        luma = 0.2126 * color.redF() + 0.7152 * color.greenF() + 0.0722 * color.blueF()
        return QColor(0, 0, 0) if luma > 0.75 else QColor(255, 255, 255)

    def paintEvent(self, a0) -> None:
        del a0
        """绘制悬浮背景 + Fluent 风格 checkbox"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)

        # 1. 绘制悬浮背景（Fluent 风格圆角矩形）
        if self.hovered:
            hover_color = (
                QColor(255, 255, 255, 20) if isDarkTheme() else QColor(0, 0, 0, 10)
            )
            painter.setBrush(hover_color)
            painter.setPen(Qt.PenStyle.NoPen)
            # 不留左右边距，与搜索框对齐
            bg_rect = self.rect().adjusted(0, 2, 0, -2)
            painter.drawRoundedRect(bg_rect, 5, 5)

        # 2. Checkbox 垂直居中
        cy = self.height() // 2
        checkbox_rect = QRect(
            self.left_padding,
            cy - self.checkbox_size // 2,
            self.checkbox_size,
            self.checkbox_size,
        )

        if self.checked:
            # 选中状态：主题色背景 + 白色勾
            painter.setBrush(themeColor())
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawRoundedRect(checkbox_rect, 5, 5)

            # 绘制白色对勾
            check_pen = QPen(self.get_check_color(), 2)
            check_pen.setCapStyle(Qt.PenCapStyle.RoundCap)
            check_pen.setJoinStyle(Qt.PenJoinStyle.RoundJoin)
            painter.setPen(check_pen)

            origin = checkbox_rect.topLeft()
            w = self.checkbox_size
            p1 = origin + QPointF(w * 0.27, w * 0.5)
            p2 = origin + QPointF(w * 0.44, w * 0.68)
            p3 = origin + QPointF(w * 0.75, w * 0.34)
            painter.drawPolyline(QPolygonF([p1, p2, p3]))
        else:
            # 未选中状态：边框 + 透明背景
            painter.setBrush(Qt.BrushStyle.NoBrush)
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


@dataclass(frozen=True)
class FilterRefreshComputeResult:
    token: int
    file_counts: dict[str, int]
    status_counts: dict[Base.ProjectStatus, int]
    warning_counts: dict[str | WarningType, int]
    term_counts_sorted: tuple[tuple[tuple[str, str], int], ...]
    glossary_active: bool


class FilterDialog(MessageBoxBase):
    """双栏式筛选对话框：左栏文件范围，右栏筛选条件与术语明细，全联动刷新"""

    # 防抖时间（毫秒）：合并连续点击导致的刷新请求。
    FILTER_CHANGE_DEBOUNCE_MS: int = 120

    # 后台 compute 完成后回到 UI 线程 apply。
    refresh_computed = pyqtSignal(object)

    LIST_STYLE = """
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
        """

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

        # 规则跳过条目无需校对；非目标原文语言可由用户选择显示
        self.items = [
            i
            for i in items
            if i.get_status()
            not in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            )
        ]
        self.warning_map = warning_map
        self.result_checker = result_checker

        # glossary failure cache（由 Page 在加载/规则刷新后构建并传入）。
        self.failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] = {}
        self.all_glossary_terms: set[tuple[str, str]] = set()

        # 持久化保存术语选中状态（跨 refresh 保持）。
        self.term_checked_state: set[tuple[str, str]] = set()

        # 计数文本的 base_label 与上一轮 count（用于避免无效 setText / repaint）。
        self.status_base_labels: dict[Base.ProjectStatus, str] = {}
        self.status_count_cache: dict[Base.ProjectStatus, int] = {}
        self.warning_base_labels: dict[str | WarningType, str] = {}
        self.warning_count_cache: dict[str | WarningType, int] = {}

        # 术语列表当前顺序（用于尽量避免重复 clear + rebuild）。
        self.term_list_order: tuple[tuple[str, str], ...] = ()

        # refresh 调度/竞态控制
        self.refresh_token: int = 0
        self.refresh_timer: QTimer = QTimer(self)
        self.refresh_timer.setSingleShot(True)
        self.refresh_timer.timeout.connect(self.start_refresh_compute)

        self.refresh_computed.connect(self.on_refresh_computed_ui)

        self.init_ui()

        # 注意：不在构造函数内触发重计算/重建（保证对话框尽快可交互）。

    def export_error_report(self) -> None:
        """导出错误报告"""
        # 1. 获取当前筛选结果中的错误条目
        items = self.get_current_filtered_items()
        error_items = [
            i
            for i in items
            if ProofreadingDomain.get_item_warnings(i, self.warning_map)
        ]

        if not error_items:
            InfoBar.warning(
                title=Localizer.get().alert,
                content=Localizer.get().alert_no_data,
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=InfoBarPosition.TOP,
                duration=2000,
                parent=self.window(),
            )
            return

        # 2. 准备导出路径
        lg_path = DataManager.get().get_lg_path()
        if not lg_path:
            return

        project_path = Path(lg_path)
        project_name = project_path.stem
        # 输出文件名: [工程名]_结果检查.txt
        output_name = f"{project_name}_结果检查.txt"
        output_path = project_path.parent / output_name

        # 3. 生成内容
        content_lines = []
        separator_line = "=" * 60
        section_separator = "-" * 60

        # 4.1 报告头
        content_lines.append(separator_line)
        content_lines.append(
            f"{Localizer.get().proofreading_page_filter_report_title}".center(60)
        )
        content_lines.append(separator_line)
        content_lines.append(
            f"{Localizer.get().proofreading_page_filter_report_project}: {project_name}"
        )
        content_lines.append(
            f"{Localizer.get().proofreading_page_filter_report_time}: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        content_lines.append(
            f"{Localizer.get().proofreading_page_filter_report_total}: {len(error_items)}"
        )

        # 警告筛选 (只列结果检查，忽略文件范围)
        valid_warning_buttons = {
            w: b
            for w, b in self.warning_buttons.items()
            if w != ProofreadingFilterOptions.NO_WARNING_TAG
        }

        selected_warnings = {
            w for w, b in valid_warning_buttons.items() if b.isChecked()
        }

        # 只要有选中的警告类型（正常情况下导出时肯定有，否则列表为空），就显示筛选条件
        if selected_warnings:
            # 无论是否全选，都列出所有选中的项
            warning_names = [
                valid_warning_buttons[w].text().split(" • ")[0]
                for w in valid_warning_buttons  # 保持定义顺序
                if w in selected_warnings
            ]
            filter_text = ", ".join(warning_names)

            content_lines.append(
                f"{Localizer.get().proofreading_page_filter_report_filter}: {filter_text}"
            )

        content_lines.append(separator_line)
        # 报告头与第一个条目之间 3 个空行
        content_lines.append("")
        content_lines.append("")
        content_lines.append("")

        # 4.2 错误条目
        for i, item in enumerate(error_items, 1):
            warnings = ProofreadingDomain.get_item_warnings(item, self.warning_map)
            warning_strs = [ProofreadingLabels.get_warning_label(w) for w in warnings]
            warning_line = " | ".join(warning_strs)

            # Item Header
            content_lines.append(f"No. {i}  [{warning_line}]")
            content_lines.append(f"File: {item.get_file_path()}")
            content_lines.append(section_separator)

            # Content
            content_lines.append(item.get_src())
            content_lines.append("▽")
            content_lines.append("▽")
            content_lines.append("▽")
            content_lines.append(item.get_dst())

            # Item Footer
            content_lines.append(separator_line)

            # 条目之间 3 个空行
            content_lines.append("")
            content_lines.append("")
            content_lines.append("")

        # 5. 写入文件
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write("\n".join(content_lines))

            # Toast 显示在父窗口，位置更合理
            # content 留空，仅显示 title 即可，避免信息冗余
            InfoBar.success(
                title=Localizer.get().task_success,
                content="",
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=InfoBarPosition.TOP,
                duration=3000,
                parent=self.window(),  # 使用 window() 获取顶层窗口作为父组件
            )
        except Exception as e:
            LogManager.get().error(f"写入校对报告失败: {output_path}", e)
            InfoBar.error(
                title=Localizer.get().task_failed,
                content="",
                orient=Qt.Orientation.Horizontal,
                isClosable=True,
                position=InfoBarPosition.TOP,
                duration=5000,
                parent=self.window(),
            )

    def init_ui(self) -> None:
        """初始化双栏布局 UI"""
        self.widget.setMinimumWidth(900)
        self.viewLayout.setSpacing(16)
        self.viewLayout.setContentsMargins(24, 24, 24, 24)

        body = QWidget()
        body_layout = QHBoxLayout(body)
        body_layout.setContentsMargins(0, 0, 0, 0)
        body_layout.setSpacing(16)

        left_container = QWidget()
        left_layout = QVBoxLayout(left_container)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)
        left_layout.setAlignment(Qt.AlignmentFlag.AlignTop)

        left_layout.addWidget(self.create_status_card())
        left_layout.addWidget(self.create_warning_card())
        left_layout.addWidget(self.create_left_panel(), 1)

        self.term_card = self.create_term_card()
        self.term_card.setFixedWidth(360)

        body_layout.addWidget(left_container, 1)
        body_layout.addWidget(self.term_card)

        self.viewLayout.addWidget(body)

        # 使用默认按钮
        self.yesButton.setText(Localizer.get().confirm)
        self.cancelButton.setText(Localizer.get().cancel)

    def setup_small_button(self, btn: QWidget) -> None:
        btn.setFixedHeight(26)
        font = btn.font()
        font.setPixelSize(12)
        btn.setFont(font)

    def setup_filter_list_widget(self, list_widget: ListWidget) -> None:
        list_widget.setSelectionMode(QAbstractItemView.NoSelection)
        list_widget.setItemDelegate(FilterListDelegate(list_widget))
        list_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        list_widget.setResizeMode(ListWidget.Adjust)
        list_widget.setStyleSheet(self.LIST_STYLE)

    def create_left_panel(self) -> CardWidget:
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
            self.setup_small_button(btn)

        btn_select_all.clicked.connect(self.select_all_files)
        btn_clear.clicked.connect(self.deselect_all_files)
        title_row.addWidget(btn_select_all)
        title_row.addWidget(btn_clear)
        layout.addLayout(title_row)
        layout.addSpacing(8)

        # 搜索框
        self.file_search = CustomSearchLineEdit()
        self.file_search.setPlaceholderText(
            Localizer.get().proofreading_page_filter_search_file
        )
        self.file_search.textChanged.connect(self.filter_file_list)
        layout.addWidget(self.file_search)

        layout.addSpacing(8)

        # 文件列表
        self.file_list = ListWidget()
        self.file_list.setMinimumHeight(240)
        self.setup_filter_list_widget(self.file_list)
        self.file_list.itemClicked.connect(self.on_file_item_clicked)

        # 统计每个文件的条目数，按路径排序
        file_item_counts = Counter(item.get_file_path() for item in self.items)
        file_paths = sorted(file_item_counts.keys())
        self.file_list_items: dict[str, QListWidgetItem] = {}
        self.file_list_widgets: dict[str, FilterListItemWidget] = {}

        for path in file_paths:
            # 直接使用原始路径（通常是相对于项目根目录的路径），与 Tooltip 保持一致
            display_name = path

            list_item = QListWidgetItem()
            list_item.setSizeHint(QSize(-1, 40))
            list_item.setData(Qt.ItemDataRole.UserRole, path)  # 存储路径

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

    def create_status_card(self) -> CardWidget:
        """创建翻译状态卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        layout.addWidget(BodyLabel(Localizer.get().proofreading_page_filter_status))
        layout.addSpacing(6)

        status_row = FlowLayout(needAni=False)
        status_row.setSpacing(6)
        status_row.setContentsMargins(0, 0, 0, 0)

        self.status_buttons: dict[Base.ProjectStatus, PillPushButton] = {}
        status_types = [
            (
                Base.ProjectStatus.NONE,
                ProofreadingLabels.get_status_label(Base.ProjectStatus.NONE),
            ),
            (
                Base.ProjectStatus.PROCESSED,
                ProofreadingLabels.get_status_label(Base.ProjectStatus.PROCESSED),
            ),
            (
                Base.ProjectStatus.ERROR,
                ProofreadingLabels.get_status_label(Base.ProjectStatus.ERROR),
            ),
            (
                Base.ProjectStatus.PROCESSED_IN_PAST,
                ProofreadingLabels.get_status_label(
                    Base.ProjectStatus.PROCESSED_IN_PAST
                ),
            ),
            (
                Base.ProjectStatus.LANGUAGE_SKIPPED,
                ProofreadingLabels.get_status_label(
                    Base.ProjectStatus.LANGUAGE_SKIPPED
                ),
            ),
        ]

        for status, label in status_types:
            btn = PillPushButton(f"{label} • 0")
            btn.setCheckable(True)
            btn.setChecked(status != Base.ProjectStatus.LANGUAGE_SKIPPED)
            self.setup_small_button(btn)
            btn.clicked.connect(self.on_filter_changed)
            self.status_buttons[status] = btn
            status_row.addWidget(btn)

        layout.addLayout(status_row)

        return card

    def create_warning_card(self) -> CardWidget:
        """创建质量检查卡片"""
        card = CardWidget(self.widget)
        card.setBorderRadius(4)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(0)

        # 标题栏：标题 + 导出按钮
        title_row = QHBoxLayout()
        title_row.setContentsMargins(0, 0, 0, 0)
        title_row.setSpacing(8)

        title_row.addWidget(BodyLabel(Localizer.get().proofreading_page_result_check))
        title_row.addStretch(1)

        self.btn_export = PushButton(
            Localizer.get().proofreading_page_filter_export_btn
        )
        self.setup_small_button(self.btn_export)
        self.btn_export.installEventFilter(
            ToolTipFilter(self.btn_export, 300, ToolTipPosition.TOP)
        )
        self.btn_export.setToolTip(
            Localizer.get().proofreading_page_filter_export_tooltip
        )
        self.btn_export.clicked.connect(self.export_error_report)
        title_row.addWidget(self.btn_export)

        layout.addLayout(title_row)
        layout.addSpacing(6)

        warning_row = FlowLayout(needAni=False)
        warning_row.setSpacing(6)
        warning_row.setContentsMargins(0, 0, 0, 0)

        self.warning_buttons: dict[str | WarningType, PillPushButton] = {}
        warning_types = [
            (
                ProofreadingFilterOptions.NO_WARNING_TAG,
                Localizer.get().proofreading_page_filter_no_warning,
            ),
            (
                WarningType.KANA,
                ProofreadingLabels.get_warning_label(WarningType.KANA),
            ),
            (
                WarningType.HANGEUL,
                ProofreadingLabels.get_warning_label(WarningType.HANGEUL),
            ),
            (
                WarningType.TEXT_PRESERVE,
                ProofreadingLabels.get_warning_label(WarningType.TEXT_PRESERVE),
            ),
            (
                WarningType.SIMILARITY,
                ProofreadingLabels.get_warning_label(WarningType.SIMILARITY),
            ),
            (
                WarningType.GLOSSARY,
                ProofreadingLabels.get_warning_label(WarningType.GLOSSARY),
            ),
            (
                WarningType.RETRY_THRESHOLD,
                ProofreadingLabels.get_warning_label(WarningType.RETRY_THRESHOLD),
            ),
        ]

        for warning_type, label in warning_types:
            btn = PillPushButton(f"{label} • 0")
            btn.setCheckable(True)
            btn.setChecked(True)
            self.setup_small_button(btn)
            btn.clicked.connect(self.on_filter_changed)
            self.warning_buttons[warning_type] = btn
            warning_row.addWidget(btn)

        layout.addLayout(warning_row)

        return card

    def create_term_card(self) -> CardWidget:
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
            self.setup_small_button(btn)

        self.btn_select_all_terms.clicked.connect(self.select_all_terms)
        self.btn_clear_terms.clicked.connect(self.deselect_all_terms)
        title_row.addWidget(self.btn_select_all_terms)
        title_row.addWidget(self.btn_clear_terms)
        layout.addLayout(title_row)
        layout.addSpacing(8)

        # 搜索框
        self.term_search = CustomSearchLineEdit()
        self.term_search.setPlaceholderText(
            Localizer.get().proofreading_page_filter_search_term
        )
        self.term_search.textChanged.connect(self.filter_term_list)
        layout.addWidget(self.term_search)

        layout.addSpacing(8)

        # 术语列表
        self.term_list = ListWidget()
        self.setup_filter_list_widget(self.term_list)
        self.term_list.itemClicked.connect(self.on_term_item_clicked)
        layout.addWidget(self.term_list, 1)

        # 空状态/禁用状态提示
        self.term_empty_label = CaptionLabel(
            Localizer.get().proofreading_page_filter_no_glossary_error
        )
        self.term_empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.term_empty_label.hide()
        layout.addWidget(self.term_empty_label)

        self.term_list_items: dict[tuple[str, str], QListWidgetItem] = {}
        self.term_list_widgets: dict[tuple[str, str], FilterListItemWidget] = {}

        return card

    def showEvent(self, e: QShowEvent) -> None:
        super().showEvent(e)

        # 对话框显示后再触发首次刷新，保证 UI 线程可交互。
        self.schedule_refresh(delay_ms=0)

    def hideEvent(self, a0: QHideEvent | None) -> None:
        super().hideEvent(a0)

        # 对话框关闭后不再需要占用大快照；下次打开会通过 update_snapshot 重新注入。
        self.release_snapshot()

    # =========================================
    # 事件处理
    # =========================================

    def on_file_item_clicked(self, item: QListWidgetItem) -> None:
        """处理文件列表项点击：切换激活状态，刷新列表"""
        widget = self.file_list.itemWidget(item)
        if isinstance(widget, FilterListItemWidget):
            widget.set_checked(not widget.is_checked())
        self.refresh_all()

    def on_term_item_clicked(self, item: QListWidgetItem) -> None:
        """处理术语列表项点击：切换激活状态。

        术语勾选只影响最终返回的 filter options，不参与联动计数刷新。
        """
        widget = self.term_list.itemWidget(item)
        if isinstance(widget, FilterListItemWidget):
            widget.set_checked(not widget.is_checked())

    def on_filter_changed(self) -> None:
        """任意筛选条件变化时触发全局联动刷新"""
        self.refresh_all()

    def filter_file_list(self, keyword: str) -> None:
        """过滤文件列表"""
        keyword = keyword.lower()
        for path, list_item in self.file_list_items.items():
            visible = keyword in path.lower()
            list_item.setHidden(not visible)

    def filter_term_list(self, keyword: str) -> None:
        """过滤术语列表"""
        keyword = keyword.lower()
        for term, list_item in self.term_list_items.items():
            src, dst = term
            visible = keyword in src.lower() or keyword in dst.lower()
            list_item.setHidden(not visible)

    def select_all_files(self) -> None:
        for widget in self.file_list_widgets.values():
            widget.set_checked(True)
        self.refresh_all()

    def deselect_all_files(self) -> None:
        for widget in self.file_list_widgets.values():
            widget.set_checked(False)
        self.refresh_all()

    def select_all_terms(self) -> None:
        for widget in getattr(self, "term_list_widgets", {}).values():
            widget.set_checked(True)

    def deselect_all_terms(self) -> None:
        for widget in getattr(self, "term_list_widgets", {}).values():
            widget.set_checked(False)

    # =========================================
    # 全量联动刷新（防抖 + 后台 compute + 主线程 apply）
    # =========================================

    def build_linked_filter_options_snapshot(self) -> ProofreadingFilterOptions:
        """捕获“联动计数/术语统计”使用的筛选选项快照。"""

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

        # 保持历史行为：术语勾选仅用于“最终筛选结果”，不参与联动计数。
        # 这样用户在勾术语时 UI 不会被迫反复重算计数，也避免计数口径随术语变来变去。
        return ProofreadingFilterOptions(
            warning_types=selected_warnings,
            statuses=selected_statuses,
            file_paths=selected_files,
            glossary_terms=set(),
        )

    def get_current_filtered_items(self) -> list[Item]:
        """根据当前所有筛选条件获取符合条件的条目列表"""
        options = self.build_linked_filter_options_snapshot()
        return ProofreadingDomain.filter_items(
            items=self.items,
            warning_map=self.warning_map,
            options=options,
            checker=self.result_checker,
            enable_search_filter=False,
            enable_glossary_term_filter=False,
        )

    def schedule_refresh(self, *, delay_ms: int | None = None) -> None:
        """安排一次联动刷新（防抖合并）。"""

        # token 每次变化都递增：后台结果回到 UI 线程后只允许最新 token 生效。
        self.refresh_token += 1
        self.refresh_timer.stop()
        self.refresh_timer.start(
            self.FILTER_CHANGE_DEBOUNCE_MS if delay_ms is None else delay_ms
        )

    def refresh_all(self) -> None:
        """触发一次联动刷新（带防抖）。"""

        self.schedule_refresh()

    def start_refresh_compute(self) -> None:
        """由防抖 timer 触发，在 UI 线程捕获快照并启动后台 compute。"""

        token = self.refresh_token
        options_snapshot = self.build_linked_filter_options_snapshot()
        # items 是大列表：只在 UI 线程整体替换，不做原地修改；这里直接引用避免频繁 copy。
        # warning_map / failed_terms 可能在后台任务回调里增量更新；为避免 compute 线程读到并发修改，
        # 在 UI 线程先拷贝一份 dict 快照。
        items_snapshot = self.items
        warning_map_snapshot = dict(self.warning_map) if self.warning_map else {}
        checker_snapshot = self.result_checker
        failed_terms_snapshot = (
            dict(self.failed_terms_by_item_key) if self.failed_terms_by_item_key else {}
        )

        glossary_btn = self.warning_buttons.get(WarningType.GLOSSARY)
        glossary_active = bool(glossary_btn.isChecked()) if glossary_btn else False

        def task() -> None:
            try:
                filtered_items = ProofreadingDomain.filter_items(
                    items=items_snapshot,
                    warning_map=warning_map_snapshot,
                    options=options_snapshot,
                    checker=checker_snapshot,
                    enable_search_filter=False,
                    enable_glossary_term_filter=False,
                )

                file_counts = Counter(item.get_file_path() for item in filtered_items)
                status_counts = Counter(item.get_status() for item in filtered_items)

                warning_counts: dict[str | WarningType, int] = {}
                no_warning_count = 0
                for item in filtered_items:
                    item_warnings = ProofreadingDomain.get_item_warnings(
                        item, warning_map_snapshot
                    )
                    if item_warnings:
                        for w in item_warnings:
                            warning_counts[w] = warning_counts.get(w, 0) + 1
                    else:
                        no_warning_count += 1
                warning_counts[ProofreadingFilterOptions.NO_WARNING_TAG] = (
                    no_warning_count
                )

                term_counts_sorted: tuple[tuple[tuple[str, str], int], ...] = ()
                if glossary_active:
                    term_counts: dict[tuple[str, str], int] = {}
                    for item in filtered_items:
                        item_warnings = ProofreadingDomain.get_item_warnings(
                            item, warning_map_snapshot
                        )
                        if WarningType.GLOSSARY not in item_warnings:
                            continue

                        key = ProofreadingDomain.get_warning_key(item)
                        terms = failed_terms_snapshot.get(key)
                        if terms is None:
                            terms = (
                                tuple(checker_snapshot.get_failed_glossary_terms(item))
                                if checker_snapshot is not None
                                else ()
                            )
                        for term in terms:
                            term_counts[term] = term_counts.get(term, 0) + 1

                    term_counts_sorted = tuple(
                        sorted(term_counts.items(), key=lambda x: x[1], reverse=True)
                    )

                self.refresh_computed.emit(
                    FilterRefreshComputeResult(
                        token=token,
                        file_counts=dict(file_counts),
                        status_counts=dict(status_counts),
                        warning_counts=warning_counts,
                        term_counts_sorted=term_counts_sorted,
                        glossary_active=glossary_active,
                    )
                )
            except Exception as e:
                LogManager.get().error("校对筛选：联动刷新计算失败", e)

        threading.Thread(target=task, daemon=True).start()

    def on_refresh_computed_ui(self, payload: object) -> None:
        if not isinstance(payload, FilterRefreshComputeResult):
            return
        if not self.isVisible():
            return
        if payload.token != self.refresh_token:
            return
        try:
            self.widget.setUpdatesEnabled(False)
            self.apply_file_counts(payload.file_counts)
            self.apply_status_counts(payload.status_counts)
            self.apply_warning_counts(payload.warning_counts)
            self.apply_term_list(
                payload.term_counts_sorted, active=payload.glossary_active
            )
        finally:
            self.widget.setUpdatesEnabled(True)

    def apply_file_counts(self, file_counts: dict[str, int]) -> None:
        for path, widget in self.file_list_widgets.items():
            count = file_counts.get(path, 0)
            if widget.get_count() != count:
                widget.set_count(count)

    def apply_status_counts(self, status_counts: dict[Base.ProjectStatus, int]) -> None:
        for status, btn in self.status_buttons.items():
            count = status_counts.get(status, 0)
            if self.status_count_cache.get(status) == count:
                continue

            base_label = self.status_base_labels.get(status)
            if base_label is None:
                base_label = btn.text().rsplit(" • ", 1)[0]
                self.status_base_labels[status] = base_label

            btn.setText(f"{base_label} • {count}")
            self.status_count_cache[status] = count

    def apply_warning_counts(
        self, warning_counts: dict[str | WarningType, int]
    ) -> None:
        for warning_type, btn in self.warning_buttons.items():
            count = warning_counts.get(warning_type, 0)
            if self.warning_count_cache.get(warning_type) == count:
                continue

            base_label = self.warning_base_labels.get(warning_type)
            if base_label is None:
                base_label = btn.text().rsplit(" • ", 1)[0]
                self.warning_base_labels[warning_type] = base_label

            btn.setText(f"{base_label} • {count}")
            self.warning_count_cache[warning_type] = count

    def sync_term_widgets_to_state(self) -> None:
        """将当前可见 widget 的状态同步到持久化存储（增量更新）"""
        current_widgets = getattr(self, "term_list_widgets", {})
        if current_widgets:
            for term, widget in current_widgets.items():
                if widget.is_checked():
                    self.term_checked_state.add(term)
                else:
                    self.term_checked_state.discard(term)

    def apply_term_list(
        self,
        sorted_terms: tuple[tuple[tuple[str, str], int], ...],
        *,
        active: bool,
    ) -> None:
        """应用术语明细列表（仅在主线程更新 Qt 对象）。"""

        # 先同步当前状态，避免 rebuild 丢失用户勾选。
        self.sync_term_widgets_to_state()

        self.term_search.setEnabled(active)
        self.btn_select_all_terms.setEnabled(active)
        self.btn_clear_terms.setEnabled(active)
        self.term_list.setEnabled(active)

        if not active:
            self.term_empty_label.setText(
                Localizer.get().proofreading_page_filter_no_glossary_error
            )
            self.term_empty_label.show()
            self.term_list.hide()
            self.term_list_order = ()
            return

        if not sorted_terms:
            self.term_empty_label.setText(
                Localizer.get().proofreading_page_filter_no_glossary_error
            )
            self.term_empty_label.show()
            self.term_list.hide()
            self.term_list_order = ()
            return

        self.term_empty_label.hide()
        self.term_list.show()

        new_order = tuple(term for term, _ in sorted_terms)
        if self.term_list_order == new_order:
            for term, count in sorted_terms:
                widget = self.term_list_widgets.get(term)
                if widget is None:
                    continue
                if widget.get_count() != count:
                    widget.set_count(count)
            return

        self.term_list_order = new_order
        self.term_list.setUpdatesEnabled(False)
        try:
            self.term_list.clear()
            self.term_list_items.clear()
            self.term_list_widgets = {}

            for term, count in sorted_terms:
                src, dst = term
                display_text = f"{src} → {dst}"

                list_item = QListWidgetItem()
                list_item.setSizeHint(QSize(-1, 40))
                list_item.setData(Qt.ItemDataRole.UserRole, term)
                self.term_list.addItem(list_item)

                item_widget = FilterListItemWidget(display_text, self.term_list)
                item_widget.set_checked(term in self.term_checked_state)
                item_widget.set_count(count)
                item_widget.set_tooltip(display_text)
                self.term_list.setItemWidget(list_item, item_widget)

                self.term_list_items[term] = list_item
                self.term_list_widgets[term] = item_widget
        finally:
            self.term_list.setUpdatesEnabled(True)

        # rebuild 后需要重新应用关键字过滤
        self.filter_term_list(self.term_search.text())

    def release_snapshot(self) -> None:
        """释放与工程强绑定的大快照，减少常驻内存占用。

        FilterDialog 会被 ProofreadingPage 复用；对话框隐藏时清掉大对象引用，
        下次打开前会通过 update_snapshot(...) 重新注入数据。
        """

        # 隐藏后不再需要刷新，避免 timer 触发后台 compute。
        self.refresh_token += 1
        self.refresh_timer.stop()

        self.items = []
        self.warning_map = {}
        self.failed_terms_by_item_key = {}
        self.all_glossary_terms = set()
        self.term_list_order = ()

    # =========================================
    # 公共接口
    # =========================================

    def update_snapshot(
        self,
        *,
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
        result_checker: ResultChecker,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> None:
        """更新对话框的数据源与内部缓存。

        用于 ProofreadingPage 复用 FilterDialog 实例，避免每次打开都重建控件树。
        """

        # 先失效所有在途 refresh 结果，避免旧快照覆盖新状态。
        self.refresh_token += 1
        self.refresh_timer.stop()

        self.items = [
            i
            for i in items
            if i.get_status()
            not in (
                Base.ProjectStatus.EXCLUDED,
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            )
        ]
        self.warning_map = warning_map
        self.result_checker = result_checker

        # 当成只读快照使用：Page 在刷新时会整体替换 dict，而不是原地 mutate。
        self.failed_terms_by_item_key = failed_terms_by_item_key or {}
        all_terms: set[tuple[str, str]] = set()
        for terms in self.failed_terms_by_item_key.values():
            all_terms.update(terms)
        self.all_glossary_terms = all_terms

        # 数据源变化可能导致文件列表范围变化：必要时重建列表。
        new_paths = {item.get_file_path() for item in self.items}
        old_paths = set(self.file_list_items.keys())
        if new_paths != old_paths:
            prev_checked = {
                path: widget.is_checked()
                for path, widget in self.file_list_widgets.items()
            }
            self.rebuild_file_list(sorted(new_paths), prev_checked=prev_checked)

        # 让下一次 apply_term_list 强制 rebuild，以便同步 checkbox 状态。
        self.term_list_order = ()

        # 快照更新后若对话框可见，尽快刷新一次。
        if self.isVisible():
            self.schedule_refresh(delay_ms=0)

    def rebuild_file_list(
        self, file_paths: list[str], *, prev_checked: dict[str, bool] | None = None
    ) -> None:
        self.file_list.setUpdatesEnabled(False)
        try:
            self.file_list.clear()
            self.file_list_items = {}
            self.file_list_widgets = {}

            for path in file_paths:
                list_item = QListWidgetItem()
                list_item.setSizeHint(QSize(-1, 40))
                list_item.setData(Qt.ItemDataRole.UserRole, path)
                self.file_list.addItem(list_item)

                item_widget = FilterListItemWidget(path, self.file_list)
                item_widget.set_checked(
                    True if prev_checked is None else prev_checked.get(path, True)
                )
                item_widget.set_count(0)
                item_widget.set_tooltip(path)
                self.file_list.setItemWidget(list_item, item_widget)

                self.file_list_items[path] = list_item
                self.file_list_widgets[path] = item_widget
        finally:
            self.file_list.setUpdatesEnabled(True)

        self.filter_file_list(self.file_search.text())

    def reset_for_open(self) -> None:
        """每次打开对话框前重置瞬时状态。"""

        # 失效在途结果，避免复用实例时出现“旧 token 结果覆盖”。
        self.refresh_token += 1
        self.refresh_timer.stop()

        # 保持与“每次新建对话框”一致：搜索框不跨次打开保留。
        self.file_search.setText("")
        self.term_search.setText("")

    def get_filter_options(self) -> ProofreadingFilterOptions:
        # 强制同步当前可见 widget 的状态到持久化存储，以防最后的操作没有触发刷新
        self.sync_term_widgets_to_state()

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

        selected_terms: set[tuple[str, str]] = set()
        if WarningType.GLOSSARY in selected_warnings:
            selected_terms = set(self.term_checked_state)

        return ProofreadingFilterOptions(
            warning_types=selected_warnings,
            statuses=selected_statuses,
            file_paths=selected_files,
            glossary_terms=selected_terms,
        )

    def set_filter_options(self, options: ProofreadingFilterOptions | dict) -> None:
        resolved = (
            options
            if isinstance(options, ProofreadingFilterOptions)
            else ProofreadingFilterOptions.from_dict(options)
        )

        warning_types = resolved.warning_types
        if warning_types is None:
            warning_types = set(self.warning_buttons.keys())
        for warning_type, btn in self.warning_buttons.items():
            btn.setChecked(warning_type in warning_types)

        statuses = resolved.statuses
        if statuses is None:
            statuses = {
                status
                for status in self.status_buttons
                if status != Base.ProjectStatus.LANGUAGE_SKIPPED
            }
        for status, btn in self.status_buttons.items():
            btn.setChecked(status in statuses)

        file_paths = resolved.file_paths
        if file_paths is None:
            file_paths = set(self.file_list_items.keys())
        for path, widget in self.file_list_widgets.items():
            widget.set_checked(path in file_paths)

        # 在 refresh_all 前预设术语持久化状态
        glossary_terms = resolved.glossary_terms
        if glossary_terms is None:
            glossary_terms = set(self.all_glossary_terms)
        self.term_checked_state = set(glossary_terms)
        # 关键修复：设置了新状态后，必须清空旧的 widget 引用
        # 防止随后的 refresh_all -> sync 将旧 UI 的全选状态同步回来覆盖掉刚设置的状态
        self.term_list_widgets = {}
        self.term_list_order = ()

        if self.isVisible():
            # 对话框可见时，立刻刷新一次以同步计数与术语勾选 UI。
            self.schedule_refresh(delay_ms=0)
