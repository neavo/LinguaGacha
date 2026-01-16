import os
import signal
import time

from PyQt5.QtCore import QEvent
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QApplication
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import InfoBar
from qfluentwidgets import InfoBarPosition
from qfluentwidgets import MessageBox
from qfluentwidgets import NavigationAvatarWidget
from qfluentwidgets import NavigationItemPosition
from qfluentwidgets import NavigationPushButton
from qfluentwidgets import Theme
from qfluentwidgets import isDarkTheme
from qfluentwidgets import setTheme
from qfluentwidgets import setThemeColor

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from base.LogManager import LogManager
from base.VersionManager import VersionManager
from frontend.AppSettingsPage import AppSettingsPage
from frontend.EmptyPage import EmptyPage
from frontend.Extra.LaboratoryPage import LaboratoryPage
from frontend.Extra.NameFieldExtractionPage import NameFieldExtractionPage
from frontend.Extra.ReTranslationPage import ReTranslationPage
from frontend.Extra.ToolBoxPage import ToolBoxPage
from frontend.Model.ModelPage import ModelPage
from frontend.Quality.CustomPromptPage import CustomPromptPage
from frontend.Quality.GlossaryPage import GlossaryPage
from frontend.Quality.TextPreservePage import TextPreservePage
from frontend.Quality.TextReplacementPage import TextReplacementPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.ExpertSettingsPage import ExpertSettingsPage
from frontend.Translation import TranslationPage
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.ProgressToast import ProgressToast

