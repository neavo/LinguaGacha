import threading
from typing import Any

import opencc_pyo3
from PySide6.QtCore import Signal
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import ComboBox
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox
from qfluentwidgets import SwitchButton

from base.Base import Base
from base.BaseIcon import BaseIcon
from base.LogManager import LogManager
from model.Item import Item
from module.Data.DataManager import DataManager
from module.Config import Config
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.TextProcessor import TextProcessor
from widget.CommandBarCard import CommandBarCard
from widget.SettingCard import SettingCard


# ==================== 图标常量 ====================

ICON_ACTION_START: BaseIcon = BaseIcon.PLAY  # 命令栏：开始转换


class TSConversionPage(Base, QWidget):
    # 定义信号用于进度更新
    progress_updated = Signal(str, int, int)  # (message, current, total)
    progress_show = Signal(str, int, int)  # (message, current, total)
    progress_finished = Signal(str)  # 导出目录路径

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        # 添加控件
        self.add_widget_head(self.root, config, window)
        self.add_widget_body(self.root, config, window)
        self.add_widget_foot(self.root, config, window)

        # 连接信号
        self.progress_updated.connect(self.on_progress_updated)
        self.progress_show.connect(self.on_progress_show)
        self.progress_finished.connect(self.on_progress_finished)

        self.is_converting = False

    # 头部
    def add_widget_head(self, parent: QVBoxLayout, config: Config, window: FluentWindow) -> None:
        parent.addWidget(
            SettingCard(
                title=Localizer.get().ts_conversion_page,
                description=Localizer.get().ts_conversion_page_desc,
                parent=self,
            )
        )

    # 主体
    def add_widget_body(self, parent: QVBoxLayout, config: Config, window: FluentWindow) -> None:
        # 转换方向设置
        direction_card = SettingCard(
            title=Localizer.get().ts_conversion_direction,
            description=Localizer.get().ts_conversion_direction_desc,
            parent=self,
        )
        direction_combo = ComboBox(direction_card)
        direction_combo.addItems(
            [
                Localizer.get().ts_conversion_to_simplified,
                Localizer.get().ts_conversion_to_traditional,
            ]
        )
        direction_combo.setCurrentIndex(1)
        direction_card.add_right_widget(direction_combo)
        parent.addWidget(direction_card)
        self.direction_combo = direction_combo

        # 文本保护选项
        preserve_card = SettingCard(
            title=Localizer.get().ts_conversion_preserve_text,
            description=Localizer.get().ts_conversion_preserve_text_desc,
            parent=self,
        )
        preserve_switch = SwitchButton(preserve_card)
        preserve_switch.setOnText("")
        preserve_switch.setOffText("")
        preserve_switch.setChecked(True)
        preserve_card.add_right_widget(preserve_switch)
        parent.addWidget(preserve_card)
        self.preserve_switch = preserve_switch

        # 角色名称选项
        target_name_card = SettingCard(
            title=Localizer.get().ts_conversion_target_name,
            description=Localizer.get().ts_conversion_target_name_desc,
            parent=self,
        )
        target_name_switch = SwitchButton(target_name_card)
        target_name_switch.setOnText("")
        target_name_switch.setOffText("")
        target_name_switch.setChecked(True)
        target_name_card.add_right_widget(target_name_switch)
        parent.addWidget(target_name_card)
        self.target_name_switch = target_name_switch

        # 填充剩余空间
        parent.addStretch(1)

    # 底部
    def add_widget_foot(self, parent: QVBoxLayout, config: Config, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        def start_triggered() -> None:
            self.start_conversion()

        self.command_bar_card.add_action(
            Action(
                ICON_ACTION_START,
                Localizer.get().ts_conversion_action_start,
                self.command_bar_card,
                triggered=start_triggered,
            )
        )

    # ================= 业务逻辑 =================

    def on_progress_updated(self, message: str, current: int, total: int) -> None:
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.UPDATE,
                "message": message,
                "current": current,
                "total": total,
            },
        )

    def on_progress_show(self, message: str, current: int, total: int) -> None:
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": message,
                "indeterminate": False,
                "current": current,
                "total": total,
            },
        )

    def on_progress_finished(self, output_path: str) -> None:
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {"sub_event": Base.SubEvent.DONE},
        )
        if output_path:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().task_success,
                },
            )
        else:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().task_failed,
                },
            )
        self.is_converting = False

    def start_conversion(self) -> None:
        if self.is_converting:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
            return

        if not DataManager.get().is_loaded():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().alert_no_data,
                },
            )
            return

        # 确认弹窗
        message_box = MessageBox(
            Localizer.get().alert,
            Localizer.get().ts_conversion_action_confirm,
            self.window(),
        )
        if not message_box.exec():
            return

        # 获取当前配置
        is_to_traditional = self.direction_combo.currentIndex() == 1
        convert_name = self.target_name_switch.isChecked()
        preserve_text = self.preserve_switch.isChecked()

        self.is_converting = True
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().ts_conversion_action_preparing,
                "indeterminate": True,
            },
        )

        def conversion_task() -> None:
            try:
                config = Config().load()
                text_processor = TextProcessor(config, Item())

                items_data = DataManager.get().get_all_items()
                total = len(items_data)
                if total == 0:
                    self.emit(
                        Base.Event.TOAST,
                        {
                            "type": Base.ToastType.WARNING,
                            "message": Localizer.get().alert_no_data,
                        },
                    )
                    self.progress_finished.emit("")
                    return

                self.progress_show.emit(
                    Localizer.get().ts_conversion_action_progress.replace("{CURRENT}", "1").replace("{TOTAL}", str(total)),
                    1,
                    total,
                )

                # 准备转换器 (使用 opencc_pyo3)
                # s2tw: 简体 -> 台湾繁体
                # t2s: 繁体 -> 简体
                converter = opencc_pyo3.OpenCC("s2tw" if is_to_traditional else "t2s")
                suffix = "_S2T" if is_to_traditional else "_T2S"

                items_to_export = []
                for index, item in enumerate(items_data):
                    dst = item.get_dst()

                    # 转换译文
                    if dst:
                        item.set_dst(
                            self.convert_text(
                                dst,
                                converter,
                                text_processor,
                                item.get_text_type(),
                                preserve_text,
                            )
                        )

                    # 转换人名
                    if convert_name:
                        name_dst = item.get_name_dst()
                        if isinstance(name_dst, str) and name_dst:
                            item.set_name_dst(
                                self.convert_text(
                                    name_dst,
                                    converter,
                                    text_processor,
                                    item.get_text_type(),
                                    preserve_text,
                                )
                            )
                        elif isinstance(name_dst, list):
                            new_names = [
                                self.convert_text(
                                    name,
                                    converter,
                                    text_processor,
                                    item.get_text_type(),
                                    preserve_text,
                                )
                                for name in name_dst
                            ]
                            item.set_name_dst(new_names)

                    items_to_export.append(item)

                    # 每 100 条更新一次进度，或者到最后一条
                    if (index + 1) % 100 == 0 or (index + 1) == total:
                        self.progress_updated.emit(
                            Localizer.get().ts_conversion_action_progress.replace("{CURRENT}", str(index + 1)).replace("{TOTAL}", str(total)),
                            index + 1,
                            total,
                        )

                # 直接执行导出逻辑（使用线程隔离的导出后缀上下文）
                file_manager = FileManager(config)
                with DataManager.get().export_custom_suffix_context(suffix):
                    output_path = file_manager.write_to_path(items_to_export)

                # 通知结束
                self.progress_finished.emit(output_path)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.progress_finished.emit("")

        threading.Thread(target=conversion_task, daemon=True).start()

    def convert_text(
        self,
        text: str,
        converter: Any,
        text_processor: TextProcessor,
        text_type: Item.TextType,
        preserve: bool,
    ) -> str:
        """核心转换逻辑，支持基于正则的原子化文本保护"""
        if not text:
            return text

        if not preserve:
            return converter.convert(text)

        # 获取保护规则，逻辑与 TextProcessor 保持一致
        # 实际生效逻辑由 text_preserve_mode 决定，TextProcessor 会在内部读取该值。
        rule = text_processor.get_re_check(
            custom=False,
            text_type=text_type,
        )

        if rule is None:
            return converter.convert(text)

        # 将文本分割为“受保护的标签”和“可转换的纯文本”进行分段处理
        last_end = 0
        result = []
        for match in rule.finditer(text):
            start, end = match.span()
            # 仅对非匹配区域应用 OpenCC 转换
            if start > last_end:
                result.append(converter.convert(text[last_end:start]))
            # 标签部分原样保留
            result.append(text[start:end])
            last_end = end

        # 处理末尾剩余的纯文本
        if last_end < len(text):
            result.append(converter.convert(text[last_end:]))

        return "".join(result)
