from api.Client.ApiStateStore import ApiStateStore
from api.Client.SettingsApiClient import SettingsApiClient
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFileDialog
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import ComboBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import SpinBox
from qfluentwidgets import SwitchButton

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from widget.SettingCard import SettingCard


class BasicSettingsPage(Base, QWidget):
    PROJECT_SAVE_MODE_MANUAL: str = "MANUAL"
    PROJECT_SAVE_MODE_FIXED: str = "FIXED"
    PROJECT_SAVE_MODE_SOURCE: str = "SOURCE"

    def __init__(
        self,
        text: str,
        settings_api_client: SettingsApiClient,
        api_state_store: ApiStateStore,
        window: FluentWindow | None,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.settings_api_client = settings_api_client
        self.api_state_store = api_state_store

        # 基础设置首屏统一走设置 API，避免页面直接读写 Config。
        settings_snapshot = self.get_settings_snapshot()

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
        self.add_widget_source_language(scroll_area_vbox, settings_snapshot, window)
        self.add_widget_target_language(scroll_area_vbox, settings_snapshot, window)
        self.add_widget_project_save_mode(scroll_area_vbox, settings_snapshot, window)
        self.add_widget_output_folder_open_on_finish(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_request_timeout(scroll_area_vbox, settings_snapshot, window)

        # 填充
        scroll_area_vbox.addStretch(1)

        # 运行任务时禁用语言相关选项，避免与预过滤/翻译链路并发写入语义冲突。
        self.subscribe_busy_state_events(self.on_translation_status_changed)
        self.update_language_combo_enabled(self.api_state_store.is_busy())

    def get_settings_snapshot(self) -> dict[str, object]:
        """读取基础设置快照副本，避免控件散落解析返回结构。"""

        response = self.settings_api_client.get_app_settings()
        settings = response.get("settings", {})
        if isinstance(settings, dict):
            return dict(settings)
        return {}

    def update_settings(self, request: dict[str, object]) -> dict[str, object]:
        """统一通过 API 更新基础设置，并返回最新确认快照。"""

        response = self.settings_api_client.update_app_settings(request)
        settings = response.get("settings", {})
        if isinstance(settings, dict):
            return dict(settings)
        return {}

    def on_translation_status_changed(self, event: Base.Event, data: dict) -> None:
        locked = self.resolve_locked_state(event, data)
        self.update_language_combo_enabled(locked)

    def resolve_locked_state(self, event: Base.Event, data: dict) -> bool:
        """优先根据任务事件即时推导锁定态，兜底回退到状态仓库。"""

        if event in Base.RESET_PROGRESS_EVENTS:
            return not Base.is_terminal_reset_event(event, data)

        sub_event = data.get("sub_event")
        if sub_event in (Base.SubEvent.REQUEST, Base.SubEvent.RUN):
            return True
        if sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            return False
        return self.api_state_store.is_busy()

    def update_language_combo_enabled(self, locked: bool) -> None:
        """把语言控件可编辑状态集中到一个入口，避免散落重复判断。"""

        if (
            hasattr(self, "source_language_combo")
            and self.source_language_combo is not None
        ):
            self.source_language_combo.setEnabled(not locked)
        if (
            hasattr(self, "target_language_combo")
            and self.target_language_combo is not None
        ):
            self.target_language_combo.setEnabled(not locked)

    # 原文语言
    def add_widget_source_language(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        windows: FluentWindow | None,
    ) -> None:
        del windows

        def current_changed(combo_box: ComboBox) -> None:
            languages = BaseLanguage.get_languages()
            index = combo_box.currentIndex()
            if index == 0:
                source_language: BaseLanguage.Enum | str = BaseLanguage.ALL
            else:
                source_language = languages[index - 1]
            self.update_settings({"source_language": source_language})

        card = SettingCard(
            title=Localizer.get().basic_settings_page_source_language_title,
            description=Localizer.get().basic_settings_page_source_language_content,
            parent=self,
        )
        combo_box = ComboBox(card)
        combo_box.addItems(self.source_languages)

        languages = BaseLanguage.get_languages()
        source_language = settings_snapshot.get("source_language", BaseLanguage.Enum.JA)
        if source_language == BaseLanguage.ALL:
            combo_box.setCurrentIndex(0)
        elif source_language in languages:
            combo_box.setCurrentIndex(languages.index(source_language) + 1)

        combo_box.currentIndexChanged.connect(lambda index: current_changed(combo_box))
        card.add_right_widget(combo_box)

        self.source_language_combo = combo_box
        parent.addWidget(card)

    # 译文语言
    def add_widget_target_language(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        windows: FluentWindow | None,
    ) -> None:
        del windows

        def current_changed(combo_box: ComboBox) -> None:
            self.update_settings(
                {
                    "target_language": BaseLanguage.get_languages()[
                        combo_box.currentIndex()
                    ]
                }
            )

        card = SettingCard(
            title=Localizer.get().basic_settings_page_target_language_title,
            description=Localizer.get().basic_settings_page_target_language_content,
            parent=self,
        )
        combo_box = ComboBox(card)
        combo_box.addItems(self.languages)
        target_language = settings_snapshot.get("target_language", BaseLanguage.Enum.ZH)
        if target_language in BaseLanguage.get_languages():
            combo_box.setCurrentIndex(
                BaseLanguage.get_languages().index(target_language)
            )

        combo_box.currentIndexChanged.connect(lambda index: current_changed(combo_box))
        card.add_right_widget(combo_box)

        self.target_language_combo = combo_box
        parent.addWidget(card)

    # 工程文件保存位置
    def add_widget_project_save_mode(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window
        items = [
            Localizer.get().basic_settings_page_project_save_mode_manual,
            Localizer.get().basic_settings_page_project_save_mode_fixed,
            Localizer.get().basic_settings_page_project_save_mode_source,
        ]

        def get_description(mode: str, path: str) -> str:
            if mode == self.PROJECT_SAVE_MODE_FIXED and path:
                return Localizer.get().basic_settings_page_project_save_mode_content_fixed.replace(
                    "{PATH}", path
                )
            return Localizer.get().basic_settings_page_project_save_mode_content

        def current_changed(combo_box: ComboBox, card: SettingCard) -> None:
            index = combo_box.currentIndex()
            old_mode = str(settings_snapshot.get("project_save_mode", ""))
            fixed_path = str(settings_snapshot.get("project_fixed_path", ""))

            # 索引映射：0=MANUAL, 1=FIXED, 2=SOURCE
            new_mode = self.PROJECT_SAVE_MODE_MANUAL
            request: dict[str, object] = {}
            if index == 1:
                new_mode = self.PROJECT_SAVE_MODE_FIXED

                # 切换到固定路径时弹出文件夹选择对话框
                dir_path = QFileDialog.getExistingDirectory(
                    self,
                    Localizer.get().select_folder,
                    fixed_path,
                )

                if dir_path:
                    request["project_fixed_path"] = dir_path
                else:
                    # 用户取消选择，回退到之前的模式
                    old_index = 0
                    if old_mode == self.PROJECT_SAVE_MODE_FIXED:
                        old_index = 1
                    elif old_mode == self.PROJECT_SAVE_MODE_SOURCE:
                        old_index = 2
                    combo_box.setCurrentIndex(old_index)
                    return
            elif index == 2:
                new_mode = self.PROJECT_SAVE_MODE_SOURCE

            request["project_save_mode"] = new_mode
            latest_settings = self.update_settings(request)
            settings_snapshot.update(latest_settings)

            # 更新描述
            card.set_description(
                get_description(
                    str(settings_snapshot.get("project_save_mode", "")),
                    str(settings_snapshot.get("project_fixed_path", "")),
                )
            )

        card = SettingCard(
            title=Localizer.get().basic_settings_page_project_save_mode_title,
            description=Localizer.get().basic_settings_page_project_save_mode_content,
            parent=self,
        )
        combo_box = ComboBox(card)
        combo_box.addItems(items)

        # 查找当前索引：0=MANUAL, 1=FIXED, 2=SOURCE
        index = 0
        project_save_mode = str(settings_snapshot.get("project_save_mode", ""))
        if project_save_mode == self.PROJECT_SAVE_MODE_FIXED:
            index = 1
        elif project_save_mode == self.PROJECT_SAVE_MODE_SOURCE:
            index = 2
        combo_box.setCurrentIndex(index)
        card.set_description(
            get_description(
                project_save_mode,
                str(settings_snapshot.get("project_fixed_path", "")),
            )
        )

        combo_box.currentIndexChanged.connect(
            lambda index: current_changed(combo_box, card)
        )
        card.add_right_widget(combo_box)
        parent.addWidget(card)

    # 任务完成后自动打开输出文件夹
    def add_widget_output_folder_open_on_finish(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        windows: FluentWindow | None,
    ) -> None:
        del windows

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings({"output_folder_open_on_finish": button.isChecked()})

        card = SettingCard(
            title=Localizer.get().basic_settings_page_output_folder_open_on_finish_title,
            description=Localizer.get().basic_settings_page_output_folder_open_on_finish_content,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(
            bool(settings_snapshot.get("output_folder_open_on_finish", False))
        )
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # 请求超时时间
    def add_widget_request_timeout(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def value_changed(spin_box: SpinBox) -> None:
            self.update_settings({"request_timeout": spin_box.value()})

        card = SettingCard(
            title=Localizer.get().basic_settings_page_request_timeout_title,
            description=Localizer.get().basic_settings_page_request_timeout_content,
            parent=self,
        )
        spin_box = SpinBox(card)
        spin_box.setRange(0, 9999999)
        spin_box.setValue(int(settings_snapshot.get("request_timeout", 120) or 120))
        spin_box.valueChanged.connect(lambda value: value_changed(spin_box))
        card.add_right_widget(spin_box)
        parent.addWidget(card)
