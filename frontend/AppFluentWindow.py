import os
import signal

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
from frontend.Extra.BatchCorrectionPage import BatchCorrectionPage
from frontend.Extra.LaboratoryPage import LaboratoryPage
from frontend.Extra.NameFieldExtractionPage import NameFieldExtractionPage
from frontend.Extra.ReTranslationPage import ReTranslationPage
from frontend.Extra.ToolBoxPage import ToolBoxPage
from frontend.Project.PlatformPage import PlatformPage
from frontend.Project.ProjectPage import ProjectPage
from frontend.Quality.CustomPromptPage import CustomPromptPage
from frontend.Quality.GlossaryPage import GlossaryPage
from frontend.Quality.TextPreservePage import TextPreservePage
from frontend.Quality.TextReplacementPage import TextReplacementPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.ExpertSettingsPage import ExpertSettingsPage
from frontend.TranslationPage import TranslationPage
from module.Config import Config
from module.Localizer.Localizer import Localizer

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
        self.subscribe(Base.Event.APP_TOAST_SHOW, self.show_toast)
        self.subscribe(Base.Event.APP_UPDATE_CHECK_DONE, self.app_update_check_done)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_DONE, self.app_update_download_done)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_ERROR, self.app_update_download_error)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_UPDATE, self.app_update_download_update)

        # 检查更新
        QTimer.singleShot(3000, lambda: self.emit(Base.Event.APP_UPDATE_CHECK_START, {}))

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
    def show_toast(self, event: str, data: dict) -> None:
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

    # 切换主题
    def switch_theme(self) -> None:
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

        self.emit(Base.Event.APP_TOAST_SHOW, {
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
            self.emit(Base.Event.APP_UPDATE_DOWNLOAD_START, {})
        elif VersionManager.get().get_status() == VersionManager.Status.UPDATING:
            pass
        elif VersionManager.get().get_status() == VersionManager.Status.DOWNLOADED:
            self.emit(Base.Event.APP_UPDATE_EXTRACT, {})
        else:
            QDesktopServices.openUrl(QUrl("https://github.com/neavo/LinguaGacha"))

    # 更新 - 检查完成
    def app_update_check_done(self, event: str, data: dict) -> None:
        if data.get("new_version", False) == True:
            self.home_page_widget.setName(Localizer.get().app_new_version)

    # 更新 - 下载完成
    def app_update_download_done(self, event: str, data: dict) -> None:
        self.home_page_widget.setName(Localizer.get().app_new_version_downloaded)

    # 更新 - 下载报错
    def app_update_download_error(self, event: str, data: dict) -> None:
        self.home_page_widget.setName(__class__.HOMEPAGE)

    # 更新 - 下载更新
    def app_update_download_update(self, event: str, data: dict) -> None:
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

    # 添加任务类页面
    def add_task_pages(self) -> None:
        # 开始翻译
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(
            self.translation_page,
            FluentIcon.PLAY,
            Localizer.get().app_translation_page,
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

        # 百宝箱 - 批量修正
        self.batch_correction_page = BatchCorrectionPage("batch_correction_page", self)
        self.stackedWidget.addWidget(self.batch_correction_page)

        # 百宝箱 - 部分重翻
        self.re_translation_page = ReTranslationPage("re_translation_page", self)
        self.stackedWidget.addWidget(self.re_translation_page)

        # 百宝箱 - 姓名字段注入
        self.name_field_extraction_page = NameFieldExtractionPage("name_field_extraction_page", self)
        self.stackedWidget.addWidget(self.name_field_extraction_page)