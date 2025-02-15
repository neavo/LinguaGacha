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
from frontend.AppSettingsPage import AppSettingsPage
from frontend.Project.ProjectPage import ProjectPage
from frontend.Project.PlatformPage import PlatformPage
from frontend.Project.TranslationPage import TranslationPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.AdvanceFeaturePage import AdvanceFeaturePage
from frontend.Quality.GlossaryPage import GlossaryPage
from frontend.Quality.CustomPromptPage import CustomPromptPage
from frontend.Quality.ReplaceAfterTranslationPage import ReplaceAfterTranslationPage
from frontend.Quality.ReplaceBeforeTranslationPage import ReplaceBeforeTranslationPage

class AppFluentWindow(FluentWindow, Base):

    APP_WIDTH = 1280
    APP_HEIGHT = 800

    THEME_COLOR = "#BCA483"

    def __init__(self, version: str) -> None:
        super().__init__()

        # 默认配置
        self.default = {
            "theme": "dark",
        }

        # 载入并保存默认配置
        config = self.save_config(self.load_config_from_default())

        # 打印日志
        if self.is_debug():
            self.print("")
            self.warning("调试模式已启用 ...")

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
        message_box = MessageBox("警告", "确定是否退出程序 ... ？", self)
        message_box.yesButton.setText("确认")
        message_box.cancelButton.setText("取消")

        if not message_box.exec():
            event.ignore()
        else:
            self.emit(Base.Event.APP_SHUT_DOWN, {})
            self.info("主窗口已关闭，稍后应用将自动退出 ...")
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
    def toggle_theme(self) -> None:
        config = self.load_config()

        if not isDarkTheme():
            setTheme(Theme.DARK)
            config["theme"] = "dark"
        else:
            setTheme(Theme.LIGHT)
            config["theme"] = "light"

        config = self.save_config(config)

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

        # 应用设置按钮
        self.app_settings_page = AppSettingsPage("app_settings_page", self)
        self.addSubInterface(self.app_settings_page, FluentIcon.SETTING, "应用设置", NavigationItemPosition.BOTTOM)

        # 主题切换按钮
        self.navigationInterface.addWidget(
            routeKey = "theme_navigation_button",
            widget = NavigationPushButton(
                FluentIcon.CONSTRACT,
                "变换自如",
                False
            ),
            onClick = self.toggle_theme,
            position = NavigationItemPosition.BOTTOM
        )

        # 项目主页按钮
        self.navigationInterface.addWidget(
            routeKey = "avatar_navigation_widget",
            widget = NavigationAvatarWidget(
                "LinguaGacha",
                "resource/avatar-bg.jpg",
            ),
            onClick = self.open_project_page,
            position = NavigationItemPosition.BOTTOM
        )

    # 添加第一节
    def add_project_pages(self) -> None:
        self.platform_page = PlatformPage("platform_page", self)
        self.addSubInterface(self.platform_page, FluentIcon.IOT, "接口管理", NavigationItemPosition.SCROLL)
        self.prject_page = ProjectPage("prject_page", self)
        self.addSubInterface(self.prject_page, FluentIcon.FOLDER, "项目设置", NavigationItemPosition.SCROLL)
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(self.translation_page, FluentIcon.PLAY, "开始翻译", NavigationItemPosition.SCROLL)

    # 添加第二节
    def add_setting_pages(self) -> None:
        self.basic_settings_page = BasicSettingsPage("basic_settings_page", self)
        self.addSubInterface(self.basic_settings_page, FluentIcon.ZOOM, "基础设置", NavigationItemPosition.SCROLL)
        self.advance_Feature_page = AdvanceFeaturePage("advance_Feature_page", self)
        self.addSubInterface(self.advance_Feature_page, FluentIcon.COMMAND_PROMPT, "高级功能", NavigationItemPosition.SCROLL)

    # 添加第三节
    def add_quality_pages(self) -> None:
        self.prompt_dictionary_page = GlossaryPage("prompt_dictionary_page", self)
        self.addSubInterface(self.prompt_dictionary_page, FluentIcon.DICTIONARY, "术语表", NavigationItemPosition.SCROLL)
        self.replcae_before_translation_page = ReplaceBeforeTranslationPage("replcae_before_translation_page", self)
        self.addSubInterface(self.replcae_before_translation_page, FluentIcon.SEARCH, "译前替换", NavigationItemPosition.SCROLL)
        self.replcae_after_translation_page = ReplaceAfterTranslationPage("replcae_after_translation_page", self)
        self.addSubInterface(self.replcae_after_translation_page, FluentIcon.SEARCH_MIRROR, "译后替换", NavigationItemPosition.SCROLL)
        self.custom_prompt_page = CustomPromptPage("custom_prompt_page", self)
        self.addSubInterface(self.custom_prompt_page, FluentIcon.LABEL, "自定义提示词", NavigationItemPosition.SCROLL)