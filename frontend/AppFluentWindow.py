import os
import signal
import time

from PyQt5.QtCore import QEvent
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTimer
from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWidgets import QWidget
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
from frontend.Extra.ToolBoxPage import ToolBoxPage
from frontend.Extra.TSConversionPage import TSConversionPage
from frontend.Model.ModelPage import ModelPage
from frontend.Proofreading import ProofreadingPage
from frontend.Quality.CustomPromptPage import CustomPromptPage
from frontend.Quality.GlossaryPage import GlossaryPage
from frontend.Quality.TextPreservePage import TextPreservePage
from frontend.Quality.TextReplacementPage import TextReplacementPage
from frontend.Setting.BasicSettingsPage import BasicSettingsPage
from frontend.Setting.ExpertSettingsPage import ExpertSettingsPage
from frontend.Translation import TranslationPage
from frontend.WorkbenchPage import WorkbenchPage
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.Storage.StorageContext import StorageContext
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
        self.move(
            desktop.width() // 2 - self.width() // 2,
            desktop.height() // 2 - self.height() // 2,
        )

        # 设置侧边栏宽度
        self.navigationInterface.setExpandWidth(256)

        # 侧边栏默认展开
        self.navigationInterface.setMinimumExpandWidth(self.APP_WIDTH)
        self.navigationInterface.expand(useAni=False)

        # 隐藏返回按钮
        self.navigationInterface.panel.setReturnButtonVisible(False)

        # 添加页面
        self.add_pages()

        # 注册事件
        self.subscribe(Base.Event.TOAST, self.toast)
        self.subscribe(Base.Event.APP_UPDATE_CHECK_DONE, self.app_update_check_done)
        self.subscribe(
            Base.Event.APP_UPDATE_DOWNLOAD_DONE, self.app_update_download_done
        )
        self.subscribe(
            Base.Event.APP_UPDATE_DOWNLOAD_ERROR, self.app_update_download_error
        )
        self.subscribe(
            Base.Event.APP_UPDATE_DOWNLOAD_UPDATE, self.app_update_download_update
        )
        self.subscribe(Base.Event.PROGRESS_TOAST_SHOW, self.progress_toast_show)
        self.subscribe(Base.Event.PROGRESS_TOAST_UPDATE, self.progress_toast_update)
        self.subscribe(Base.Event.PROGRESS_TOAST_HIDE, self.progress_toast_hide)
        self.subscribe(Base.Event.PROJECT_LOADED, self.on_project_loaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

        # 创建进度 Toast 组件（应用级别，挂载到主窗口）
        self.progress_toast = ProgressToast(self)
        self.progress_start_time: float = 0.0  # 开始显示的时间戳
        self.progress_hide_timer: QTimer | None = None  # 延迟隐藏的 timer

        # 检查更新
        QTimer.singleShot(3000, lambda: self.emit(Base.Event.APP_UPDATE_CHECK_RUN, {}))

        # 监控运行任务，动态禁用关闭项目按钮
        self.task_monitor_timer = QTimer(self)
        self.task_monitor_timer.timeout.connect(self.check_running_tasks)
        self.task_monitor_timer.start(500)

        # 记录用户在未加载工程时的页面跳转意图
        self.pending_target_interface: QWidget | None = None

    def check_running_tasks(self) -> None:
        """检查是否有后台任务运行，动态更新'关闭项目'按钮状态"""
        # 如果没有加载项目，按钮本身就是隐藏的（由 update_navigation_status 控制），无需处理
        if not StorageContext.get().is_loaded():
            return

        btn_widget = self.navigationInterface.widget("close_project_button")
        if not btn_widget:
            return

        # 检查是否繁忙：Engine 状态非 IDLE 或 有后台任务线程
        is_busy = (
            Engine.get().get_status() != Base.TaskStatus.IDLE
            or Engine.get().get_running_task_count() > 0
        )

        # 状态变更时更新
        if btn_widget.isEnabled() == is_busy:
            btn_widget.setEnabled(not is_busy)
            if is_busy:
                btn_widget.setToolTip(Localizer.get().engine_task_running)
            else:
                btn_widget.setToolTip(Localizer.get().app_close_project_btn)

    def switchTo(self, interface: QWidget):
        """切换页面"""
        # 如果未加载工程且目标页面是工程依赖页面，则重定向到工作台
        if not StorageContext.get().is_loaded() and interface != self.workbench_page:
            if self.is_project_dependent(interface):
                # 记录用户的原始意图，以便加载后跳转
                self.pending_target_interface = interface
                interface = self.workbench_page
            else:
                # 切换到非项目页面（如设置），清除之前的跳转意图
                self.pending_target_interface = None

        super().switchTo(interface)
        # 页面切换后同步更新侧边栏状态（确保在特殊跳转后状态正确）
        self.update_navigation_status()

    def update_navigation_status(self) -> None:
        """根据工程加载状态更新侧边栏导航项的可点击状态"""
        is_loaded = StorageContext.get().is_loaded()

        # 只有这些页面在未加载工程时需要彻底禁用
        disable_names = [
            "glossary_page",
            "custom_prompt_page",
            "custom_prompt_zh_page",
            "custom_prompt_en_page",
            "laboratory_page",
            "tool_box_page",
        ]

        if LogManager.get().is_expert_mode():
            disable_names.extend(
                [
                    "text_preserve_page",
                    "replacement_page",
                    "pre_translation_replacement_page",
                    "post_translation_replacement_page",
                ]
            )

        # 遍历设置状态
        for key in disable_names:
            widget = self.navigationInterface.widget(key)
            if widget:
                widget.setEnabled(is_loaded)

        # 设置关闭项目按钮的可见性
        if self.navigationInterface.widget("close_project_button"):
            self.navigationInterface.widget("close_project_button").setVisible(
                is_loaded
            )

    def is_project_dependent(self, interface: QWidget) -> bool:
        """判断页面是否依赖工程"""
        dependent_names = self.get_project_dependent_names()
        # objectName 可能包含连字符，统一处理
        name = interface.objectName().replace("-", "_")
        return name in dependent_names

    def get_project_dependent_names(self) -> list[str]:
        """获取项目依赖页面名称列表（用于 switchTo 重定向）"""
        return [
            "translation_page",
            "proofreading_page",
            "glossary_page",
            "text_preserve_page",
            "replacement_page",
            "pre_translation_replacement_page",
            "post_translation_replacement_page",
            "custom_prompt_page",
            "custom_prompt_zh_page",
            "custom_prompt_en_page",
            "laboratory_page",
            "tool_box_page",
            "ts_conversion_page",
        ]

    # 重写窗口关闭函数
    def closeEvent(self, event: QEvent) -> None:
        message_box = MessageBox(
            Localizer.get().warning, Localizer.get().app_close_message_box, self
        )
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
            title="",
            content=toast_message,
            parent=self,
            duration=toast_duration,
            orient=Qt.Orientation.Horizontal,
            position=InfoBarPosition.TOP,
            isClosable=True,
        )

    # 响应显示进度 Toast 事件
    def progress_toast_show(self, event: Base.Event, data: dict) -> None:
        # 窗口最小化时不显示，避免动画错误
        if self.isMinimized():
            return

        # 取消延迟隐藏（如果有新任务）
        if self.progress_hide_timer is not None:
            self.progress_hide_timer.stop()
            self.progress_hide_timer = None

        # 记录开始时间（如果是首次显示）
        if self.progress_start_time == 0.0:
            self.progress_start_time = time.time()

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
    def progress_toast_hide(self, event: Base.Event, data: dict) -> None:
        # 未显示时直接返回
        if self.progress_start_time == 0.0:
            return

        min_display_ms = 1500
        elapsed_ms = (time.time() - self.progress_start_time) * 1000
        remaining_ms = min_display_ms - elapsed_ms

        if remaining_ms > 0:
            # 延迟隐藏，保证最小显示时长
            self.progress_hide_timer = QTimer()
            self.progress_hide_timer.setSingleShot(True)
            self.progress_hide_timer.timeout.connect(self.do_progress_toast_hide)
            self.progress_hide_timer.start(int(remaining_ms))
        else:
            self.do_progress_toast_hide()

    def do_progress_toast_hide(self) -> None:
        """实际执行隐藏操作"""
        self.progress_hide_timer = None
        self.progress_start_time = 0.0
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
    def switch_language(self) -> None:
        message_box = MessageBox(
            Localizer.get().alert, Localizer.get().switch_language, self
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

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().switch_language_toast,
            },
        )

    # 关闭当前项目
    def close_current_project(self) -> None:
        if StorageContext.get().is_loaded():
            # 二次确认
            box = MessageBox(
                Localizer.get().warning,
                Localizer.get().workbench_msg_close_confirm,
                self,
            )
            box.yesButton.setText(Localizer.get().confirm)
            box.cancelButton.setText(Localizer.get().cancel)

            if box.exec():
                StorageContext.get().unload()
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().project_closed_toast,
                    },
                )

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
        if data.get("new_version", False):
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
            Localizer.get().app_new_version_update.replace(
                "{PERCENT}", f"{downloaded_size / max(1, total_size) * 100:.2f}%"
            )
        )

    # 开始添加页面
    def add_pages(self) -> None:
        # 创建工作台页面（不添加到侧边栏，仅在未加载工程时通过翻译/校对页面跳转）
        self.workbench_page = WorkbenchPage("workbench_page", self)
        self.stackedWidget.addWidget(self.workbench_page)

        self.add_project_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_task_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_setting_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_quality_pages()
        self.navigationInterface.addSeparator(NavigationItemPosition.SCROLL)
        self.add_extra_pages()

        # 主题切换按钮
        self.navigationInterface.addWidget(
            routeKey="theme_navigation_button",
            widget=NavigationPushButton(
                FluentIcon.CONSTRACT, Localizer.get().app_theme_btn, False
            ),
            onClick=self.switch_theme,
            position=NavigationItemPosition.BOTTOM,
        )

        # 语言切换按钮
        self.navigationInterface.addWidget(
            routeKey="language_navigation_button",
            widget=NavigationPushButton(
                FluentIcon.LANGUAGE, Localizer.get().app_language_btn, False
            ),
            onClick=self.switch_language,
            position=NavigationItemPosition.BOTTOM,
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
            routeKey="avatar_navigation_widget",
            widget=self.home_page_widget,
            onClick=self.open_project_page,
            position=NavigationItemPosition.BOTTOM,
        )

        # 设置默认页面为工作台页面
        self.switchTo(self.workbench_page)

        # 初始化侧边栏状态
        self.update_navigation_status()

    # 添加项目类页面
    def add_project_pages(self) -> None:
        # 模型管理
        self.addSubInterface(
            ModelPage("model_page", self),
            FluentIcon.IOT,
            Localizer.get().app_model_page,
            NavigationItemPosition.SCROLL,
        )

    # 添加任务类页面
    def add_task_pages(self) -> None:
        # 翻译任务
        self.translation_page = TranslationPage("translation_page", self)
        self.addSubInterface(
            self.translation_page,
            FluentIcon.TRANSPARENT,
            Localizer.get().app_translation_page,
            NavigationItemPosition.SCROLL,
        )

        # 校对任务
        self.proofreading_page = ProofreadingPage("proofreading_page", self)
        self.addSubInterface(
            self.proofreading_page,
            FluentIcon.CHECKBOX,
            Localizer.get().app_proofreading_page,
            NavigationItemPosition.SCROLL,
        )

        # 关闭项目按钮
        self.navigationInterface.addWidget(
            routeKey="close_project_button",
            widget=NavigationPushButton(
                FluentIcon.POWER_BUTTON, Localizer.get().app_close_project_btn, False
            ),
            onClick=self.close_current_project,
            position=NavigationItemPosition.SCROLL,
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
                NavigationItemPosition.SCROLL,
            )

    # 添加质量类页面
    def add_quality_pages(self) -> None:
        # 术语表
        self.glossary_page = GlossaryPage("glossary_page", self)
        self.addSubInterface(
            interface=self.glossary_page,
            icon=FluentIcon.DICTIONARY,
            text=Localizer.get().app_glossary_page,
            position=NavigationItemPosition.SCROLL,
        )

        if LogManager.get().is_expert_mode():
            # 文本保护
            self.addSubInterface(
                interface=TextPreservePage("text_preserve_page", self),
                icon=FluentIcon.VPN,
                text=Localizer.get().app_text_preserve_page,
                position=NavigationItemPosition.SCROLL,
            )

            # 文本替换
            self.text_replacement_page = EmptyPage("replacement_page", self)
            self.addSubInterface(
                interface=self.text_replacement_page,
                icon=FluentIcon.CLIPPING_TOOL,
                text=Localizer.get().app_text_replacement_page,
                position=NavigationItemPosition.SCROLL,
            )
            self.addSubInterface(
                interface=TextReplacementPage(
                    "pre_translation_replacement_page",
                    self,
                    "pre_translation_replacement",
                ),
                icon=FluentIcon.SEARCH,
                text=Localizer.get().app_pre_translation_replacement_page,
                position=NavigationItemPosition.SCROLL,
                parent=self.text_replacement_page,
            )
            self.addSubInterface(
                interface=TextReplacementPage(
                    "post_translation_replacement_page",
                    self,
                    "post_translation_replacement",
                ),
                icon=FluentIcon.SEARCH_MIRROR,
                text=Localizer.get().app_post_translation_replacement_page,
                position=NavigationItemPosition.SCROLL,
                parent=self.text_replacement_page,
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
                parent=self.custom_prompt_page,
            )
            self.addSubInterface(
                CustomPromptPage("custom_prompt_zh_page", self, BaseLanguage.Enum.ZH),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_zh_page,
                parent=self.custom_prompt_page,
            )
        else:
            self.addSubInterface(
                CustomPromptPage("custom_prompt_zh_page", self, BaseLanguage.Enum.ZH),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_zh_page,
                parent=self.custom_prompt_page,
            )
            self.addSubInterface(
                CustomPromptPage("custom_prompt_en_page", self, BaseLanguage.Enum.EN),
                FluentIcon.PENCIL_INK,
                Localizer.get().app_custom_prompt_en_page,
                parent=self.custom_prompt_page,
            )

    # 添加额外页面
    def add_extra_pages(self) -> None:
        # 实验室
        self.addSubInterface(
            interface=LaboratoryPage("laboratory_page", self),
            icon=FluentIcon.FINGERPRINT,
            text=Localizer.get().app_laboratory_page,
            position=NavigationItemPosition.SCROLL,
        )

        # 百宝箱
        self.addSubInterface(
            interface=ToolBoxPage("tool_box_page", self),
            icon=FluentIcon.TILES,
            text=Localizer.get().app_treasure_chest_page,
            position=NavigationItemPosition.SCROLL,
        )

        # 百宝箱 - 姓名字段注入
        self.name_field_extraction_page = NameFieldExtractionPage(
            "name_field_extraction_page", self
        )
        self.stackedWidget.addWidget(self.name_field_extraction_page)

        # 百宝箱 - 繁简转换
        self.ts_conversion_page = TSConversionPage("ts_conversion_page", self)
        self.stackedWidget.addWidget(self.ts_conversion_page)

    # 工程加载后的处理
    def on_project_loaded(self, event: Base.Event, data: dict) -> None:
        """工程加载后切换到翻译页面"""
        # 更新侧边栏状态
        self.update_navigation_status()

        # 优先跳转到用户之前想要访问的页面
        if self.pending_target_interface:
            self.switchTo(self.pending_target_interface)
            self.pending_target_interface = None
        else:
            self.switchTo(self.translation_page)

        # 刷新工作台最近打开列表
        self.workbench_page.refresh_recent_list()

    # 工程卸载后的处理
    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后返回工作台"""
        # 更新侧边栏状态
        self.update_navigation_status()
        self.switchTo(self.workbench_page)
