import os
from datetime import datetime
from pathlib import Path

from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtGui import QDragEnterEvent
from PyQt5.QtGui import QDropEvent
from PyQt5.QtGui import QFont
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QFrame
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLabel
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import BodyLabel
from qfluentwidgets import CaptionLabel
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import MessageBox
from qfluentwidgets import PrimaryPushButton
from qfluentwidgets import ProgressBar
from qfluentwidgets import ScrollArea
from qfluentwidgets import SimpleCardWidget
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import TitleLabel
from qfluentwidgets import TransparentToolButton
from qfluentwidgets import isDarkTheme
from qfluentwidgets import themeColor

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Storage.ProjectStore import ProjectStore
from module.Storage.StorageContext import StorageContext

class FileDisplayCard(CardWidget):
    """文件展示卡片基类"""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setFixedHeight(180)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setAcceptDrops(True)

        self.main_layout = QVBoxLayout(self)
        self.main_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.main_layout.setSpacing(8)

        self.update_style()

    def update_style(self):
        """更新样式，适配亮/暗色主题"""
        border_color = (
            "rgba(255, 255, 255, 0.1)" if isDarkTheme() else "rgba(0, 0, 0, 0.1)"
        )

        # 计算 hover 背景色 (使用极低透明度的主题色)
        c = themeColor()
        hover_bg = f"rgba({c.red()}, {c.green()}, {c.blue()}, 0.05)"
        hover_border = c.name()

        # 使用 objectName 或者类型选择器
        self.setStyleSheet(f"""
            FileDisplayCard, DropZone, SelectedFileDisplay {{
                border: 2px dashed {border_color};
                border-radius: 8px;
                background-color: transparent;
            }}
            FileDisplayCard:hover, DropZone:hover, SelectedFileDisplay:hover {{
                border-color: {hover_border};
                background-color: {hover_bg};
            }}
        """)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()


class DropZone(FileDisplayCard):
    """拖拽区域组件"""

    fileDropped = pyqtSignal(str)  # 文件/目录拖入信号
    clicked = pyqtSignal()  # 点击信号

    def __init__(
        self, icon: FluentIcon, title: str, subtitle: str, parent=None
    ) -> None:
        super().__init__(parent)

        # 图标
        self.icon_widget = IconWidget(icon, self)
        self.icon_widget.setFixedSize(48, 48)
        self.main_layout.addWidget(
            self.icon_widget, alignment=Qt.AlignmentFlag.AlignCenter
        )

        # 标题
        self.title_label = StrongBodyLabel(title, self)
        self.main_layout.addWidget(
            self.title_label, alignment=Qt.AlignmentFlag.AlignCenter
        )

        # 副标题
        self.subtitle_label = CaptionLabel(subtitle, self)
        self.main_layout.addWidget(
            self.subtitle_label, alignment=Qt.AlignmentFlag.AlignCenter
        )

    def set_text(self, title: str, subtitle: str) -> None:
        self.title_label.setText(title)
        self.subtitle_label.setText(subtitle)

    def set_icon(self, icon: FluentIcon) -> None:
        self.icon_widget.setIcon(icon)

    def dropEvent(self, event: QDropEvent) -> None:
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            self.fileDropped.emit(path)


