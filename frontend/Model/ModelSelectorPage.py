import threading

import anthropic
import openai
from google import genai
from PyQt5.QtCore import QSize
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QAbstractItemView
from PyQt5.QtWidgets import QListWidgetItem
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FluentWindow
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import ListWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SearchLineEdit
from qfluentwidgets import SubtitleLabel

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.Separator import Separator

class ModelSelectorPage(MessageBoxBase, Base):

    # 模型加载完成信号
    models_loaded = pyqtSignal(list)

    # 列表区域固定高度
    LIST_HEIGHT = 392

    def __init__(self, model_id: str, window: FluentWindow) -> None:
        super().__init__(window)

        # 初始化数据
        self.model_id: str = model_id
        self.available_models: list[str] = []

        # 连接信号
        self.models_loaded.connect(self.on_models_loaded)

        # 初始化界面
        self.init_ui()

        # 延迟加载模型列表，让 UI 先渲染
        QTimer.singleShot(50, self.start_loading)

    def init_ui(self) -> None:
        """初始化界面控件"""
        # 设置框体
        self.widget.setFixedSize(560, 640)
        self.yesButton.setText(Localizer.get().close)
        self.cancelButton.hide()

        # 设置主布局（MessageBoxBase 自带卡片容器，直接使用 viewLayout）
        self.viewLayout.setContentsMargins(16, 16, 16, 16)
        self.viewLayout.setSpacing(12)

        # 标题
        self.title_label = SubtitleLabel(Localizer.get().model_selector_page_title, self)
        self.viewLayout.addWidget(self.title_label)

        # 描述
        self.description_label = CaptionLabel(Localizer.get().model_selector_page_content, self)
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.viewLayout.addWidget(self.description_label)

        # 分割线
        self.viewLayout.addWidget(Separator(self))

        # 搜索框
        self.search_edit = SearchLineEdit(self)
        self.search_edit.setPlaceholderText(Localizer.get().filter)
        self.search_edit.setClearButtonEnabled(True)
        self.search_edit.textChanged.connect(self.on_filter_changed)
        self.viewLayout.addWidget(self.search_edit)

        # 加载指示器容器
        self.loading_container = QWidget(self)
        self.loading_container.setFixedHeight(__class__.LIST_HEIGHT)
        loading_layout = QVBoxLayout(self.loading_container)
        loading_layout.setContentsMargins(0, 0, 0, 0)
        loading_layout.setAlignment(Qt.AlignCenter)

        self.loading_ring = IndeterminateProgressRing(self.loading_container)
        self.loading_ring.setFixedSize(48, 48)
        loading_layout.addWidget(self.loading_ring, 0, Qt.AlignCenter)

        self.loading_label = CaptionLabel(Localizer.get().model_selector_page_loading, self.loading_container)
        self.loading_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        loading_layout.addWidget(self.loading_label, 0, Qt.AlignCenter)

        self.viewLayout.addWidget(self.loading_container)

        # 模型列表（初始隐藏）
        self.model_list = ListWidget(self)
        self.model_list.setStyleSheet("""
            ListWidget {
                background: transparent;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 6px;
                outline: none;
            }
        """)
        self.model_list.setFixedHeight(__class__.LIST_HEIGHT)
        self.model_list.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self.model_list.itemClicked.connect(self.on_item_clicked)
        self.model_list.hide()
        self.viewLayout.addWidget(self.model_list)

        # 延迟加载模型列表，让 UI 先渲染
        QTimer.singleShot(50, self.start_loading)

    def start_loading(self) -> None:
        """在后台线程中加载模型列表"""
        model_data: dict = Config().load().get_model(self.model_id)
        api_key = model_data.get("api_key", "")

        # 兼容旧格式（列表）
        if isinstance(api_key, list):
            api_key = api_key[0] if api_key else ""
        # 新格式可能是换行分隔的多个key，取第一个
        elif isinstance(api_key, str) and "\n" in api_key:
            api_key = api_key.split("\n")[0].strip()

        api_url = model_data.get("api_url", "")
        api_format = model_data.get("api_format", "")

        # 在后台线程中执行网络请求
        def fetch_models() -> None:
            models = self.get_models(api_url, api_key, api_format)
            # 通过信号通知主线程
            self.models_loaded.emit(models)

        thread = threading.Thread(target=fetch_models, daemon=True)
        thread.start()

    def on_models_loaded(self, models: list[str]) -> None:
        """模型加载完成后更新 UI（主线程）"""
        self.available_models = models

        # 隐藏加载指示器，显示列表
        self.loading_container.hide()
        self.model_list.show()

        # 刷新列表显示
        self.refresh_list()

    def get_models(self, api_url: str, api_key: str, api_format: str) -> list[str]:
        """从 API 获取可用模型列表"""
        result = []

        try:
            if api_format == Base.APIFormat.GOOGLE:
                client = genai.Client(
                    api_key=api_key,
                )
                return [model.name for model in client.models.list()]
            elif api_format == Base.APIFormat.ANTHROPIC:
                client = anthropic.Anthropic(
                    api_key=api_key,
                    base_url=api_url,
                )
                return [model.id for model in client.models.list()]
            else:
                client = openai.OpenAI(
                    base_url=api_url,
                    api_key=api_key,
                )
                return [model.id for model in client.models.list()]
        except Exception as e:
            self.debug(Localizer.get().model_selector_page_fail, e)
            self.emit(Base.Event.TOAST, {
                "type": Base.ToastType.WARNING,
                "message": Localizer.get().model_selector_page_fail,
            })

        return result

    def refresh_list(self) -> None:
        """根据当前筛选条件刷新列表"""
        self.model_list.clear()

        filter_text = self.search_edit.text().strip().lower()

        for model_name in self.available_models:
            # 实时筛选：只显示匹配的模型
            if filter_text and filter_text not in model_name.lower():
                continue

            item = QListWidgetItem(model_name)
            item.setSizeHint(QSize(0, 36))
            self.model_list.addItem(item)

    def on_filter_changed(self, text: str) -> None:
        """搜索框文本变化时实时筛选"""
        self.refresh_list()

    def on_item_clicked(self, item: QListWidgetItem) -> None:
        """点击列表项选择模型"""
        config = Config().load()
        model = config.get_model(self.model_id)
        model["model_id"] = item.text().strip()
        config.set_model(model)
        config.save()

        # 关闭窗口
        self.close()
