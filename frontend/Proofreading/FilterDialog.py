from collections import Counter
from datetime import datetime
from pathlib import Path

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
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from module.Storage.StorageContext import StorageContext
from widget.CustomLineEdit import CustomSearchLineEdit


class FilterListItemWidget(QWidget):
    """自定义列表项 widget：悬浮背景 + 手绘 checkbox + CaptionLabel 文本 + 计数"""

    def __init__(self, text: str, parent: QWidget = None) -> None:
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
        self.text_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        self.text_label.setAttribute(Qt.WA_TransparentForMouseEvents)

        # 使用 CaptionLabel 显示计数
        self.count_label = CaptionLabel("0", self)
        self.count_label.setMinimumWidth(32)
        self.count_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.count_label.setAttribute(Qt.WA_TransparentForMouseEvents)

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

    def enterEvent(self, event) -> None:
        """鼠标进入时设置悬浮状态"""
        self.hovered = True
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:
        """鼠标离开时取消悬浮状态"""
        self.hovered = False
        self.update()
        super().leaveEvent(event)

    def get_check_color(self) -> QColor:
        if not isDarkTheme():
            return QColor(255, 255, 255)

        color = themeColor()
        luma = 0.2126 * color.redF() + 0.7152 * color.greenF() + 0.0722 * color.blueF()
        return QColor(0, 0, 0) if luma > 0.75 else QColor(255, 255, 255)

    def paintEvent(self, event) -> None:
        """绘制悬浮背景 + Fluent 风格 checkbox"""
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)

        # 1. 绘制悬浮背景（Fluent 风格圆角矩形）
        if self.hovered:
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
            self.left_padding,
            cy - self.checkbox_size // 2,
            self.checkbox_size,
            self.checkbox_size,
        )

        if self.checked:
            # 选中状态：主题色背景 + 白色勾
            painter.setBrush(themeColor())
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(checkbox_rect, 5, 5)

            # 绘制白色对勾
            check_pen = QPen(self.get_check_color(), 2)
            check_pen.setCapStyle(Qt.RoundCap)
            check_pen.setJoinStyle(Qt.RoundJoin)
            painter.setPen(check_pen)

            origin = checkbox_rect.topLeft()
            w = self.checkbox_size
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

        # WHY: 规则跳过条目无需校对；非目标原文语言可由用户选择显示
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

        # 预计算术语错误明细：{ (src, dst): [item, ...] }
        self.glossary_error_map: dict[tuple[str, str], list[Item]] = {}
        self.build_glossary_error_map()

        # 持久化保存术语选中状态，初始化为全选
        self.term_checked_state: set[tuple[str, str]] = set(
            self.glossary_error_map.keys()
        )

        self.init_ui()
        # 初始化后刷新一次联动数据
        self.refresh_all()

    def export_error_report(self) -> None:
        """导出错误报告"""
        # 1. 获取当前筛选结果中的错误条目
        items = self.get_current_filtered_items()
        error_items = [i for i in items if self.warning_map.get(id(i))]

        if not error_items:
            InfoBar.warning(
                title=Localizer.get().alert,
                content=Localizer.get().alert_no_data,
                orient=Qt.Horizontal,
                isClosable=True,
                position=InfoBarPosition.TOP,
                duration=2000,
                parent=self.window(),
            )
            return

        # 2. 准备导出路径
        lg_path = StorageContext.get().get_lg_path()
        if not lg_path:
            return

        project_path = Path(lg_path)
        project_name = project_path.stem
        # 输出文件名: [工程名]_结果检查.txt
        output_name = f"{project_name}_结果检查.txt"
        output_path = project_path.parent / output_name

        # 3. 准备警告类型名称映射
        warning_labels = {
            WarningType.KANA: Localizer.get().proofreading_page_warning_kana,
            WarningType.HANGEUL: Localizer.get().proofreading_page_warning_hangeul,
            WarningType.TEXT_PRESERVE: Localizer.get().proofreading_page_warning_text_preserve,
            WarningType.SIMILARITY: Localizer.get().proofreading_page_warning_similarity,
            WarningType.GLOSSARY: Localizer.get().proofreading_page_warning_glossary,
            WarningType.RETRY_THRESHOLD: Localizer.get().proofreading_page_warning_retry,
        }

        # 4. 生成内容
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
            w: b for w, b in self.warning_buttons.items() if w != self.NO_WARNING_TAG
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
            warnings = self.warning_map.get(id(item), [])
            warning_strs = [warning_labels.get(w, w) for w in warnings]
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
                orient=Qt.Horizontal,
                isClosable=True,
                position=InfoBarPosition.TOP,
                duration=3000,
                parent=self.window(),  # 使用 window() 获取顶层窗口作为父组件
            )
        except Exception as e:
            LogManager.get().error("", e)

    def build_glossary_error_map(self) -> None:
        """构建术语错误明细映射"""
        for item in self.items:
            if WarningType.GLOSSARY not in self.warning_map.get(id(item), []):
                continue
            failed_terms = self.result_checker.get_failed_glossary_terms(item)
            for term in failed_terms:
                if term not in self.glossary_error_map:
                    self.glossary_error_map[term] = []
                self.glossary_error_map[term].append(item)

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
        left_layout.setAlignment(Qt.AlignTop)

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
        list_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
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
            (Base.ProjectStatus.NONE, Localizer.get().proofreading_page_status_none),
            (
                Base.ProjectStatus.PROCESSED,
                Localizer.get().proofreading_page_status_processed,
            ),
            (
                Base.ProjectStatus.ERROR,
                Localizer.get().proofreading_page_status_error,
            ),
            (
                Base.ProjectStatus.PROCESSED_IN_PAST,
                Localizer.get().proofreading_page_status_processed_in_past,
            ),
            (
                Base.ProjectStatus.LANGUAGE_SKIPPED,
                Localizer.get().proofreading_page_status_non_target_source_language,
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

        title_row.addWidget(
            BodyLabel(Localizer.get().proofreading_page_filter_warning_type)
        )
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
        self.term_empty_label.setAlignment(Qt.AlignCenter)
        self.term_empty_label.hide()
        layout.addWidget(self.term_empty_label)

        self.term_list_items: dict[tuple[str, str], QListWidgetItem] = {}
        self.term_list_widgets: dict[tuple[str, str], FilterListItemWidget] = {}

        return card

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
        """处理术语列表项点击：切换激活状态，刷新信息"""
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
    # 全量联动刷新
    # =========================================

    def get_current_filtered_items(self) -> list[Item]:
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

    def refresh_all(self) -> None:
        """全量联动刷新：所有模块的计数都基于当前筛选结果"""
        filtered_items = self.get_current_filtered_items()

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
        self.refresh_term_list(filtered_items, glossary_active)

    def sync_term_widgets_to_state(self) -> None:
        """将当前可见 widget 的状态同步到持久化存储（增量更新）"""
        current_widgets = getattr(self, "term_list_widgets", {})
        if current_widgets:
            for term, widget in current_widgets.items():
                if widget.is_checked():
                    self.term_checked_state.add(term)
                else:
                    self.term_checked_state.discard(term)

    def refresh_term_list(self, filtered_items: list[Item], active: bool) -> None:
        """刷新术语明细列表"""

        # 先同步当前状态
        self.sync_term_widgets_to_state()

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
            # 从持久化状态恢复选中
            item_widget.set_checked(term in self.term_checked_state)
            item_widget.set_count(count)
            item_widget.set_tooltip(display_text)
            self.term_list.setItemWidget(list_item, item_widget)

            self.term_list_items[term] = list_item
            self.term_list_widgets[term] = item_widget

    # =========================================
    # 公共接口
    # =========================================

    def get_filter_options(self) -> dict:
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

        return {
            self.KEY_WARNING_TYPES: selected_warnings,
            self.KEY_STATUSES: selected_statuses,
            self.KEY_FILE_PATHS: selected_files,
            self.KEY_GLOSSARY_TERMS: selected_terms,
        }

    def set_filter_options(self, options: dict) -> None:
        warning_types = options.get(self.KEY_WARNING_TYPES)
        if warning_types is None:
            warning_types = set(self.warning_buttons.keys())
        for warning_type, btn in self.warning_buttons.items():
            btn.setChecked(warning_type in warning_types)

        statuses = options.get(self.KEY_STATUSES)
        if statuses is None:
            statuses = {
                status
                for status in self.status_buttons
                if status != Base.ProjectStatus.LANGUAGE_SKIPPED
            }
        for status, btn in self.status_buttons.items():
            btn.setChecked(status in statuses)

        file_paths = options.get(self.KEY_FILE_PATHS)
        if file_paths is None:
            file_paths = set(self.file_list_items.keys())
        for path, widget in self.file_list_widgets.items():
            widget.set_checked(path in file_paths)

        # 在 refresh_all 前预设术语持久化状态
        glossary_terms = options.get(self.KEY_GLOSSARY_TERMS)
        if glossary_terms is None:
            glossary_terms = set(self.glossary_error_map.keys())
        self.term_checked_state = set(glossary_terms)
        # 关键修复：设置了新状态后，必须清空旧的 widget 引用
        # 防止随后的 refresh_all -> sync 将旧 UI 的全选状态同步回来覆盖掉刚设置的状态
        self.term_list_widgets = {}

        self.refresh_all()