class SelectedFileDisplay(FileDisplayCard):
    """已选文件显示组件"""

    clicked = pyqtSignal()
    fileDropped = pyqtSignal(str)

    def __init__(self, file_name: str, is_ready: bool = True, parent=None) -> None:
        super().__init__(parent)

        # 图标
        self.icon_widget = IconWidget(FluentIcon.DOCUMENT, self)
        self.icon_widget.setFixedSize(48, 48)
        self.main_layout.addWidget(
            self.icon_widget, alignment=Qt.AlignmentFlag.AlignCenter
        )

        # 文件名
        name_label = StrongBodyLabel(file_name, self)
        self.main_layout.addWidget(name_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 状态
        status_text = (
            Localizer.get().workbench_project_ready
            if is_ready
            else Localizer.get().workbench_project_preparing
        )
        status_label = CaptionLabel(status_text, self)
        self.main_layout.addWidget(status_label, alignment=Qt.AlignmentFlag.AlignCenter)

    def dropEvent(self, event: QDropEvent) -> None:
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            self.fileDropped.emit(path)


class RecentProjectItem(QFrame):
    """最近打开的项目条目"""

    clicked = pyqtSignal(str)  # 传递项目路径
    remove_clicked = pyqtSignal(str)  # 删除信号

    def __init__(self, name: str, path: str, parent=None) -> None:
        super().__init__(parent)
        self.path = path
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        # 移除固定高度，避免截断，让布局决定高度
        # self.setFixedHeight(48)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 12, 10, 12)  # 增加垂直间距
        layout.setSpacing(12)

        # 图标
        icon = IconWidget(FluentIcon.DOCUMENT, self)
        icon.setFixedSize(28, 28)
        icon.setStyleSheet(f"IconWidget {{ color: {themeColor().name()}; }}")
        layout.addWidget(icon)

        # 文字区域
        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)
        text_layout.setContentsMargins(0, 0, 0, 0)

        name_label = StrongBodyLabel(name, self)
        text_layout.addWidget(name_label)

        path_label = CaptionLabel(path, self)
        path_label.setTextColor(
            QColor(96, 96, 96), QColor(160, 160, 160)
        )  # 参考 ModelSelectorPage 的灰色
        text_layout.addWidget(path_label)

        layout.addLayout(text_layout)
        layout.addStretch()

        # 删除按钮
        self.remove_btn = TransparentToolButton(FluentIcon.CLOSE, self)
        self.remove_btn.setFixedSize(32, 32)
        self.remove_btn.clicked.connect(lambda: self.remove_clicked.emit(self.path))
        self.remove_btn.hide()  # 默认隐藏，hover 时显示
        layout.addWidget(self.remove_btn)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self.path)
        super().mousePressEvent(event)

    def enterEvent(self, event) -> None:
        bg_color = (
            "rgba(255, 255, 255, 0.05)" if isDarkTheme() else "rgba(0, 0, 0, 0.05)"
        )
        self.setStyleSheet(
            f"RecentProjectItem {{ background-color: {bg_color}; border-radius: 4px; }}"
        )
        self.remove_btn.show()

    def leaveEvent(self, event) -> None:
        self.setStyleSheet("")
        self.remove_btn.hide()



class ProjectInfoPanel(SimpleCardWidget):
    """项目详情面板"""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        # 信息行容器
        self.rows: dict[str, QLabel] = {}

    def set_info(self, info: dict) -> None:
        """设置项目信息"""
        # 清空现有内容
        layout = self.layout()
        while layout.count():
            item = layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self.rows.clear()

        # 添加信息行
        fields = [
            ("file_count", Localizer.get().workbench_info_file_count),
            ("created_at", Localizer.get().workbench_info_created_at),
            ("updated_at", Localizer.get().workbench_info_update),
        ]

        for key, label in fields:
            row = QFrame(self)
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(0, 0, 0, 0)

            label_widget = CaptionLabel(label, row)
            row_layout.addWidget(label_widget)

            # 格式化时间
            value = str(info.get(key, ""))
            if key in ["created_at", "updated_at"] and value:
                value = self._format_time(value)

            value_widget = BodyLabel(value, row)
            value_widget.setAlignment(Qt.AlignmentFlag.AlignRight)
            row_layout.addWidget(value_widget)

            self.rows[key] = value_widget
            layout.addWidget(row)

        # 添加进度条（如果有）
        if "progress" in info:
            layout.addStretch()

            progress_header = QFrame(self)
            progress_header_layout = QHBoxLayout(progress_header)
            progress_header_layout.setContentsMargins(0, 0, 0, 0)

            progress_label = CaptionLabel(
                Localizer.get().workbench_info_progress, progress_header
            )
            progress_header_layout.addWidget(progress_label)

            percent = int(info["progress"] * 100)
            percent_label = QLabel(f"{percent}%", progress_header)
            color = "#ffffff" if isDarkTheme() else "#000000"
            percent_label.setStyleSheet(
                f"font-size: 12px; font-weight: 600; color: {color};"
            )
            percent_label.setAlignment(Qt.AlignmentFlag.AlignRight)
            progress_header_layout.addWidget(percent_label)

            layout.addWidget(progress_header)

            # 进度条
            progress_bar = ProgressBar(self)
            progress_bar.setValue(percent)
            progress_bar.setFixedHeight(6)
            layout.addWidget(progress_bar)

            # 统计信息
            stats_frame = QFrame(self)
            stats_layout = QHBoxLayout(stats_frame)
            stats_layout.setContentsMargins(0, 4, 0, 0)

            translated = info.get("translated_items", 0)
            total = info.get("total_items", 0)

            left_stat = CaptionLabel(
                Localizer.get().workbench_info_translated.replace(
                    "{COUNT}", f"{translated:,}"
                ),
                stats_frame,
            )
            stats_layout.addWidget(left_stat)

            stats_layout.addStretch()

            right_stat = CaptionLabel(
                Localizer.get().workbench_info_total.replace("{COUNT}", f"{total:,}"),
                stats_frame,
            )
            stats_layout.addWidget(right_stat)

            layout.addWidget(stats_frame)

    def format_time(self, iso_time: str) -> str:
        """格式化 ISO 时间字符串为人性化格式"""
        try:
            dt = datetime.fromisoformat(iso_time)
            # 转换为本地时间（简单处理，假设不需要时区转换或已经是本地时间）
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            return iso_time


