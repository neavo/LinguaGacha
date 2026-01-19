"""工作台页面

提供"新建工程"和"打开工程"两个入口，是用户进入翻译工作流的首页。
"""

import os
from pathlib import Path

from PyQt5.QtCore import Qt
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QDragEnterEvent
from PyQt5.QtGui import QDropEvent
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QFrame
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLabel
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CardWidget
from qfluentwidgets import FluentIcon
from qfluentwidgets import IconWidget
from qfluentwidgets import MessageBox
from qfluentwidgets import PrimaryPushButton
from qfluentwidgets import PushButton
from qfluentwidgets import ScrollArea
from qfluentwidgets import StrongBodyLabel
from qfluentwidgets import TitleLabel

from base.Base import Base
from module.AppConfig import AppConfig
from module.ProjectCreator import ProjectCreator
from module.ProjectCreator import ProjectLoader
from module.SessionContext import SessionContext

class DropZone(CardWidget):
    """拖拽区域组件"""

    fileDropped = pyqtSignal(str)  # 文件/目录拖入信号
    clicked = pyqtSignal()  # 点击信号

    def __init__(self, icon: FluentIcon, title: str, subtitle: str, parent=None) -> None:
        super().__init__(parent)
        self.setAcceptDrops(True)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(180)

        # 布局
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(8)

        # 图标
        self.icon_widget = IconWidget(icon, self)
        self.icon_widget.setFixedSize(48, 48)
        layout.addWidget(self.icon_widget, alignment=Qt.AlignmentFlag.AlignCenter)

        # 标题
        self.title_label = StrongBodyLabel(title, self)
        layout.addWidget(self.title_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 副标题
        self.subtitle_label = QLabel(subtitle, self)
        self.subtitle_label.setStyleSheet("color: #888888; font-size: 12px;")
        layout.addWidget(self.subtitle_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 样式
        self.setStyleSheet("""
            DropZone {
                border: 2px dashed #e0e0e0;
                border-radius: 8px;
                background-color: #fdfdfd;
            }
            DropZone:hover {
                border-color: #0078d4;
                background-color: #f0f7ff;
            }
        """)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)

    def dragEnterEvent(self, event: QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event: QDropEvent) -> None:
        urls = event.mimeData().urls()
        if urls:
            path = urls[0].toLocalFile()
            self.fileDropped.emit(path)


class SelectedFileDisplay(CardWidget):
    """已选文件显示组件"""

    cancelClicked = pyqtSignal()

    def __init__(self, file_name: str, is_ready: bool = True, parent=None) -> None:
        super().__init__(parent)
        self.setFixedHeight(180)

        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.setSpacing(8)

        # 文件图标（使用 emoji）
        icon_label = QLabel("📦", self)
        icon_label.setStyleSheet("font-size: 28px;")
        layout.addWidget(icon_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 文件名
        name_label = StrongBodyLabel(file_name, self)
        name_label.setStyleSheet("color: #0078d4;")
        layout.addWidget(name_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 状态
        status_text = "项目已就绪" if is_ready else "准备中..."
        status_label = QLabel(status_text, self)
        status_label.setStyleSheet("color: #888888; font-size: 12px;")
        layout.addWidget(status_label, alignment=Qt.AlignmentFlag.AlignCenter)

        # 样式
        self.setStyleSheet("""
            SelectedFileDisplay {
                border: 2px solid #0078d4;
                border-radius: 8px;
                background-color: #f0f7ff;
            }
        """)


class RecentProjectItem(QFrame):
    """最近打开的项目条目"""

    clicked = pyqtSignal(str)  # 传递项目路径

    def __init__(self, name: str, path: str, parent=None) -> None:
        super().__init__(parent)
        self.path = path
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(48)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 8, 10, 8)
        layout.setSpacing(12)

        # 图标
        icon_label = QLabel("LG", self)
        icon_label.setFixedSize(28, 28)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        icon_label.setStyleSheet("""
            background: #e0e0e0;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
            color: #666;
        """)
        layout.addWidget(icon_label)

        # 文字区域
        text_layout = QVBoxLayout()
        text_layout.setSpacing(2)
        text_layout.setContentsMargins(0, 0, 0, 0)

        name_label = QLabel(name, self)
        name_label.setStyleSheet("font-size: 13px; font-weight: 500;")
        text_layout.addWidget(name_label)

        path_label = QLabel(str(Path(path).parent), self)
        path_label.setStyleSheet("font-size: 11px; color: #888888;")
        text_layout.addWidget(path_label)

        layout.addLayout(text_layout)
        layout.addStretch()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self.path)
        super().mousePressEvent(event)

    def enterEvent(self, event) -> None:
        self.setStyleSheet("background-color: #f5f5f5; border-radius: 4px;")

    def leaveEvent(self, event) -> None:
        self.setStyleSheet("")


class ProjectInfoPanel(CardWidget):
    """项目详情面板"""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(12)

        # 信息行容器
        self.rows: dict[str, QLabel] = {}

        self.setStyleSheet("""
            ProjectInfoPanel {
                background-color: #f8f9fa;
                border-radius: 6px;
            }
        """)

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
            ("source_language", "原文语言"),
            ("target_language", "译文语言"),
            ("model_name", "翻译引擎"),
            ("updated_at", "最后修改"),
        ]

        for key, label in fields:
            row = QFrame(self)
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(0, 0, 0, 0)

            label_widget = QLabel(label, row)
            label_widget.setStyleSheet("color: #888888; font-size: 13px;")
            row_layout.addWidget(label_widget)

            value_widget = QLabel(str(info.get(key, "")), row)
            value_widget.setStyleSheet("font-size: 13px; font-weight: 500;")
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

            progress_label = QLabel("翻译进度", progress_header)
            progress_label.setStyleSheet("font-size: 12px; color: #666;")
            progress_header_layout.addWidget(progress_label)

            percent = int(info["progress"] * 100)
            percent_label = QLabel(f"{percent}%", progress_header)
            percent_label.setStyleSheet("font-size: 12px; font-weight: 600; color: #0078d4;")
            percent_label.setAlignment(Qt.AlignmentFlag.AlignRight)
            progress_header_layout.addWidget(percent_label)

            layout.addWidget(progress_header)

            # 进度条
            progress_bar = QFrame(self)
            progress_bar.setFixedHeight(6)
            progress_bar.setStyleSheet("""
                background-color: #e0e0e0;
                border-radius: 3px;
            """)
            layout.addWidget(progress_bar)

            # 进度填充
            fill_width = int(percent)
            progress_bar.setStyleSheet(f"""
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #0078d4, stop:{fill_width/100} #0078d4,
                    stop:{fill_width/100 + 0.001} #e0e0e0, stop:1 #e0e0e0);
                border-radius: 3px;
            """)

            # 统计信息
            stats_frame = QFrame(self)
            stats_layout = QHBoxLayout(stats_frame)
            stats_layout.setContentsMargins(0, 4, 0, 0)

            translated = info.get("translated_items", 0)
            total = info.get("total_items", 0)

            left_stat = QLabel(f"已翻译: {translated:,} 行", stats_frame)
            left_stat.setStyleSheet("font-size: 11px; color: #888;")
            stats_layout.addWidget(left_stat)

            stats_layout.addStretch()

            right_stat = QLabel(f"总计: {total:,} 行", stats_frame)
            right_stat.setStyleSheet("font-size: 11px; color: #888;")
            stats_layout.addWidget(right_stat)

            layout.addWidget(stats_frame)


