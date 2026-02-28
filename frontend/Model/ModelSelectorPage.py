import threading

import anthropic
import openai
from google import genai
from google.genai import types
from PySide6.QtCore import QSize
from PySide6.QtCore import Qt
from PySide6.QtCore import QTimer
from PySide6.QtCore import Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import QAbstractItemView
from PySide6.QtWidgets import QListWidgetItem
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FluentWindow
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import ListWidget
from qfluentwidgets import MessageBoxBase
from qfluentwidgets import SubtitleLabel

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.CustomLineEdit import CustomSearchLineEdit
from widget.Separator import Separator


class ModelSelectorPage(Base, MessageBoxBase):
    # 模型加载完成信号
    models_loaded = Signal(list)

    # 列表区域固定高度
    LIST_HEIGHT = 392

    # 使用浏览器 UA，避免部分接入点拦截 SDK 默认 UA 的模型列表请求
    BROWSER_USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    )

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
        self.title_label = SubtitleLabel(
            Localizer.get().model_selector_page_title, self
        )
        self.viewLayout.addWidget(self.title_label)

        # 描述
        self.description_label = CaptionLabel(
            Localizer.get().model_selector_page_content, self
        )
        self.description_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.viewLayout.addWidget(self.description_label)

        # 分割线
        self.viewLayout.addWidget(Separator(self))

        # 搜索框
        self.search_edit = CustomSearchLineEdit(self)
        self.search_edit.setPlaceholderText(Localizer.get().filter)
        self.search_edit.setClearButtonEnabled(True)
        self.search_edit.textChanged.connect(self.on_filter_changed)
        self.viewLayout.addWidget(self.search_edit)

        # 加载指示器容器
        self.loading_container = QWidget(self)
        self.loading_container.setFixedHeight(__class__.LIST_HEIGHT)
        loading_layout = QVBoxLayout(self.loading_container)
        loading_layout.setContentsMargins(0, 0, 0, 0)
        loading_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.loading_ring = IndeterminateProgressRing(self.loading_container)
        self.loading_ring.setFixedSize(48, 48)
        loading_layout.addWidget(self.loading_ring, 0, Qt.AlignmentFlag.AlignCenter)

        self.loading_label = CaptionLabel(
            Localizer.get().model_selector_page_loading, self.loading_container
        )
        self.loading_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        loading_layout.addWidget(self.loading_label, 0, Qt.AlignmentFlag.AlignCenter)

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

    def start_loading(self) -> None:
        """在后台线程中加载模型列表"""
        model_data: dict = Config().load().get_model(self.model_id)
        api_key = model_data.get("api_key", "").split("\n")[0].strip()  # 取第一个key
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

    @classmethod
    def get_browser_headers(cls) -> dict[str, str]:
        """返回浏览器风格请求头，降低网关误判 SDK 请求的概率。"""
        return {"User-Agent": cls.BROWSER_USER_AGENT}

    def get_models(self, api_url: str, api_key: str, api_format: str) -> list[str]:
        """从 API 获取可用模型列表"""
        result = []

        try:
            if api_format == Base.APIFormat.GOOGLE:
                normalized_url: str = api_url.strip().removesuffix("/")
                api_version: str | None = None
                if normalized_url.endswith("/v1beta"):
                    # 兼容 URL 里指定版本，避免 SDK 拼接重复版本
                    api_version = "v1beta"
                    normalized_url = normalized_url.removesuffix("/v1beta")
                elif normalized_url.endswith("/v1"):
                    # 兼容 URL 里指定版本，避免 SDK 拼接重复版本
                    api_version = "v1"
                    normalized_url = normalized_url.removesuffix("/v1")

                headers: dict[str, str] = self.get_browser_headers()
                if normalized_url or api_version:
                    http_options = types.HttpOptions(
                        base_url=normalized_url if normalized_url else None,
                        api_version=api_version,
                        headers=headers,
                    )
                else:
                    http_options = types.HttpOptions(headers=headers)

                client = genai.Client(api_key=api_key, http_options=http_options)
                return [model.name for model in client.models.list()]
            elif api_format == Base.APIFormat.ANTHROPIC:
                client = anthropic.Anthropic(
                    api_key=api_key,
                    base_url=api_url,
                    default_headers=self.get_browser_headers(),
                )
                return [model.id for model in client.models.list()]
            else:
                client = openai.OpenAI(
                    base_url=api_url,
                    api_key=api_key,
                    default_headers=self.get_browser_headers(),
                )
                return [model.id for model in client.models.list()]
        except Exception as e:
            LogManager.get().debug(Localizer.get().model_selector_page_fail, e)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().model_selector_page_fail,
                },
            )

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
