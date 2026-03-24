from api.Client.SettingsApiClient import SettingsApiClient
from PySide6.QtCore import Qt
from PySide6.QtCore import QPoint
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from typing import Callable
from qfluentwidgets import Action
from qfluentwidgets import FluentWindow
from qfluentwidgets import PushButton
from qfluentwidgets import RoundMenu
from qfluentwidgets import SingleDirectionScrollArea
from qfluentwidgets import SpinBox
from qfluentwidgets import SwitchButton

from base.Base import Base
from base.BaseIcon import BaseIcon
from module.Localizer.Localizer import Localizer
from widget.SettingCard import SettingCard


class ExpertSettingsPage(Base, QWidget):
    def __init__(
        self,
        text: str,
        settings_api_client: SettingsApiClient,
        window: FluentWindow | None,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.settings_api_client = settings_api_client

        # 专家设置首屏统一从 API 拉快照，避免页面直连配置单例。
        settings_snapshot = self.get_settings_snapshot()

        # 设置容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(6, 24, 6, 24)  # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(18, 0, 18, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient=Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_response_check_settings(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_preceding_lines_threshold(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_clean_ruby(scroll_area_vbox, settings_snapshot, window)
        self.add_widget_deduplication_in_trans(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_deduplication_in_bilingual(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_write_translated_name_fields_to_file(
            scroll_area_vbox, settings_snapshot, window
        )
        self.add_widget_auto_process_prefix_suffix_preserved_text(
            scroll_area_vbox, settings_snapshot, window
        )

        # 填充
        scroll_area_vbox.addStretch(1)

    def get_settings_snapshot(self) -> dict[str, object]:
        """读取专家设置快照副本，避免控件散落解析返回结构。"""

        response = self.settings_api_client.get_app_settings()
        settings = response.get("settings", {})
        if isinstance(settings, dict):
            return dict(settings)
        return {}

    def update_settings(self, request: dict[str, object]) -> dict[str, object]:
        """统一通过 API 更新专家设置，并返回最新确认快照。"""

        response = self.settings_api_client.update_app_settings(request)
        settings = response.get("settings", {})
        if isinstance(settings, dict):
            return dict(settings)
        return {}

    # 结果检查规则设置
    def add_widget_response_check_settings(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        menu = RoundMenu(parent=window)

        action_check_similarity = Action(
            Localizer.get().expert_settings_page_response_check_similarity, self
        )
        action_check_similarity.setCheckable(True)
        menu.addAction(action_check_similarity)

        action_check_kana = Action(
            Localizer.get().expert_settings_page_response_check_kana_residue, self
        )
        action_check_kana.setCheckable(True)
        menu.addAction(action_check_kana)

        action_check_hangeul = Action(
            Localizer.get().expert_settings_page_response_check_hangeul_residue, self
        )
        action_check_hangeul.setCheckable(True)
        menu.addAction(action_check_hangeul)

        def sync_action_checked(snapshot: dict[str, object]) -> None:
            action_check_kana.setChecked(bool(snapshot.get("check_kana_residue", True)))
            action_check_hangeul.setChecked(
                bool(snapshot.get("check_hangeul_residue", True))
            )
            action_check_similarity.setChecked(
                bool(snapshot.get("check_similarity", True))
            )

            action_check_kana.setIcon(
                BaseIcon.CIRCLE_CHECK
                if bool(snapshot.get("check_kana_residue", True))
                else BaseIcon.CIRCLE
            )
            action_check_hangeul.setIcon(
                BaseIcon.CIRCLE_CHECK
                if bool(snapshot.get("check_hangeul_residue", True))
                else BaseIcon.CIRCLE
            )
            action_check_similarity.setIcon(
                BaseIcon.CIRCLE_CHECK
                if bool(snapshot.get("check_similarity", True))
                else BaseIcon.CIRCLE
            )

        def on_check_kana_triggered() -> None:
            latest_settings = self.update_settings(
                {"check_kana_residue": action_check_kana.isChecked()}
            )
            settings_snapshot.update(latest_settings)
            sync_action_checked(settings_snapshot)

        def on_check_hangeul_triggered() -> None:
            latest_settings = self.update_settings(
                {"check_hangeul_residue": action_check_hangeul.isChecked()}
            )
            settings_snapshot.update(latest_settings)
            sync_action_checked(settings_snapshot)

        def on_check_similarity_triggered() -> None:
            latest_settings = self.update_settings(
                {"check_similarity": action_check_similarity.isChecked()}
            )
            settings_snapshot.update(latest_settings)
            sync_action_checked(settings_snapshot)

        def before_show_menu() -> None:
            latest_settings = self.get_settings_snapshot()
            settings_snapshot.update(latest_settings)
            sync_action_checked(settings_snapshot)

        action_check_kana.triggered.connect(lambda checked: on_check_kana_triggered())
        action_check_hangeul.triggered.connect(
            lambda checked: on_check_hangeul_triggered()
        )
        action_check_similarity.triggered.connect(
            lambda checked: on_check_similarity_triggered()
        )

        card = SettingCard(
            title=Localizer.get().expert_settings_page_response_check_settings,
            description=Localizer.get().expert_settings_page_response_check_settings_desc,
            parent=self,
        )
        menu_button = PushButton(
            Localizer.get().expert_settings_page_response_check_settings_button
        )
        menu_button.clicked.connect(
            lambda checked=False: self.show_menu_for_button(
                menu_button, menu, before_show_menu
            )
        )
        card.add_right_widget(menu_button)
        sync_action_checked(settings_snapshot)

        parent.addWidget(card)

    # 参考上文行数阈值
    def add_widget_preceding_lines_threshold(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def value_changed(spin_box: SpinBox) -> None:
            self.update_settings({"preceding_lines_threshold": spin_box.value()})

        card = SettingCard(
            title=Localizer.get().expert_settings_page_preceding_lines_threshold,
            description=Localizer.get().expert_settings_page_preceding_lines_threshold_desc,
            parent=self,
        )
        spin_box = SpinBox(card)
        spin_box.setRange(0, 9999999)
        spin_box.setValue(
            int(settings_snapshot.get("preceding_lines_threshold", 0) or 0)
        )
        spin_box.valueChanged.connect(lambda value: value_changed(spin_box))
        card.add_right_widget(spin_box)
        parent.addWidget(card)

    # 清理原文中的注音文本
    def add_widget_clean_ruby(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings({"clean_ruby": button.isChecked()})

        card = SettingCard(
            title=Localizer.get().expert_settings_page_clean_ruby,
            description=Localizer.get().expert_settings_page_clean_ruby_desc,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(bool(settings_snapshot.get("clean_ruby", False)))
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # T++ 项目文件中对重复文本去重
    def add_widget_deduplication_in_trans(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings({"deduplication_in_trans": button.isChecked()})

        card = SettingCard(
            title=Localizer.get().expert_settings_page_deduplication_in_trans,
            description=Localizer.get().expert_settings_page_deduplication_in_trans_desc,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(
            bool(settings_snapshot.get("deduplication_in_trans", True))
        )
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # 双语输出文件中原文与译文一致的文本只输出一次
    def add_widget_deduplication_in_bilingual(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings({"deduplication_in_bilingual": button.isChecked()})

        card = SettingCard(
            title=Localizer.get().expert_settings_page_deduplication_in_bilingual,
            description=Localizer.get().expert_settings_page_deduplication_in_bilingual_desc,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(
            bool(settings_snapshot.get("deduplication_in_bilingual", True))
        )
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # 将姓名字段译文写入译文文件
    def add_widget_write_translated_name_fields_to_file(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings(
                {"write_translated_name_fields_to_file": button.isChecked()}
            )

        card = SettingCard(
            title=Localizer.get().expert_settings_page_write_translated_name_fields_to_file,
            description=Localizer.get().expert_settings_page_write_translated_name_fields_to_file_desc,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(
            bool(settings_snapshot.get("write_translated_name_fields_to_file", True))
        )
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    # 自动移除前后缀代码段
    def add_widget_auto_process_prefix_suffix_preserved_text(
        self,
        parent: QLayout,
        settings_snapshot: dict[str, object],
        window: FluentWindow | None,
    ) -> None:
        del window

        def checked_changed(button: SwitchButton) -> None:
            self.update_settings(
                {"auto_process_prefix_suffix_preserved_text": button.isChecked()}
            )

        card = SettingCard(
            title=Localizer.get().expert_settings_page_auto_process_prefix_suffix_preserved_text,
            description=Localizer.get().expert_settings_page_auto_process_prefix_suffix_preserved_text_desc,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(
            bool(
                settings_snapshot.get(
                    "auto_process_prefix_suffix_preserved_text",
                    True,
                )
            )
        )
        switch_button.checkedChanged.connect(
            lambda checked: checked_changed(switch_button)
        )
        card.add_right_widget(switch_button)
        parent.addWidget(card)

    def show_menu_for_button(
        self,
        button: PushButton,
        menu: RoundMenu,
        before_show: Callable[[], None],
    ) -> None:
        # 把菜单触发逻辑集中到一个入口，避免每处重复实现坐标计算。
        before_show()
        global_pos = button.mapToGlobal(QPoint(0, button.height()))
        menu.exec(global_pos)
