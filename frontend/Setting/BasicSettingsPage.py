from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QFileDialog
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from widget.ComboBoxCard import ComboBoxCard
from widget.SpinCard import SpinCard
from widget.SwitchButtonCard import SwitchButtonCard


class BasicSettingsPage(QWidget, Base):
    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 根据应用语言构建语言列表
        if Localizer.get_app_language() == BaseLanguage.Enum.ZH:
            self.languages = [
                BaseLanguage.get_name_zh(v) for v in BaseLanguage.get_languages()
            ]
        else:
            self.languages = [
                BaseLanguage.get_name_en(v) for v in BaseLanguage.get_languages()
            ]

        # 仅原文语言支持“全部”，译文语言保持原列表不变。
        self.source_languages = [
            Localizer.get().basic_settings_page_source_language_all
        ] + self.languages

        # 设置容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_source_language(scroll_area_vbox, config, window)
        self.add_widget_target_language(scroll_area_vbox, config, window)
        self.add_widget_project_save_mode(scroll_area_vbox, config, window)
        self.add_widget_output_folder_open_on_finish(scroll_area_vbox, config, window)
        self.add_widget_request_timeout(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

        # 翻译过程中禁用会影响过滤/翻译语义的选项，避免与翻译写库产生竞态。
        self.subscribe(Base.Event.TRANSLATION_RUN, self.on_translation_status_changed)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.on_translation_status_changed)
        self.subscribe(
            Base.Event.TRANSLATION_REQUIRE_STOP, self.on_translation_status_changed
        )
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_translation_status_changed)
        self.on_translation_status_changed(Base.Event.TRANSLATION_DONE, {})

    def on_translation_status_changed(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        status = Engine.get().get_status()
        locked = status in (Base.TaskStatus.TRANSLATING, Base.TaskStatus.STOPPING)
        if (
            hasattr(self, "source_language_card")
            and self.source_language_card is not None
        ):
            self.source_language_card.get_combo_box().setEnabled(not locked)
        if (
            hasattr(self, "target_language_card")
            and self.target_language_card is not None
        ):
            self.target_language_card.get_combo_box().setEnabled(not locked)

    # 原文语言
    def add_widget_source_language(
        self, parent: QLayout, config: Config, windows: FluentWindow
    ) -> None:
        def init(widget: ComboBoxCard) -> None:
            languages = BaseLanguage.get_languages()
            if config.source_language == BaseLanguage.ALL:
                widget.get_combo_box().setCurrentIndex(0)
            elif config.source_language in languages:
                widget.get_combo_box().setCurrentIndex(
                    languages.index(config.source_language) + 1
                )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()

            languages = BaseLanguage.get_languages()
            index = widget.get_combo_box().currentIndex()
            if index == 0:
                config.source_language = BaseLanguage.ALL
            else:
                config.source_language = languages[index - 1]

            config.save()
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["source_language"]})

        self.source_language_card = ComboBoxCard(
            Localizer.get().basic_settings_page_source_language_title,
            Localizer.get().basic_settings_page_source_language_content,
            items=self.source_languages,
            init=init,
            current_changed=current_changed,
        )
        parent.addWidget(self.source_language_card)

    # 译文语言
    def add_widget_target_language(
        self, parent: QLayout, config: Config, windows: FluentWindow
    ) -> None:
        def init(widget: ComboBoxCard) -> None:
            if config.target_language in BaseLanguage.get_languages():
                widget.get_combo_box().setCurrentIndex(
                    BaseLanguage.get_languages().index(config.target_language)
                )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()
            config.target_language = BaseLanguage.get_languages()[
                widget.get_combo_box().currentIndex()
            ]
            config.save()
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["target_language"]})

        self.target_language_card = ComboBoxCard(
            Localizer.get().basic_settings_page_target_language_title,
            Localizer.get().basic_settings_page_target_language_content,
            items=self.languages,
            init=init,
            current_changed=current_changed,
        )
        parent.addWidget(self.target_language_card)

    # 工程文件保存位置
    def add_widget_project_save_mode(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        items = [
            Localizer.get().basic_settings_page_project_save_mode_manual,
            Localizer.get().basic_settings_page_project_save_mode_fixed,
            Localizer.get().basic_settings_page_project_save_mode_source,
        ]

        def get_description(mode: str, path: str) -> str:
            if mode == Config.ProjectSaveMode.FIXED and path:
                return Localizer.get().basic_settings_page_project_save_mode_content_fixed.replace(
                    "{PATH}", path
                )
            return Localizer.get().basic_settings_page_project_save_mode_content

        def init(widget: ComboBoxCard) -> None:
            # 查找当前索引：0=MANUAL, 1=FIXED, 2=SOURCE
            index = 0
            if config.project_save_mode == Config.ProjectSaveMode.FIXED:
                index = 1
            elif config.project_save_mode == Config.ProjectSaveMode.SOURCE:
                index = 2

            widget.get_combo_box().setCurrentIndex(index)
            widget.set_description(
                get_description(config.project_save_mode, config.project_fixed_path)
            )

        def current_changed(widget: ComboBoxCard) -> None:
            config = Config().load()
            index = widget.get_combo_box().currentIndex()
            old_mode = config.project_save_mode

            # 索引映射：0=MANUAL, 1=FIXED, 2=SOURCE
            new_mode = Config.ProjectSaveMode.MANUAL
            if index == 1:
                new_mode = Config.ProjectSaveMode.FIXED

                # 切换到固定路径时弹出文件夹选择对话框
                dir_path = QFileDialog.getExistingDirectory(
                    self,
                    Localizer.get().select_folder,
                    config.project_fixed_path or "",
                )

                if dir_path:
                    config.project_fixed_path = dir_path
                else:
                    # 用户取消选择，回退到之前的模式
                    old_index = 0
                    if old_mode == Config.ProjectSaveMode.FIXED:
                        old_index = 1
                    elif old_mode == Config.ProjectSaveMode.SOURCE:
                        old_index = 2
                    widget.get_combo_box().setCurrentIndex(old_index)
                    return
            elif index == 2:
                new_mode = Config.ProjectSaveMode.SOURCE

            config.project_save_mode = new_mode
            config.save()

            # 更新描述
            widget.set_description(get_description(new_mode, config.project_fixed_path))

        parent.addWidget(
            ComboBoxCard(
                title=Localizer.get().basic_settings_page_project_save_mode_title,
                description=Localizer.get().basic_settings_page_project_save_mode_content,
                items=items,
                init=init,
                current_changed=current_changed,
            )
        )

    # 任务完成后自动打开输出文件夹
    def add_widget_output_folder_open_on_finish(
        self, parent: QLayout, config: Config, windows: FluentWindow
    ) -> None:
        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.output_folder_open_on_finish)

        def checked_changed(widget: SwitchButtonCard) -> None:
            # 更新并保存配置
            config = Config().load()
            config.output_folder_open_on_finish = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title=Localizer.get().basic_settings_page_output_folder_open_on_finish_title,
                description=Localizer.get().basic_settings_page_output_folder_open_on_finish_content,
                init=init,
                checked_changed=checked_changed,
            )
        )

    # 请求超时时间
    def add_widget_request_timeout(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        def init(widget: SpinCard) -> None:
            widget.get_spin_box().setRange(0, 9999999)
            widget.get_spin_box().setValue(config.request_timeout)

        def value_changed(widget: SpinCard) -> None:
            config = Config().load()
            config.request_timeout = widget.get_spin_box().value()
            config.save()

        parent.addWidget(
            SpinCard(
                title=Localizer.get().basic_settings_page_request_timeout_title,
                description=Localizer.get().basic_settings_page_request_timeout_content,
                init=init,
                value_changed=value_changed,
            )
        )
