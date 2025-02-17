from PyQt5.QtGui import QDesktopServices
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtCore import QEvent
from PyQt5.QtWidgets import QApplication

from qfluentwidgets import Theme
from qfluentwidgets import setTheme
from qfluentwidgets import isDarkTheme
from qfluentwidgets import setThemeColor
from qfluentwidgets import InfoBar
from qfluentwidgets import FluentIcon
from qfluentwidgets import MessageBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import InfoBarPosition
from qfluentwidgets import NavigationPushButton
from qfluentwidgets import NavigationItemPosition
from qfluentwidgets import NavigationAvatarWidget

from base.Base import Base
from module.Localizer.Localizer import Localizer
from frontend.AppSettingsPage import AppSettingsPage
from frontend.BaseNavigationItem import BaseNavigationItem
from frontend.Project.ProjectPage import ProjectPage
from frontend.Project.PlatformPage import PlatformPage
from frontend.Project.TranslationPage import TranslationPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.AdvanceFeaturePage import AdvanceFeaturePage
from frontend.Quality.GlossaryPage import GlossaryPage
from frontend.Quality.CustomPromptZHPage import CustomPromptZHPage
from frontend.Quality.CustomPromptENPage import CustomPromptENPage
from frontend.Quality.ReplaceAfterTranslationPage import ReplaceAfterTranslationPage
from frontend.Quality.ReplaceBeforeTranslationPage import ReplaceBeforeTranslationPage

