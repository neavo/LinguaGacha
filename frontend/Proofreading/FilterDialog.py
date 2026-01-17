from collections import Counter

from PyQt5.QtCore import QRect
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QFontMetrics
from PyQt5.QtGui import QIcon
from PyQt5.QtGui import QPainter
from PyQt5.QtGui import QPalette
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QListWidgetItem
from PyQt5.QtWidgets import QStyle
from PyQt5.QtWidgets import QStyleOptionButton
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
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor

from base.Base import Base
from model.Item import Item
from module.Localizer.Localizer import Localizer
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType
from widget.CustomLineEdit import CustomSearchLineEdit

# 自定义激活状态存储在 UserRole + 2
ROLE_CHECKED = Qt.UserRole + 2

class FilterListDelegate(ListItemDelegate):
    """自定义列表项委托：绘制自定义勾选指示器 + 文本 + 右侧计数"""

    def paint(self, painter: QPainter, option: QStyleOptionViewItem, index):
        painter.save()
        painter.setRenderHint(QPainter.Antialiasing)

        # 1. 绘制 Fluent 风格背景（使用基类逻辑，但清空文本和图标防止重叠）
        # 复制 option 以避免修改原始对象影响后续步骤
        bg_option = QStyleOptionViewItem(option)
        bg_option.text = ""
        bg_option.icon = QIcon()
        super().paint(painter, bg_option, index)

        rect = option.rect
        # 布局参数
        checkbox_size = 22
        left_padding = 14
        item_spacing = 12

        # 2. 绘制 CheckBox (使用当前 Style 绘制以匹配 QFluentWidgets 风格)
        # 获取当前激活状态
        is_checked = index.data(ROLE_CHECKED)

        checkbox_opt = QStyleOptionButton()
        checkbox_opt.rect = QRect(
            rect.left() + left_padding,
            rect.top() + (rect.height() - checkbox_size) // 2,
            checkbox_size,
            checkbox_size
        )
        # 设置状态：启用 | 根据 UserRole 设置选中态
        checkbox_opt.state = QStyle.State_Enabled
        if is_checked:
            checkbox_opt.state |= QStyle.State_On
        else:
            checkbox_opt.state |= QStyle.State_Off

        # 使用 application style (可能是 FluentStyle) 绘制
        QApplication.style().drawPrimitive(QStyle.PE_IndicatorCheckBox, checkbox_opt, painter)

        # 3. 绘制图标 (如果有)
        current_x = rect.left() + left_padding + checkbox_size + item_spacing
        icon = index.data(Qt.DecorationRole)
        if icon and not icon.isNull():
            icon_size = 16
            icon_rect = QRect(
                current_x,
                rect.top() + (rect.height() - icon_size) // 2,
                icon_size,
                icon_size
            )
            mode = QIcon.Normal
            if not (option.state & QStyle.State_Enabled):
                mode = QIcon.Disabled
            elif option.state & QStyle.State_Selected:
                mode = QIcon.Selected

            icon.paint(painter, icon_rect, Qt.AlignCenter, mode, QIcon.Off)
            current_x += icon_size + 8  # 图标与文本的间距

        # 4. 绘制文本
        # 计算文本区域，右侧保留 48px 给计数
        text_rect = QRect(current_x, rect.top(), rect.right() - 48 - current_x, rect.height())

        text = index.data(Qt.DisplayRole) or ""
        # 文本颜色逻辑与原 ListItemDelegate 保持一致或使用标准颜色
        if option.state & QStyle.State_Selected:
            text_color = option.palette.color(QPalette.HighlightedText) if option.palette else Qt.white
            # FluentWidgets 选中时通常文字颜色也会变，或者保持原色。
            # 这里简单处理，参考之前：
            text_color = QColor(255, 255, 255) if isDarkTheme() else QColor(0, 0, 0)
        else:
            text_color = QColor("#e0e0e0") if isDarkTheme() else QColor("#303030")

        painter.setPen(text_color)
        painter.setFont(option.font)

        # 文本省略
        fm = QFontMetrics(option.font)
        elided_text = fm.elidedText(text, Qt.ElideRight, text_rect.width())
        painter.drawText(text_rect, Qt.AlignLeft | Qt.AlignVCenter, elided_text)

        # 4. 绘制右侧计数
        count = index.data(Qt.UserRole + 1)
        if count is not None:
            count_text = str(count)
            # 计数文字颜色偏淡
            count_color = QColor("#d0d0d0") if isDarkTheme() else QColor("#606060")
            painter.setPen(count_color)

            font = option.font
            font.setPixelSize(12)
            painter.setFont(font)

            count_rect = QRect(rect.right() - 40, rect.top(), 32, rect.height())
            painter.drawText(count_rect, Qt.AlignRight | Qt.AlignVCenter, count_text)

        painter.restore()

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
            i for i in items
            if i.get_status() not in (Base.ProjectStatus.EXCLUDED, Base.ProjectStatus.DUPLICATED)
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
        self.file_search.setPlaceholderText(Localizer.get().proofreading_page_filter_search_file)
        self.file_search.textChanged.connect(self._filter_file_list)
        layout.addWidget(self.file_search)

        layout.addSpacing(8)

        # 文件列表
        self.file_list = ListWidget()
        self.file_list.setMinimumHeight(400)
        # 禁用默认的选中高亮行为，通过点击事件切换激活状态
        self.file_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.file_list.setItemDelegate(FilterListDelegate(self.file_list))
        # 绑定点击事件用于切换激活状态
        self.file_list.itemClicked.connect(self._on_file_item_clicked)

        # 统计每个文件的条目数，按路径排序
        file_item_counts = Counter(item.get_file_path() for item in self.items)
        file_paths = sorted(file_item_counts.keys())
        self.file_list_items: dict[str, QListWidgetItem] = {}

        for path in file_paths:
            display_name = path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
            count = file_item_counts[path]

            list_item = QListWidgetItem(display_name)
            list_item.setSizeHint(QSize(-1, 36))
            list_item.setData(Qt.UserRole, path)     # 存储路径
            list_item.setData(Qt.UserRole + 1, 0)    # 存储动态计数(初始0，稍后refresh更新)
            list_item.setData(ROLE_CHECKED, True)    # 默认激活
            list_item.setToolTip(path)               # 原生 ToolTip

            self.file_list.addItem(list_item)
            self.file_list_items[path] = list_item

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
            (Base.ProjectStatus.PROCESSED, Localizer.get().proofreading_page_status_processed),
            (Base.ProjectStatus.PROCESSED_IN_PAST, Localizer.get().proofreading_page_status_processed_in_past),
        ]

        for status, label in status_types:
            btn = PillPushButton(f"{label} · 0")
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

        layout.addWidget(BodyLabel(Localizer.get().proofreading_page_filter_warning_type))
        layout.addSpacing(8)

        warning_row = FlowLayout(needAni=False)
        warning_row.setSpacing(8)
        warning_row.setContentsMargins(0, 0, 0, 0)

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

        for warning_type, label in warning_types:
            btn = PillPushButton(f"{label} · 0")
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
        self.term_title = BodyLabel(Localizer.get().proofreading_page_filter_glossary_detail)
        title_row.addWidget(self.term_title)
        title_row.addStretch(1)

        self.btn_select_all_terms = PushButton(Localizer.get().proofreading_page_filter_select_all)
        self.btn_clear_terms = PushButton(Localizer.get().proofreading_page_filter_clear)

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
        self.term_search.setPlaceholderText(Localizer.get().proofreading_page_filter_search_term)
        self.term_search.textChanged.connect(self._filter_term_list)
        layout.addWidget(self.term_search)

        layout.addSpacing(8)

        # 术语列表
        self.term_list = ListWidget()
        self.term_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.term_list.setItemDelegate(FilterListDelegate(self.term_list))
        self.term_list.itemClicked.connect(self._on_term_item_clicked)
        layout.addWidget(self.term_list, 1)

        # 空状态/禁用状态提示
        self.term_empty_label = CaptionLabel(Localizer.get().proofreading_page_filter_no_glossary_error)
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
        current = item.data(ROLE_CHECKED)
        item.setData(ROLE_CHECKED, not current)
        self.file_list.viewport().update()
        self._refresh_all()

    def _on_term_item_clicked(self, item: QListWidgetItem) -> None:
        """处理术语列表项点击：切换激活状态，刷新信息"""
        current = item.data(ROLE_CHECKED)
        item.setData(ROLE_CHECKED, not current)
        self.term_list.viewport().update()
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
        for i in range(self.file_list.count()):
            self.file_list.item(i).setData(ROLE_CHECKED, True)
        self.file_list.viewport().update()
        self._refresh_all()

    def _deselect_all_files(self) -> None:
        for i in range(self.file_list.count()):
            self.file_list.item(i).setData(ROLE_CHECKED, False)
        self.file_list.viewport().update()
        self._refresh_all()

    def _select_all_terms(self) -> None:
        for i in range(self.term_list.count()):
            self.term_list.item(i).setData(ROLE_CHECKED, True)
        self.term_list.viewport().update()
        self._update_selected_info()

    def _deselect_all_terms(self) -> None:
        for i in range(self.term_list.count()):
            self.term_list.item(i).setData(ROLE_CHECKED, False)
        self.term_list.viewport().update()
        self._update_selected_info()

    # =========================================
    # 全量联动刷新
    # =========================================

    def _get_current_filtered_items(self) -> list[Item]:
        """根据当前所有筛选条件获取符合条件的条目列表"""
        # 使用 Qt.UserRole 获取文件路径，根据 ROLE_CHECKED 判断是否激活
        selected_files = set()
        for i in range(self.file_list.count()):
            item = self.file_list.item(i)
            if item.data(ROLE_CHECKED):
                selected_files.add(item.data(Qt.UserRole))

        selected_statuses = {s for s, btn in self.status_buttons.items() if btn.isChecked()}
        selected_warnings = {w for w, btn in self.warning_buttons.items() if btn.isChecked()}

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
        # 更新文件列表计数 (UserRole+1) 并强制重绘
        file_counts = Counter(item.get_file_path() for item in filtered_items)
        for i in range(self.file_list.count()):
            list_item = self.file_list.item(i)
            path = list_item.data(Qt.UserRole)
            count = file_counts.get(path, 0)
            if list_item.data(Qt.UserRole + 1) != count:
                list_item.setData(Qt.UserRole + 1, count)
        # 触发重绘以更新计数显示
        self.file_list.viewport().update()

        # 更新状态标签计数
        status_counts = Counter(item.get_status() for item in filtered_items)
        for status, btn in self.status_buttons.items():
            count = status_counts.get(status, 0)
            base_label = btn.text().rsplit(" · ", 1)[0]
            btn.setText(f"{base_label} · {count}")

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
            count = no_warning_count if warning_type == self.NO_WARNING_TAG else warning_counts.get(warning_type, 0)
            base_label = btn.text().rsplit(" · ", 1)[0]
            btn.setText(f"{base_label} · {count}")

        # 更新术语明细
        glossary_active = self.warning_buttons[WarningType.GLOSSARY].isChecked()
        self._refresh_term_list(filtered_items, glossary_active)
        self._update_selected_info()

    def _refresh_term_list(self, filtered_items: list[Item], active: bool) -> None:
        """刷新术语明细列表"""

        # 记录当前激活的术语，以便在重建列表时维持状态
        previous_checked = set()
        for i in range(self.term_list.count()):
            item = self.term_list.item(i)
            if item.data(ROLE_CHECKED):
                previous_checked.add(item.data(Qt.UserRole))

        self.term_list.clear()
        self.term_list_items.clear()

        # 更新控件启用状态
        self.term_search.setEnabled(active)
        self.btn_select_all_terms.setEnabled(active)
        self.btn_clear_terms.setEnabled(active)
        self.term_list.setEnabled(active)

        if not active:
            # 未激活状态：显示禁用提示
            self.term_empty_label.setText(Localizer.get().proofreading_page_filter_no_glossary_error)
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
            self.term_empty_label.setText(Localizer.get().proofreading_page_filter_no_glossary_error)
            self.term_empty_label.show()
            self.term_list.hide()
            return

        self.term_empty_label.hide()
        self.term_list.show()

        for term, count in sorted_terms:
            src, dst = term
            list_item = QListWidgetItem(f"{src} → {dst}")
            list_item.setSizeHint(QSize(-1, 36))
            list_item.setData(Qt.UserRole, term)      # 存储术语 Key
            list_item.setData(Qt.UserRole + 1, count) # 存储计数
            list_item.setData(ROLE_CHECKED, True)     # 默认激活
            list_item.setToolTip(f"{src} → {dst}")

            self.term_list.addItem(list_item)
            self.term_list_items[term] = list_item

    def _update_selected_info(self) -> None:
        """更新底部选中信息"""
        filtered_items = self._get_current_filtered_items()

        # 如果术语筛选激活，进一步过滤
        glossary_active = self.warning_buttons[WarningType.GLOSSARY].isChecked()
        if glossary_active and self.term_list.count() > 0:
            selected_terms = set()
            for i in range(self.term_list.count()):
                item = self.term_list.item(i)
                if item.data(ROLE_CHECKED):
                    selected_terms.add(item.data(Qt.UserRole))

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
        selected_warnings = {w for w, btn in self.warning_buttons.items() if btn.isChecked()}
        selected_statuses = {s for s, btn in self.status_buttons.items() if btn.isChecked()}
        selected_files = set()
        for i in range(self.file_list.count()):
            item = self.file_list.item(i)
            if item.data(ROLE_CHECKED):
                selected_files.add(item.data(Qt.UserRole))

        selected_terms = None
        if WarningType.GLOSSARY in selected_warnings and self.term_list.count() > 0:
            checked_terms = set()
            for i in range(self.term_list.count()):
                item = self.term_list.item(i)
                if item.data(ROLE_CHECKED):
                    checked_terms.add(item.data(Qt.UserRole))

            if len(checked_terms) < self.term_list.count():
                selected_terms = checked_terms

        return {
            self.KEY_WARNING_TYPES: selected_warnings if len(selected_warnings) < len(self.warning_buttons) else None,
            self.KEY_STATUSES: selected_statuses if len(selected_statuses) < len(self.status_buttons) else None,
            self.KEY_FILE_PATHS: selected_files if len(selected_files) < len(self.file_list_items) else None,
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
        for i in range(self.file_list.count()):
            item = self.file_list.item(i)
            path = item.data(Qt.UserRole)
            item.setData(ROLE_CHECKED, file_paths is None or path in file_paths)

        self.file_list.viewport().update()
        self._refresh_all()

        # 刷新后再尝试恢复术语激活状态
        glossary_terms = options.get(self.KEY_GLOSSARY_TERMS)
        if glossary_terms and self.term_list.count() > 0:
            for i in range(self.term_list.count()):
                item = self.term_list.item(i)
                term = item.data(Qt.UserRole)
                item.setData(ROLE_CHECKED, term in glossary_terms)
            self.term_list.viewport().update()
            self._update_selected_info()
