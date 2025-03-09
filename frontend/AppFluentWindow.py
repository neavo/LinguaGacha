import re
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtCore import QEvent
from PyQt5.QtCore import QTimer
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
from module.VersionManager import VersionManager
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
from frontend.Quality.PreTranslationReplacementPage import PreTranslationReplacementPage
from frontend.Quality.PostTranslationReplacementPage import PostTranslationReplacementPage

class AppFluentWindow(FluentWindow, Base):

    APP_WIDTH: int = 1280
    APP_HEIGHT: int = 800

    THEME_COLOR: str = "#BCA483"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.home_page_url = "https://github.com/neavo/LinguaGacha"

        # 默认配置
        self.default = {
            "theme": "light",
            "app_language": Base.Language.ZH,
        }

        # 载入并保存默认配置
        self.save_config(self.load_config_from_default())

        # 设置主题颜色
        setThemeColor(AppFluentWindow.THEME_COLOR)

        # 设置窗口属性
        self.resize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setMinimumSize(AppFluentWindow.APP_WIDTH, AppFluentWindow.APP_HEIGHT)
        self.setWindowTitle(f"LinguaGacha {VersionManager.VERSION}")
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
        self.subscribe(Base.Event.APP_UPDATE_CHECK_DONE, self.app_updater_check_done)

        # 检查更新
        QTimer.singleShot(3000, lambda: self.emit(Base.Event.APP_UPDATE_CHECK, {}))

    # 重写窗口关闭函数
    def closeEvent(self, event: QEvent) -> None:
        message_box = MessageBox(Localizer.get().warning, Localizer.get().app_close_message_box, self)
        message_box.yesButton.setText(Localizer.get().confirm)
        message_box.cancelButton.setText(Localizer.get().cancel)

        if not message_box.exec():
            event.ignore()
        else:
            self.emit(Base.Event.APP_SHUT_DOWN, {})
            self.info(Localizer.get().app_close_message_box_msg)
            event.accept()

    # 响应显示 Toast 事件
    def show_toast(self, event: int, data: dict) -> None:
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
            Localizer.get().switch_language,
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
            "message": Localizer.get().switch_language_toast,
        })

    # 打开主页
    def open_project_page(self) -> None:
        QDesktopServices.openUrl(QUrl(self.home_page_url))

    # 检查应用更新完成事件
    def app_updater_check_done(self, event: int, data: dict) -> None:
        result: dict = data.get("result", {})

        try:
            a, b, c = re.findall(r"v(\d+)\.(\d+)\.(\d+)$", VersionManager.VERSION)[-1]
            x, y, z = re.findall(r"v(\d+)\.(\d+)\.(\d+)$", result.get("tag_name", ""))[-1]

            if (
                int(a) < int(x)
                or (int(a) == int(x) and int(b) < int(y))
                or (int(a) == int(x) and int(b) == int(y) and int(c) < int(z))
            ):
                self.emit(Base.Event.TOAST_SHOW, {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().app_new_version_toast.replace("{VERSION}", f"v{x}.{y}.{z}"),
                    "duration": 60 * 1000,
                })
                self.home_page_url = result.get("html_url", self.home_page_url)
                self.home_page_widget.setName(Localizer.get().app_new_version)
        except Exception as e:
            self.debug("app_updater_check_done", e)

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
            "⭐️ @ Github",
            "resource/icon_full.png",
        )
        self.navigationInterface.addWidget(
            routeKey = "avatar_navigation_widget",
            widget = self.home_page_widget,
            onClick = self.open_project_page,
            position = NavigationItemPosition.BOTTOM
        )

    # 添加第一节
    def add_project_pages(self) -> None:
        # 接口管理
        self.addSubInterface(
            PlatformPage("platform_page", self),
            FluentIcon.IOT,
            Localizer.get().app_platform_page,
            NavigationItemPosition.SCROLL
        )

        # 项目设置
        self.addSubInterface(
            ProjectPage("project_page", self),
            FluentIcon.FOLDER,
            Localizer.get().app_project_page,
            NavigationItemPosition.SCROLL
        )

        # 开始翻译
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(
            self.translation_page,
            FluentIcon.PLAY,
            Localizer.get().app_translation_page,
            NavigationItemPosition.SCROLL
        )

    # 添加第二节
    def add_setting_pages(self) -> None:
        # 基础设置
        self.addSubInterface(
            BasicSettingsPage("basic_settings_page", self),
            FluentIcon.ZOOM,
            Localizer.get().app_basic_settings_page,
            NavigationItemPosition.SCROLL,
        )

        # 高级功能
        self.addSubInterface(
            AdvanceFeaturePage("advance_Feature_page", self),
            FluentIcon.COMMAND_PROMPT,
            Localizer.get().app_advance_Feature_page,
            NavigationItemPosition.SCROLL
        )

    # 添加第三节
    def add_quality_pages(self) -> None:
        # 术语表
        self.addSubInterface(
            GlossaryPage("glossary_page", self),
            FluentIcon.DICTIONARY,
            Localizer.get().app_glossary_page,
            NavigationItemPosition.SCROLL,
        )

        # 译前替换
        self.addSubInterface(
            PreTranslationReplacementPage("pre_translation_replacement_page", self),
            FluentIcon.SEARCH,
            Localizer.get().app_pre_translation_replacement_page,
            NavigationItemPosition.SCROLL,
        )

        # 译后替换
        self.addSubInterface(
            PostTranslationReplacementPage("post_translation_replacement_page", self),
            FluentIcon.SEARCH_MIRROR,
            Localizer.get().app_post_translation_replacement_page,
            NavigationItemPosition.SCROLL,
        )

        # 自定义提示词
        self.custom_prompt_navigation_item = BaseNavigationItem("custom_prompt_navigation_item", self)
        self.addSubInterface(
            self.custom_prompt_navigation_item,
            FluentIcon.LABEL,
            Localizer.get().app_custom_prompt_navigation_item,
            NavigationItemPosition.SCROLL,
        )
        self.addSubInterface(
            CustomPromptZHPage("custom_prompt_zh_page", self),
            FluentIcon.PENCIL_INK,
            Localizer.get().app_custom_prompt_zh_page,
            parent = self.custom_prompt_navigation_item,
        )
        self.addSubInterface(
            CustomPromptENPage("custom_prompt_en_page", self),
            FluentIcon.PENCIL_INK,
            Localizer.get().app_custom_prompt_en_page,
            parent = self.custom_prompt_navigation_item,
        )