class EmptyRecentProjectState(QWidget):
    """最近项目列表为空时的占位显示"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.v_layout = QVBoxLayout(self)
        self.v_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.v_layout.setSpacing(16)
        self.v_layout.setContentsMargins(0, 60, 0, 60)

        self.icon_widget = IconWidget(FluentIcon.HISTORY, self)
        self.icon_widget.setFixedSize(64, 64)

        self.label = BodyLabel("暂无最近打开的工程", self)

        self.v_layout.addWidget(
            self.icon_widget, alignment=Qt.AlignmentFlag.AlignCenter
        )
        self.v_layout.addWidget(self.label, alignment=Qt.AlignmentFlag.AlignCenter)

        self._update_style()

    def _update_style(self):
        is_dark = isDarkTheme()
        icon_color = "rgba(255, 255, 255, 0.1)" if is_dark else "rgba(0, 0, 0, 0.1)"
        text_color = "rgba(255, 255, 255, 0.4)" if is_dark else "rgba(0, 0, 0, 0.4)"

        self.icon_widget.setStyleSheet(f"color: {icon_color};")
        self.label.setStyleSheet(f"color: {text_color}; font-size: 14px;")


class WorkbenchPage(ScrollArea, Base):
    """工作台页面"""

    def __init__(self, object_name: str, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName(object_name)
        self.setWidgetResizable(True)
        self.enableTransparentBackground()  # 启用透明背景

        # 选中状态
        self.selected_source_path: str | None = None  # 新建工程时选中的源文件/目录
        self.selected_lg_path: str | None = None  # 打开工程时选中的 .lg 文件

        # 主容器
        self.container = QWidget()
        self.container.setStyleSheet("background: transparent;")
        self.setWidget(self.container)

        main_layout = QHBoxLayout(self.container)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(24)

        # 左侧卡片：新建工程
        self.new_project_card = self.create_new_project_card()
        main_layout.addWidget(self.new_project_card)

        # 右侧卡片：打开工程
        self.open_project_card = self.create_open_project_card()
        main_layout.addWidget(self.open_project_card)

    def create_header(
        self, title_text: str, subtitle_text: str, color: str
    ) -> QHBoxLayout:
        """创建带有装饰条的统一标题头"""
        layout = QHBoxLayout()
        layout.setSpacing(12)
        layout.setContentsMargins(0, 0, 0, 0)

        # 装饰条
        bar = QFrame()
        bar.setFixedWidth(4)
        bar.setFixedHeight(34)  # 稍微加高以覆盖两行文字的视觉高度
        bar.setStyleSheet(f"background-color: {color}; border-radius: 2px;")
        layout.addWidget(bar)

        # 文字区域
        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)

        title = TitleLabel(title_text)
        font = title.font()
        font.setWeight(QFont.Weight.DemiBold)
        title.setFont(font)
        text_layout.addWidget(title)

        subtitle = CaptionLabel(subtitle_text)
        text_layout.addWidget(subtitle)

        layout.addLayout(text_layout)
        layout.addStretch()

        return layout

    def create_new_project_card(self) -> QWidget:
        """创建新建工程卡片"""
        card = SimpleCardWidget(self)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(20)

        # 标题区域
        header_widget = QWidget(card)
        header_layout = QVBoxLayout(header_widget)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.addLayout(
            self.create_header(
                Localizer.get().workbench_new_project_title,
                Localizer.get().workbench_new_project_subtitle,
                "#0078d4",
            )
        )

        layout.addWidget(header_widget)

        # 拖拽区域
        self.new_drop_zone = DropZone(
            FluentIcon.ADD, Localizer.get().workbench_drop_zone_source_title, "", card
        )
        self.new_drop_zone.clicked.connect(self.on_select_source)
        self.new_drop_zone.fileDropped.connect(self.on_source_dropped)
        layout.addWidget(self.new_drop_zone)

        # 特性区域
        features_frame = QFrame(card)
        features_layout = QVBoxLayout(features_frame)
        features_layout.setContentsMargins(0, 20, 0, 0)
        features_layout.setSpacing(10)

        features_title = StrongBodyLabel(
            Localizer.get().workbench_features_format_title, features_frame
        )
        features_layout.addWidget(features_title)

        features = [
            (
                Localizer.get().workbench_feature_format_support,
                Localizer.get().workbench_feature_format_support_desc,
            ),
            (
                Localizer.get().workbench_feature_private_rule,
                Localizer.get().workbench_feature_private_rule_desc,
            ),
            (
                Localizer.get().workbench_feature_offline_mode,
                Localizer.get().workbench_feature_offline_mode_desc,
            ),
            (
                Localizer.get().workbench_feature_zero_config,
                Localizer.get().workbench_feature_zero_config_desc,
            ),
        ]

        for title, desc in features:
            item = QFrame(features_frame)
            item_layout = QHBoxLayout(item)
            item_layout.setContentsMargins(0, 0, 0, 0)
            item_layout.setSpacing(8)

            check = IconWidget(FluentIcon.ACCEPT, item)
            check.setFixedSize(16, 16)
            check.setStyleSheet(
                f"IconWidget {{ color: {themeColor().name()}; }}"
            )  # 使用主题色
            item_layout.addWidget(check)

            text = BodyLabel(f"<b>{title}</b>：{desc}", item)
            item_layout.addWidget(text)
            item_layout.addStretch()

            features_layout.addWidget(item)

        layout.addWidget(features_frame)
        layout.addStretch()

        # 底部按钮容器
        btn_container = QWidget(card)
        btn_layout = QVBoxLayout(btn_container)
        btn_layout.setContentsMargins(0, 24, 0, 0)  # 增加顶部间距

        self.new_btn = PrimaryPushButton(
            Localizer.get().workbench_new_project_btn, card
        )
        self.new_btn.setFixedSize(160, 36)  # 固定宽度
        self.new_btn.setEnabled(False)
        self.new_btn.clicked.connect(self.on_create_project)
        btn_layout.addWidget(self.new_btn, alignment=Qt.AlignmentFlag.AlignCenter)

        layout.addWidget(btn_container)

        return card

    def create_open_project_card(self) -> QWidget:
        """创建打开工程卡片"""
        card = SimpleCardWidget(self)

        layout = QVBoxLayout(card)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(20)

        # 标题区域
        header_widget = QWidget(card)
        header_layout = QVBoxLayout(header_widget)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.addLayout(
            self.create_header(
                Localizer.get().workbench_open_project_title,
                Localizer.get().workbench_open_project_subtitle,
                "#5e45cd",  # 使用不同的强调色区分
            )
        )

        layout.addWidget(header_widget)

        # 拖拽区域（默认状态）/ 选中显示
        self.open_drop_zone = DropZone(
            FluentIcon.FOLDER, Localizer.get().workbench_drop_zone_lg_title, "", card
        )
        self.open_drop_zone.clicked.connect(self.on_select_lg)
        self.open_drop_zone.fileDropped.connect(self.on_lg_dropped)
        layout.addWidget(self.open_drop_zone)

        self.selected_file_display = None
        self.project_info_panel = None

        # 最近打开的项目列表
        self.recent_projects_container = QFrame(card)
        recent_layout = QVBoxLayout(self.recent_projects_container)
        recent_layout.setContentsMargins(0, 20, 0, 0)
        recent_layout.setSpacing(10)

        recent_title = StrongBodyLabel(
            Localizer.get().workbench_recent_projects_title,
            self.recent_projects_container,
        )
        recent_layout.addWidget(recent_title)

        self.recent_list_layout = QVBoxLayout()
        self.recent_list_layout.setSpacing(4)
        self.recent_list_layout.setContentsMargins(0, 0, 0, 0)
        recent_layout.addLayout(self.recent_list_layout)

        layout.addWidget(self.recent_projects_container)
        layout.addStretch()

        # 底部按钮区域
        btn_container = QWidget(card)
        btn_layout = QVBoxLayout(btn_container)
        btn_layout.setContentsMargins(0, 24, 0, 0)

        self.open_btn = PrimaryPushButton(
            Localizer.get().workbench_open_project_btn, card
        )
        self.open_btn.setFixedSize(160, 36)
        self.open_btn.setEnabled(False)
        self.open_btn.clicked.connect(self.on_open_project)
        btn_layout.addWidget(self.open_btn, alignment=Qt.AlignmentFlag.AlignCenter)

        layout.addWidget(btn_container)

        # 初始加载最近项目
        self.refresh_recent_list()

        return card

    def refresh_recent_list(self) -> None:
        """刷新最近打开列表"""
        # 清空现有列表
        while self.recent_list_layout.count():
            item = self.recent_list_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        # 加载最近项目
        config = Config().load()

        valid_items_count = 0
        for project in config.recent_projects:
            path = project.get("path")
            name = project.get("name")

            if not path:
                continue

            item = RecentProjectItem(name, path, self.recent_projects_container)
            item.clicked.connect(self.on_recent_clicked)
            item.remove_clicked.connect(self.on_remove_recent_project)
            self.recent_list_layout.addWidget(item)
            valid_items_count += 1

        # 如果没有有效项目（包含列表为空或所有文件都不存在的情况），显示空状态
        if valid_items_count == 0:
            self.recent_list_layout.addWidget(EmptyRecentProjectState(self))

    def on_remove_recent_project(self, path: str) -> None:
        """移除最近打开的项目"""
        config = Config().load()
        config.remove_recent_project(path)
        config.save()
        self.refresh_recent_list()

    def on_select_source(self) -> None:
        """点击选择源文件/目录"""
        path = QFileDialog.getExistingDirectory(
            self, Localizer.get().workbench_select_source_dir_title
        )
        if path:
            self.on_source_dropped(path)

    def on_source_dropped(self, path: str) -> None:
        """源文件/目录拖入"""
        if not os.path.exists(path):
            return

        # 检查是否包含支持的文件
        store = ProjectStore()
        source_files = store._collect_source_files(path)

        if not source_files:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().workbench_toast_no_valid_file,
                },
            )
            # 重置状态
            self.selected_source_path = None
            self.new_btn.setEnabled(False)
            self.new_drop_zone.set_icon(FluentIcon.ADD)
            self.new_drop_zone.set_text(
                Localizer.get().workbench_drop_zone_source_title, ""
            )
            return

        self.selected_source_path = path

        # 更新 UI
        file_name = Path(path).name
        count = len(source_files)
        # 限制显示数量，避免数字过大
        count_str = f"{count}" if count < 1000 else "999+"

        self.new_drop_zone.set_icon(FluentIcon.FOLDER)
        self.new_drop_zone.set_text(
            file_name,
            Localizer.get().workbench_drop_ready_source.replace("{COUNT}", count_str),
        )
        self.new_btn.setEnabled(True)

    def on_select_lg(self) -> None:
        """点击选择 .lg 文件"""
        path, _ = QFileDialog.getOpenFileName(
            self,
            Localizer.get().workbench_select_project_title,
            "",
            "LinguaGacha 工程 (*.lg)",
        )
        if path:
            self.on_lg_dropped(path)

    def on_lg_dropped(self, path: str) -> None:
        """lg 文件拖入"""
        if not path.endswith(".lg"):
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().workbench_toast_invalid_lg,
                },
            )
            return

        if not os.path.exists(path):
            # 文件不存在，提示移除
            box = MessageBox(
                Localizer.get().workbench_msg_file_not_found_title,
                Localizer.get().workbench_msg_file_not_found_content.replace(
                    "{PATH}", path
                ),
                self,
            )
            if box.exec():
                config = Config().load()
                config.remove_recent_project(path)
                config.save()
                self.refresh_recent_list()
            return

        self.selected_lg_path = path
        self.open_btn.setEnabled(True)

        # 隐藏拖拽区域，显示选中状态
        self.open_drop_zone.setVisible(False)
        # 隐藏特性区域
        self.recent_projects_container.setVisible(False)

        # 清除旧的选中显示（如果存在）
        if self.selected_file_display:
            self.selected_file_display.deleteLater()
            self.project_info_panel.deleteLater()

        # 显示选中的文件
        file_name = Path(path).name
        self.selected_file_display = SelectedFileDisplay(
            file_name, True, self.open_project_card
        )
        self.selected_file_display.clicked.connect(self.on_select_lg)
        self.selected_file_display.fileDropped.connect(self.on_lg_dropped)
        self.open_project_card.layout().insertWidget(
            1, self.selected_file_display
        )  # 插入到 drop_zone 位置 (index 1 after header)

        # 显示项目详情
        try:
            info = ProjectStore.get_project_preview(path)
            self.project_info_panel = ProjectInfoPanel(self.open_project_card)
            self.project_info_panel.set_info(info)
            self.open_project_card.layout().insertWidget(
                2, self.project_info_panel
            )  # 插入到 selected_file_display 下方
        except Exception as e:
            self.error(f"读取工程预览失败: {e}")

    def on_recent_clicked(self, path: str) -> None:
        """点击最近打开的项目"""
        self.on_lg_dropped(path)

    def on_cancel_selection(self) -> None:
        """取消选择（保留用于内部重置，虽然按钮已隐藏）"""
        self.selected_lg_path = None
        self.open_btn.setEnabled(False)

        # 移除选中显示
        if self.selected_file_display:
            self.selected_file_display.deleteLater()
            self.selected_file_display = None

        if self.project_info_panel:
            self.project_info_panel.deleteLater()
            self.project_info_panel = None

        # 显示拖拽区域和特性
        self.open_drop_zone.setVisible(True)
        self.recent_projects_container.setVisible(True)

    def on_create_project(self) -> None:
        """创建工程"""
        if not self.selected_source_path:
            return

        # 弹出另存为对话框
        default_name = Path(self.selected_source_path).name + ".lg"
        path, _ = QFileDialog.getSaveFileName(
            self,
            Localizer.get().workbench_save_project_title,
            default_name,
            "LinguaGacha 工程 (*.lg)",
        )

        if not path:
            return

        if not path.endswith(".lg"):
            path += ".lg"

        try:
            # 显示进度 Toast
            self.emit(
                Base.Event.PROGRESS_TOAST_SHOW,
                {
                    "message": Localizer.get().workbench_progress_creating,
                    "indeterminate": True,
                },
            )

            # 创建工程
            store = ProjectStore()
            db = store.create(self.selected_source_path, path)

            # 更新最近打开列表
            config = Config().load()
            config.add_recent_project(path, db.get_meta("name", ""))
            config.save()

            # 加载工程
            StorageContext.get().load(path)

            self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().workbench_toast_create_success.replace(
                        "{NAME}", Path(path).name
                    ),
                },
            )

            # 重置选中状态
            self.selected_source_path = None
            self.new_btn.setEnabled(False)
            self.new_drop_zone.set_icon(FluentIcon.ADD)
            self.new_drop_zone.set_text(
                Localizer.get().workbench_drop_zone_source_title, ""
            )

        except Exception as e:
            self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().workbench_toast_create_fail.replace(
                        "{ERROR}", str(e)
                    ),
                },
            )

    def on_open_project(self) -> None:
        """打开工程"""
        if not self.selected_lg_path:
            return

        try:
            # 加载工程
            StorageContext.get().load(self.selected_lg_path)

            # 更新最近打开列表
            config = Config().load()
            name = Path(self.selected_lg_path).stem
            config.add_recent_project(self.selected_lg_path, name)
            config.save()

            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().workbench_toast_load_success.replace(
                        "{NAME}", name
                    ),
                },
            )

        except Exception as e:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().workbench_toast_load_fail.replace(
                        "{ERROR}", str(e)
                    ),
                },
            )
