from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QWidget
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from qfluentwidgets import FluentWindow
from qfluentwidgets import SingleDirectionScrollArea

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from widget.SpinCard import SpinCard
from widget.SwitchButtonCard import SwitchButtonCard

class ExpertSettingsPage(QWidget, Base):

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24) # 左、上、右、下

        # 创建滚动区域的内容容器
        scroll_area_vbox_widget = QWidget()
        scroll_area_vbox = QVBoxLayout(scroll_area_vbox_widget)
        scroll_area_vbox.setContentsMargins(0, 0, 0, 0)

        # 创建滚动区域
        scroll_area = SingleDirectionScrollArea(orient = Qt.Orientation.Vertical)
        scroll_area.setWidget(scroll_area_vbox_widget)
        scroll_area.setWidgetResizable(True)
        scroll_area.enableTransparentBackground()

        # 将滚动区域添加到父布局
        self.root.addWidget(scroll_area)

        # 添加控件
        self.add_widget_preceding_lines_threshold(scroll_area_vbox, config, window)
        self.add_widget_preceding_disable_on_local(scroll_area_vbox, config, window)
        self.add_widget_deduplication_in_bilingual(scroll_area_vbox, config, window)
        self.add_widget_write_translated_name_fields_to_file(scroll_area_vbox, config, window)
        self.add_widget_result_checker_retry_count_threshold(scroll_area_vbox, config, window)

        # 填充
        scroll_area_vbox.addStretch(1)

    # 参考上文行数阈值
    def add_widget_preceding_lines_threshold(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SpinCard) -> None:
            widget.set_range(0, 9999999)
            widget.set_value(config.preceding_lines_threshold)

        def value_changed(widget: SpinCard, value: int) -> None:
            config = Config().load()
            config.preceding_lines_threshold = value
            config.save()

        parent.addWidget(
            SpinCard(
                title = Localizer.get().expert_settings_page_preceding_lines_threshold,
                description = Localizer.get().expert_settings_page_preceding_lines_threshold_desc,
                init = init,
                value_changed = value_changed,
            )
        )

    # 本地接口禁用参考上文
    def add_widget_preceding_disable_on_local(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.enable_preceding_on_local)

        def checked_changed(widget: SwitchButtonCard, value: int) -> None:
            config = Config().load()
            config.enable_preceding_on_local = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().expert_settings_page_preceding_disable_on_local,
                description = Localizer.get().expert_settings_page_preceding_disable_on_local_desc,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 双语输出文件中对重复行去重
    def add_widget_deduplication_in_bilingual(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.deduplication_in_bilingual)

        def checked_changed(widget: SwitchButtonCard, value: int) -> None:
            config = Config().load()
            config.deduplication_in_bilingual = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().expert_settings_page_deduplication_in_bilingual,
                description = Localizer.get().expert_settings_page_deduplication_in_bilingual_desc,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 将姓名字段译文写入译文文件
    def add_widget_write_translated_name_fields_to_file(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.write_translated_name_fields_to_file)

        def checked_changed(widget: SwitchButtonCard, value: int) -> None:
            config = Config().load()
            config.write_translated_name_fields_to_file = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().expert_settings_page_write_translated_name_fields_to_file,
                description = Localizer.get().expert_settings_page_write_translated_name_fields_to_file_desc,
                init = init,
                checked_changed = checked_changed,
            )
        )

    # 结果检查 - 重试次数达到阈值
    def add_widget_result_checker_retry_count_threshold(self, parent: QLayout, config: Config, window: FluentWindow) -> None:

        def init(widget: SwitchButtonCard) -> None:
            widget.get_switch_button().setChecked(config.result_checker_retry_count_threshold)

        def checked_changed(widget: SwitchButtonCard, value: int) -> None:
            config = Config().load()
            config.result_checker_retry_count_threshold = widget.get_switch_button().isChecked()
            config.save()

        parent.addWidget(
            SwitchButtonCard(
                title = Localizer.get().expert_settings_page_result_checker_retry_count_threshold,
                description = Localizer.get().expert_settings_page_result_checker_retry_count_threshold_desc,
                init = init,
                checked_changed = checked_changed,
            )
        )