class AppFluentWindow(FluentWindow, Base):

    APP_WIDTH: int = 1280
    APP_HEIGHT: int = 800
    APP_THEME_COLOR: str = "#BCA483"
    HOMEPAGE: str = " Ciallo～(∠・ω< )⌒✮"

    def __init__(self) -> None:
        super().__init__()

        # 设置主题颜色
        setThemeColor(AppFluentWindow.APP_THEME_COLOR)

        # 设置窗口属性
        self.resize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setMinimumSize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setWindowTitle(f"LinguaGacha {VersionManager.get().get_version()}")
        self.titleBar.iconLabel.hide()

        # 设置启动位置
        desktop = QApplication.desktop().availableGeometry()
        self.move(desktop.width()//2 - self.width()//2, desktop.height()//2 - self.height()//2)

        # 设置侧边栏宽度
        self.navigationInterface.setExpandWidth(256)

        # 侧边栏默认展开
        self.navigationInterface.setMinimumExpandWidth(self.APP_WIDTH)
        self.navigationInterface.expand(useAni = False)

        # 隐藏返回按钮
        self.navigationInterface.panel.setReturnButtonVisible(False)

        # 添加页面
        self.add_pages()

        # 注册事件
        self.subscribe(Base.Event.TOAST, self.toast)
        self.subscribe(Base.Event.APP_UPDATE_CHECK_DONE, self.app_update_check_done)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_DONE, self.app_update_download_done)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_ERROR, self.app_update_download_error)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_UPDATE, self.app_update_download_update)
        self.subscribe(Base.Event.PROGRESS_TOAST_SHOW, self.progress_toast_show)
        self.subscribe(Base.Event.PROGRESS_TOAST_UPDATE, self.progress_toast_update)
        self.subscribe(Base.Event.PROGRESS_TOAST_HIDE, self.progress_toast_hide_handler)

        # 创建进度 Toast 组件（应用级别，挂载到主窗口）
        self.progress_toast = ProgressToast(self)
        self._progress_start_time: float = 0.0       # 开始显示的时间戳
        self._progress_hide_timer: QTimer | None = None  # 延迟隐藏的 timer

        # 检查更新
        QTimer.singleShot(3000, lambda: self.emit(Base.Event.APP_UPDATE_CHECK_RUN, {}))

    # 重写窗口关闭函数
    def closeEvent(self, event: QEvent) -> None:
        message_box = MessageBox(Localizer.get().warning, Localizer.get().app_close_message_box, self)
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            event.ignore()
        else:
            os.kill(os.getpid(), signal.SIGTERM)

    # 响应显示 Toast 事件
    def toast(self, event: Base.Event, data: dict) -> None:
        # 窗口最小化时不显示 toast，避免 InfoBar 动画错误
        if self.isMinimized():
            return

        toast_type = data.get("type", Base.ToastType.INFO)
        toast_message = data.get("message", "")
        toast_duration = data.get("duration", 2500)

        if toast_type == Base.ToastType.ERROR:
            toast_func = InfoBar.error
        elif toast_type == Base.ToastType.WARNING:
            toast_func = InfoBar.warning
        elif toast_type == Base.ToastType.SUCCESS:
            toast_func = InfoBar.success
        else:
            toast_func = InfoBar.info

        toast_func(
            title = "",
            content = toast_message,
            parent = self,
            duration = toast_duration,
            orient = Qt.Orientation.Horizontal,
            position = InfoBarPosition.TOP,
            isClosable = True,
        )

    # 响应显示进度 Toast 事件
    def progress_toast_show(self, event: Base.Event, data: dict) -> None:
        # 窗口最小化时不显示，避免动画错误
        if self.isMinimized():
            return

        # 取消延迟隐藏（如果有新任务）
        if self._progress_hide_timer is not None:
            self._progress_hide_timer.stop()
            self._progress_hide_timer = None

        # 记录开始时间（如果是首次显示）
        if self._progress_start_time == 0.0:
            self._progress_start_time = time.time()

        message = data.get("message", "")
        is_indeterminate = data.get("indeterminate", True)
        current = data.get("current", 0)
        total = data.get("total", 0)

        if is_indeterminate:
            self.progress_toast.show_indeterminate(message)
        else:
            self.progress_toast.show_progress(message, current, total)

    # 响应更新进度 Toast 事件
    def progress_toast_update(self, event: Base.Event, data: dict) -> None:
        message = data.get("message", "")
        current = data.get("current", 0)
        total = data.get("total", 0)

        self.progress_toast.set_content(message)
        self.progress_toast.set_progress(current, total)

    # 响应隐藏进度 Toast 事件
    def progress_toast_hide_handler(self, event: Base.Event, data: dict) -> None:
        # 未显示时直接返回
        if self._progress_start_time == 0.0:
            return

        min_display_ms = 1500
        elapsed_ms = (time.time() - self._progress_start_time) * 1000
        remaining_ms = min_display_ms - elapsed_ms

        if remaining_ms > 0:
            # 延迟隐藏，保证最小显示时长
            self._progress_hide_timer = QTimer()
            self._progress_hide_timer.setSingleShot(True)
            self._progress_hide_timer.timeout.connect(self._do_progress_toast_hide)
            self._progress_hide_timer.start(int(remaining_ms))
        else:
            self._do_progress_toast_hide()

    def _do_progress_toast_hide(self) -> None:
        """实际执行隐藏操作"""
        self._progress_hide_timer = None
        self._progress_start_time = 0.0
        self.progress_toast.hide_toast()

    # 重写窗口大小变化事件，更新进度 Toast 位置
    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if self.progress_toast.isVisible():
            self.progress_toast._update_position()

    # 切换主题
    def switch_theme(self) -> None:
        # 处理待处理事件，确保 deleteLater() 触发的 widget 销毁已完成
        # 避免 qfluentwidgets styleSheetManager 遍历时字典大小变化
        QApplication.processEvents()

        config = Config().load()
        if not isDarkTheme():
            setTheme(Theme.DARK)
            config.theme = Config.Theme.DARK
        else:
            setTheme(Theme.LIGHT)
            config.theme = Config.Theme.LIGHT
        config.save()

    # 切换语言
    def swicth_language(self) -> None:
        message_box = MessageBox(
            Localizer.get().alert,
            Localizer.get().switch_language,
            self
        )
        message_box.yesButton.setText("中文")
        message_box.cancelButton.setText("English")

        if message_box.exec():
            config = Config().load()
            config.app_language = BaseLanguage.Enum.ZH
            config.save()
        else:
            config = Config().load()
            config.app_language = BaseLanguage.Enum.EN
            config.save()

        self.emit(Base.Event.TOAST, {
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().switch_language_toast,
        })

    # 打开主页
    def open_project_page(self) -> None:
        if VersionManager.get().get_status() == VersionManager.Status.NEW_VERSION:
            # 更新 UI
            self.home_page_widget.setName(
                Localizer.get().app_new_version_update.replace("{PERCENT}", "")
            )

            # 触发下载事件
            self.emit(Base.Event.APP_UPDATE_DOWNLOAD_RUN, {})
        elif VersionManager.get().get_status() == VersionManager.Status.UPDATING:
            pass
        elif VersionManager.get().get_status() == VersionManager.Status.DOWNLOADED:
            self.emit(Base.Event.APP_UPDATE_EXTRACT, {})
        else:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha"))

    # 更新 - 检查完成
    def app_update_check_done(self, event: Base.Event, data: dict) -> None:
        if data.get("new_version", False) == True:
            self.home_page_widget.setName(Localizer.get().app_new_version)

    # 更新 - 下载完成
    def app_update_download_done(self, event: Base.Event, data: dict) -> None:
        self.home_page_widget.setName(Localizer.get().app_new_version_downloaded)

    # 更新 - 下载报错
    def app_update_download_error(self, event: Base.Event, data: dict) -> None:
        self.home_page_widget.setName(__class__.HOMEPAGE)

    # 更新 - 下载更新
    def app_update_download_update(self, event: Base.Event, data: dict) -> None:
        total_size: int = data.get("total_size", 0)
        downloaded_size: int = data.get("downloaded_size", 0)
        self.home_page_widget.setName(
            Localizer.get().app_new_version_update.replace("{PERCENT}", f"{downloaded_size / max(1, total_size) * 100:.2f}%")
        )

    # 开始添加页面
    def add_pages(self) -> None:
        self.add_project_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_task_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_setting_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_quality_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_extra_pages()

        # 设置默认页面
        self.switchTo(self.translation_page)

        # 主题切换按钮
        self.navigationInterface.addWidget(
            routeKey = "theme_navigation_button",
            widget = NavigationPushButton(
                FluentIcon.CONSTRACT,
                Localizer.get().app_theme_btn,
                False
            ),
            onClick = self.switch_theme,
            position = NavigationItemPosition.BOTTOM
        )

        # 语言切换按钮
        self.navigationInterface.addWidget(
            routeKey = "language_navigation_button",
            widget = NavigationPushButton(
                FluentIcon.LANGUAGE,
                Localizer.get().app_language_btn,
                False
            ),
            onClick = self.swicth_language,
            position = NavigationItemPosition.BOTTOM
        )

        # 应用设置按钮
        self.addSubInterface(
            AppSettingsPage("app_settings_page", self),
            FluentIcon.SETTING,
            Localizer.get().app_settings_page,
            NavigationItemPosition.BOTTOM,
        )

        # 项目主页按钮
        self.home_page_widget = NavigationAvatarWidget(
            __class__.HOMEPAGE,
            "resource/icon_full.png",
        )
        self.navigationInterface.addWidget(
            routeKey = "avatar_navigation_widget",
            widget = self.home_page_widget,
            onClick = self.open_project_page,
            position = NavigationItemPosition.BOTTOM
        )

    # 添加项目类页面
    def add_project_pages(self) -> None:
        # 模型管理
        self.addSubInterface(
            ModelPage("model_page", self),
            FluentIcon.IOT,
            Localizer.get().app_model_page,
            NavigationItemPosition.SCROLL
        )



    # 添加任务类页面
    def add_task_pages(self) -> None:
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(
            self.translation_page,
            FluentIcon.TRANSPARENT,
            Localizer.get().app_translation_page,
            NavigationItemPosition.SCROLL
        )

        # 校对任务
        from frontend.Proofreading import ProofreadingPage
        self.proofreading_page = ProofreadingPage("proofreading_page", self)
        self.addSubInterface(
            self.proofreading_page,
            FluentIcon.CHECKBOX,
            Localizer.get().app_proofreading_page,
            NavigationItemPosition.SCROLL
        )

    # 添加设置类页面
    def add_setting_pages(self) -> None:
        # 基础设置
        self.addSubInterface(
            BasicSettingsPage("basic_settings_page", self),
            FluentIcon.ZOOM,
            Localizer.get().app_basic_settings_page,
            NavigationItemPosition.SCROLL,
        )

        # 专家设置
        if LogManager.get().is_expert_mode():
            self.addSubInterface(
                ExpertSettingsPage("expert_settings_page", self),
                FluentIcon.EDUCATION,
                Localizer.get().app_expert_settings_page,
                NavigationItemPosition.SCROLL
            )

    # 添加质量类页面
    def add_quality_pages(self) -> None:
        # 术语表
        self.glossary_page = GlossaryPage("glossary_page", self)
        self.addSubInterface(
            interface = self.glossary_page,
            icon = FluentIcon.DICTIONARY,
            text = Localizer.get().app_glossary_page,
            position = NavigationItemPosition.SCROLL,
        )

        # 文本保护
        self.addSubInterface(
            interface = TextPreservePage("text_preserve_page", self),
            icon = FluentIcon.VPN,
            text = Localizer.get().app_text_preserve_page,
            position = NavigationItemPosition.SCROLL,
        ) if LogManager.get().is_expert_mode() else None

        # 文本替换
        self.text_replacement_page = EmptyPage("replacement_page", self)
        self.addSubInterface(
            interface = self.text_replacement_page,
            icon = FluentIcon.CLIPPING_TOOL,
            text = Localizer.get().app_text_replacement_page,
            position = NavigationItemPosition.SCROLL,
        ) if LogManager.get().is_expert_mode() else None
        self.addSubInterface(
            interface = TextReplacementPage("pre_translation_replacement_page", self, "pre_translation_replacement"),
            icon = FluentIcon.SEARCH,
            text = Localizer.get().app_pre_translation_replacement_page,
            position = NavigationItemPosition.SCROLL,
            parent = self.text_replacement_page if LogManager.get().is_expert_mode() else None,
        )
        self.addSubInterface(
            interface = TextReplacementPage("post_translation_replacement_page", self, "post_translation_replacement"),
            icon = FluentIcon.SEARCH_MIRROR,
            text = Localizer.get().app_post_translation_replacement_page,
            position = NavigationItemPosition.SCROLL,
            parent = self.text_replacement_page if LogManager.get().is_expert_mode() else None,
        )

        # 自定义提示词
        self.custom_prompt_page = EmptyPage("custom_prompt_page", self)
        self.addSubInterface(
            self.custom_prompt_page,
            FluentIcon.LABEL,
            Localizer.get().app_custom_prompt_navigation_item,
            NavigationItemPosition.SCROLL,
        )
        if Localizer.get_app_language() == BaseLanguage.Enum.EN:
            self.addSubInterface(
                CustomPromptPage("custom_prompt_en_page", self, BaseLanguage.Enum.EN),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_en_page,
                parent = self.custom_prompt_page,
            )
            self.addSubInterface(
                CustomPromptPage("custom_prompt_zh_page", self, BaseLanguage.Enum.ZH),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_zh_page,
                parent = self.custom_prompt_page,
            )
        else:
            self.addSubInterface(
                CustomPromptPage("custom_prompt_zh_page", self, BaseLanguage.Enum.ZH),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_zh_page,
                parent = self.custom_prompt_page,
            )
            self.addSubInterface(
                CustomPromptPage("custom_prompt_en_page", self, BaseLanguage.Enum.EN),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_en_page,
                parent = self.custom_prompt_page,
            )

    # 添加额外页面
    def add_extra_pages(self) -> None:
        # 实验室
        self.addSubInterface(
            interface = LaboratoryPage("laboratory_page", self),
            icon = FluentIcon.FINGERPRINT,
            text = Localizer.get().app_laboratory_page,
            position = NavigationItemPosition.SCROLL,
        )

        # 百宝箱
        self.addSubInterface(
            interface = ToolBoxPage("tool_box_page", self),
            icon = FluentIcon.TILES,
            text = Localizer.get().app_treasure_chest_page,
            position = NavigationItemPosition.SCROLL,
        )


        # 百宝箱 - 部分重翻
        self.re_translation_page = ReTranslationPage("re_translation_page", self)
        self.stackedWidget.addWidget(self.re_translation_page)

        # 百宝箱 - 姓名字段注入
        self.name_field_extraction_page = NameFieldExtractionPage("name_field_extraction_page", self)
        self.stackedWidget.addWidget(self.name_field_extraction_page)