class WorkbenchPage(ScrollArea, Base):
    """工作台页面"""

    def __init__(self, object_name: str, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName(object_name)
        self.setWidgetResizable(True)
        self.enableTransparentBackground()  # 启用透明背景

        # 选中状态
        self._selected_source_path: str | None = None  # 新建工程时选中的源文件/目录
        self._selected_lg_path: str | None = None  # 打开工程时选中的 .lg 文件

        # 主容器
        self.container = QWidget()
        self.container.setStyleSheet("background: transparent;")
        self.setWidget(self.container)

        main_layout = QHBoxLayout(self.container)
        main_layout.setContentsMargins(24, 24, 24, 24)
        main_layout.setSpacing(24)

        # 左侧卡片：新建工程
        self.new_project_card = self._create_new_project_card()
        main_layout.addWidget(self.new_project_card)

        # 右侧卡片：打开工程
        self.open_project_card = self._create_open_project_card()
        main_layout.addWidget(self.open_project_card)

    def _create_new_project_card(self) -> QWidget:
        """创建新建工程卡片"""
        card = QWidget(self)
        card.setStyleSheet("background: transparent;")

        layout = QVBoxLayout(card)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(20)

        # 标题区域
        header = QWidget(card)
        header_layout = QVBoxLayout(header)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.setSpacing(8)

        title_row = QHBoxLayout()
        title = TitleLabel("新建工程", header)
        title_row.addWidget(title)

        tag = QLabel("New", header)
        tag.setStyleSheet("""
            background: #eee;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            color: #666;
        """)
        title_row.addWidget(tag)
        title_row.addStretch()
        header_layout.addLayout(title_row)

        subtitle = QLabel("创建新的 .lg 翻译项目，支持脱机运行。", header)
        subtitle.setStyleSheet("color: #666666; font-size: 14px;")
        header_layout.addWidget(subtitle)

        layout.addWidget(header)

        # 拖拽区域
        self.new_drop_zone = DropZone(
            FluentIcon.ADD, "点击或拖拽源文件", "自动识别目录结构与资产", card
        )
        self.new_drop_zone.clicked.connect(self._on_select_source)
        self.new_drop_zone.fileDropped.connect(self._on_source_dropped)
        layout.addWidget(self.new_drop_zone)

        # 特性区域
        features_frame = QFrame(card)
        features_layout = QVBoxLayout(features_frame)
        features_layout.setContentsMargins(0, 20, 0, 0)
        features_layout.setSpacing(10)

        features_title = QLabel("特性与格式", features_frame)
        features_title.setStyleSheet(
            "font-size: 12px; font-weight: 700; color: #888; text-transform: uppercase;"
        )
        features_layout.addWidget(features_title)

        features = [
            ("格式支持", "txt, md, json, xlsx, epub, ass"),
            ("私有规则", "术语表与替换规则内嵌于工程"),
            ("脱机模式", "创建后原始文件可安全移除"),
            ("零配置", "自动递归扫描目录并建立索引"),
        ]

        for title, desc in features:
            item = QFrame(features_frame)
            item_layout = QHBoxLayout(item)
            item_layout.setContentsMargins(0, 0, 0, 0)
            item_layout.setSpacing(8)

            check = QLabel("✓", item)
            check.setStyleSheet("color: #0078d4; font-weight: bold;")
            item_layout.addWidget(check)

            text = QLabel(f"<b>{title}</b>：{desc}", item)
            text.setStyleSheet("font-size: 13px; color: #666;")
            item_layout.addWidget(text)
            item_layout.addStretch()

            features_layout.addWidget(item)

        layout.addWidget(features_frame)
        layout.addStretch()

        # 底部按钮
        self.new_btn = PrimaryPushButton("立即创建", card)
        self.new_btn.setFixedHeight(36)
        self.new_btn.setEnabled(False)
        self.new_btn.clicked.connect(self._on_create_project)
        layout.addWidget(self.new_btn, alignment=Qt.AlignmentFlag.AlignRight)

        return card

    def _create_open_project_card(self) -> QWidget:
        """创建打开工程卡片"""
        card = QWidget(self)
        card.setStyleSheet("background: transparent;")

        layout = QVBoxLayout(card)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(20)

        # 标题区域
        header = QWidget(card)
        header_layout = QVBoxLayout(header)
        header_layout.setContentsMargins(0, 0, 0, 0)
        header_layout.setSpacing(8)

        title = TitleLabel("打开工程", header)
        header_layout.addWidget(title)

        subtitle = QLabel("加载现有的 .lg 工程文件以继续工作。", header)
        subtitle.setStyleSheet("color: #666666; font-size: 14px;")
        header_layout.addWidget(subtitle)

        layout.addWidget(header)

        # 拖拽区域（默认状态）/ 选中显示
        self.open_drop_zone = DropZone(
            FluentIcon.FOLDER, "点击或拖拽 .lg 文件", "加载翻译记忆与进度", card
        )
        self.open_drop_zone.clicked.connect(self._on_select_lg)
        self.open_drop_zone.fileDropped.connect(self._on_lg_dropped)
        layout.addWidget(self.open_drop_zone)

        self.selected_file_display = None
        self.project_info_panel = None

        # 特性区域（与左侧对称）
        features_frame = QFrame(card)
        features_layout = QVBoxLayout(features_frame)
        features_layout.setContentsMargins(0, 20, 0, 0)
        features_layout.setSpacing(10)

        features_title = QLabel("工程特性", features_frame)
        features_title.setStyleSheet(
            "font-size: 12px; font-weight: 700; color: #888; text-transform: uppercase;"
        )
        features_layout.addWidget(features_title)

        features = [
            ("进度保留", "翻译状态实时存储，随时继续"),
            ("校对支持", "内置双语对照校对界面"),
            ("导出灵活", "支持多种格式和批量操作"),
            ("版本安全", "工程文件独立，不修改原文件"),
        ]

        for title_text, desc in features:
            item = QFrame(features_frame)
            item_layout = QHBoxLayout(item)
            item_layout.setContentsMargins(0, 0, 0, 0)
            item_layout.setSpacing(8)

            check = QLabel("✓", item)
            check.setStyleSheet("color: #0078d4; font-weight: bold;")
            item_layout.addWidget(check)

            text = QLabel(f"<b>{title_text}</b>：{desc}", item)
            text.setStyleSheet("font-size: 13px; color: #666;")
            item_layout.addWidget(text)
            item_layout.addStretch()

            features_layout.addWidget(item)

        layout.addWidget(features_frame)
        layout.addStretch()

        # 底部按钮
        self.open_btn = PrimaryPushButton("打开工程", card)
        self.open_btn.setFixedHeight(36)
        self.open_btn.setEnabled(False)
        self.open_btn.clicked.connect(self._on_open_project)
        layout.addWidget(self.open_btn, alignment=Qt.AlignmentFlag.AlignRight)

        # 取消选择按钮（隐藏，在选中时显示）
        self.cancel_btn = PushButton("取消选择", card)
        self.cancel_btn.setVisible(False)
        self.cancel_btn.clicked.connect(self._on_cancel_selection)

        return card

    def _refresh_recent_list(self) -> None:
        """刷新最近打开列表（当前版本不显示）"""
        pass

    def _on_select_source(self) -> None:
        """点击选择源文件/目录"""
        path = QFileDialog.getExistingDirectory(self, "选择源文件目录")
        if path:
            self._on_source_dropped(path)

    def _on_source_dropped(self, path: str) -> None:
        """源文件/目录拖入"""
        if not os.path.exists(path):
            return

        self._selected_source_path = path
        self.new_btn.setEnabled(True)

        # TODO: 更新 UI 显示选中状态

    def _on_select_lg(self) -> None:
        """点击选择 .lg 文件"""
        path, _ = QFileDialog.getOpenFileName(
            self, "选择工程文件", "", "LinguaGacha 工程 (*.lg)"
        )
        if path:
            self._on_lg_dropped(path)

    def _on_lg_dropped(self, path: str) -> None:
        """lg 文件拖入"""
        if not path.endswith(".lg"):
            self.emit(
                Base.Event.TOAST,
                {"type": Base.ToastType.WARNING, "message": "请选择 .lg 工程文件"},
            )
            return

        if not os.path.exists(path):
            # 文件不存在，提示移除
            box = MessageBox("文件不存在", f"工程文件已被移动或删除：\n{path}\n\n是否从最近打开列表中移除？", self)
            if box.exec():
                config = AppConfig().load()
                config.remove_recent_project(path)
                config.save()
                self._refresh_recent_list()
            return

        self._selected_lg_path = path
        self.open_btn.setEnabled(True)
        self.cancel_btn.setVisible(True)

        # 隐藏拖拽区域，显示选中状态
        self.open_drop_zone.setVisible(False)

        # 显示选中的文件
        file_name = Path(path).name
        self.selected_file_display = SelectedFileDisplay(file_name, True, self.open_project_card)
        self.open_project_card.layout().insertWidget(2, self.selected_file_display)

        # 显示项目详情
        try:
            info = ProjectLoader.get_project_preview(path)
            self.project_info_panel = ProjectInfoPanel(self.open_project_card)
            self.project_info_panel.set_info(info)
            self.open_project_card.layout().insertWidget(3, self.project_info_panel)
        except Exception as e:
            self.error(f"读取工程预览失败: {e}")

    def _on_recent_clicked(self, path: str) -> None:
        """点击最近打开的项目"""
        self._on_lg_dropped(path)

    def _on_cancel_selection(self) -> None:
        """取消选择"""
        self._selected_lg_path = None
        self.open_btn.setEnabled(False)
        self.cancel_btn.setVisible(False)

        # 移除选中显示
        if self.selected_file_display:
            self.selected_file_display.deleteLater()
            self.selected_file_display = None

        if self.project_info_panel:
            self.project_info_panel.deleteLater()
            self.project_info_panel = None

        # 显示拖拽区域
        self.open_drop_zone.setVisible(True)

    def _on_create_project(self) -> None:
        """创建工程"""
        if not self._selected_source_path:
            return

        # 弹出另存为对话框
        default_name = Path(self._selected_source_path).name + ".lg"
        path, _ = QFileDialog.getSaveFileName(
            self, "保存工程文件", default_name, "LinguaGacha 工程 (*.lg)"
        )

        if not path:
            return

        if not path.endswith(".lg"):
            path += ".lg"

        try:
            # 显示进度 Toast
            self.emit(Base.Event.PROGRESS_TOAST_SHOW, {
                "message": "正在创建工程...",
                "indeterminate": True,
            })

            # 创建工程
            creator = ProjectCreator()
            db = creator.create(self._selected_source_path, path)

            # 更新最近打开列表
            config = AppConfig().load()
            config.add_recent_project(path, db.get_meta("name", ""))
            config.save()

            # 加载工程
            SessionContext.get().load(path)

            self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
            self.emit(
                Base.Event.TOAST,
                {"type": Base.ToastType.SUCCESS, "message": f"工程创建成功：{Path(path).name}"},
            )

            # 重置选中状态
            self._selected_source_path = None
            self.new_btn.setEnabled(False)

        except Exception as e:
            self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
            self.emit(
                Base.Event.TOAST,
                {"type": Base.ToastType.ERROR, "message": f"创建工程失败：{e}"},
            )

    def _on_open_project(self) -> None:
        """打开工程"""
        if not self._selected_lg_path:
            return

        try:
            # 加载工程
            SessionContext.get().load(self._selected_lg_path)

            # 更新最近打开列表
            config = AppConfig().load()
            name = Path(self._selected_lg_path).stem
            config.add_recent_project(self._selected_lg_path, name)
            config.save()

            self.emit(
                Base.Event.TOAST,
                {"type": Base.ToastType.SUCCESS, "message": f"工程已加载：{name}"},
            )

        except Exception as e:
            self.emit(
                Base.Event.TOAST,
                {"type": Base.ToastType.ERROR, "message": f"加载工程失败：{e}"},
            )