class AppFluentWindow(FluentWindow, Base):

    APP_WIDTH: int = 1280
    APP_HEIGHT: int = 800

    THEME_COLOR: str = "#BCA483"

    def __init__(self, version: str) -> None:
        super().__init__()

        # 默认配置
        self.default = {
            "theme": "light",
            "app_language": Base.Language.ZH,
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 打印日志
        if self.is_debug():
            self.warning(Localizer.get().app_fluent_window_debug_msg)

        # 设置主题颜色
        setThemeColor(AppFluentWindow.THEME_COLOR)

        # 设置主题
        setTheme(Theme.DARK if config.get("theme") == "dark" else Theme.LIGHT)

        # 设置窗口属性
        self.resize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setMinimumSize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setWindowTitle(version)
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
        self.subscribe(Base.Event.TOAST_SHOW, self.show_toast)

    # 重写窗口关闭函数
    def closeEvent(self, event: QEvent) -> None:
        message_box = MessageBox(Localizer.get().warning, Localizer.get().app_fluent_window_close_message_box_content, self)
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            event.ignore()
        else:
            self.emit(Base.Event.APP_SHUT_DOWN, {})
            self.info(Localizer.get().app_fluent_window_close_message_box_msg)
            event.accept()

    # 响应显示 Toast 事件
    def show_toast(self, event: int, data: dict) -> None:
        toast_type = data.get("type", Base.ToastType.INFO)
        toast_message = data.get("message", "")

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
            duration = 2500,
            orient = Qt.Horizontal,
            position = InfoBarPosition.TOP,
            isClosable = True,
        )

    # 切换主题
    def switch_theme(self) -> None:
        config = self.load_config()

        if not isDarkTheme():
            setTheme(Theme.DARK)
            config["theme"] = "dark"
        else:
            setTheme(Theme.LIGHT)
            config["theme"] = "light"

        config = self.save_config(config)

    # 切换语言
    def swicth_language(self) -> None:
        message_box = MessageBox(
            Localizer.get().alert,
            Localizer.get().app_fluent_window_language_message_box_content,
            self
        )
        message_box.yesButton.setText("中文")
        message_box.cancelButton.setText("English")

        if message_box.exec():
            config = self.load_config()
            config["app_language"] = Base.Language.ZH
            self.save_config(config)
        else:
            config = self.load_config()
            config["app_language"] = Base.Language.EN
            self.save_config(config)

        self.emit(Base.Event.TOAST_SHOW, {
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().app_fluent_window_language_message_box_msg,
        })

    # 打开主页
    def open_project_page(self) -> None:
        url = QUrl("https://github.com/neavo/LinguaGacha")
        QDesktopServices.openUrl(url)

    # 开始添加页面
    def add_pages(self) -> None:
        self.add_project_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_setting_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_quality_pages()

        # 设置默认页面
        self.switchTo(self.translation_page)

        # 主题切换按钮
        self.navigationInterface.addWidget(
            routeKey = "theme_navigation_button",
            widget = NavigationPushButton(
                FluentIcon.CONSTRACT,
                Localizer.get().app_fluent_window_theme_btn,
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
                Localizer.get().app_fluent_window_language_btn,
                False
            ),
            onClick = self.swicth_language,
            position = NavigationItemPosition.BOTTOM
        )

        # 应用设置按钮
        self.app_settings_page = AppSettingsPage("app_settings_page", self)
        self.addSubInterface(self.app_settings_page, FluentIcon.SETTING, Localizer.get().app_fluent_window_app_settings_page, NavigationItemPosition.BOTTOM)

        # 项目主页按钮
        self.navigationInterface.addWidget(
            routeKey = "avatar_navigation_widget",
            widget = NavigationAvatarWidget(
                "⭐️ @ Github",
                "resource/avatar-bg.jpg",
            ),
            onClick = self.open_project_page,
            position = NavigationItemPosition.BOTTOM
        )

    # 添加第一节
    def add_project_pages(self) -> None:
        self.platform_page = PlatformPage("platform_page", self)
        self.addSubInterface(self.platform_page, FluentIcon.IOT, Localizer.get().app_fluent_window_platform_page, NavigationItemPosition.SCROLL)
        self.prject_page = ProjectPage("prject_page", self)
        self.addSubInterface(self.prject_page, FluentIcon.FOLDER, Localizer.get().app_fluent_window_prject_page, NavigationItemPosition.SCROLL)
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(self.translation_page, FluentIcon.PLAY, Localizer.get().app_fluent_window_translation_page, NavigationItemPosition.SCROLL)

    # 添加第二节
    def add_setting_pages(self) -> None:
        self.basic_settings_page = BasicSettingsPage("basic_settings_page", self)
        self.addSubInterface(self.basic_settings_page, FluentIcon.ZOOM, Localizer.get().app_fluent_window_basic_settings_page, NavigationItemPosition.SCROLL)
        self.advance_Feature_page = AdvanceFeaturePage("advance_Feature_page", self)
        self.addSubInterface(self.advance_Feature_page, FluentIcon.COMMAND_PROMPT, Localizer.get().app_fluent_window_advance_Feature_page, NavigationItemPosition.SCROLL)

    # 添加第三节
    def add_quality_pages(self) -> None:
        self.prompt_dictionary_page = GlossaryPage("prompt_dictionary_page", self)
        self.addSubInterface(self.prompt_dictionary_page, FluentIcon.DICTIONARY, Localizer.get().app_fluent_window_prompt_dictionary_page, NavigationItemPosition.SCROLL)
        self.replcae_before_translation_page = ReplaceBeforeTranslationPage("replcae_before_translation_page", self)
        self.addSubInterface(self.replcae_before_translation_page, FluentIcon.SEARCH, Localizer.get().app_fluent_window_replcae_before_translation_page, NavigationItemPosition.SCROLL)
        self.replcae_after_translation_page = ReplaceAfterTranslationPage("replcae_after_translation_page", self)
        self.addSubInterface(self.replcae_after_translation_page, FluentIcon.SEARCH_MIRROR, Localizer.get().app_fluent_window_replcae_after_translation_page, NavigationItemPosition.SCROLL)
        self.custom_prompt_navigation_item = BaseNavigationItem("custom_prompt_navigation_item", self)
        self.addSubInterface(self.custom_prompt_navigation_item, FluentIcon.LABEL, Localizer.get().app_fluent_window_custom_prompt_navigation_item, NavigationItemPosition.SCROLL)
        self.custom_prompt_zh_page = CustomPromptZHPage("custom_prompt_zh_page", self)
        self.addSubInterface(self.custom_prompt_zh_page, FluentIcon.HIGHTLIGHT, Localizer.get().app_fluent_window_custom_prompt_zh_page, parent = self.custom_prompt_navigation_item)
        self.custom_prompt_en_page = CustomPromptENPage("custom_prompt_en_page", self)
        self.addSubInterface(self.custom_prompt_en_page, FluentIcon.ERASE_TOOL, Localizer.get().app_fluent_window_custom_prompt_en_page, parent = self.custom_prompt_navigation_item)