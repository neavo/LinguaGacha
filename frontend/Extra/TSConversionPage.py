import threading
from typing import Any

import opencc_pyo3
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import MessageBox

from base.Base import Base
from base.LogManager import LogManager
from model.Item import Item
from module.Config import Config
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.QualityRuleManager import QualityRuleManager
from module.Storage.PathStore import PathStore
from module.Storage.StorageContext import StorageContext
from module.TextProcessor import TextProcessor
from widget.ComboBoxCard import ComboBoxCard
from widget.CommandBarCard import CommandBarCard
from widget.EmptyCard import EmptyCard
from widget.SwitchButtonCard import SwitchButtonCard


class TSConversionPage(QWidget, Base):
    # 定义信号用于进度更新
    progress_updated = pyqtSignal(str, int, int)  # (message, current, total)
    progress_finished = pyqtSignal(str)  # 导出目录路径

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
        self.progress_finished.connect(self.on_progress_finished)

    # 头部
    def add_widget_head(
        self, parent: QVBoxLayout, config: Config, window: FluentWindow
    ) -> None:
        parent.addWidget(
            EmptyCard(
                title=Localizer.get().ts_conversion_page,
                description=Localizer.get().ts_conversion_page_desc,
            )
        )

    # 主体
    def add_widget_body(
        self, parent: QVBoxLayout, config: Config, window: FluentWindow
    ) -> None:
        # 转换方向设置
        self.direction_card = ComboBoxCard(
            title=Localizer.get().ts_conversion_direction,
            description=Localizer.get().ts_conversion_direction_desc,
            items=[
                Localizer.get().ts_conversion_to_simplified,
                Localizer.get().ts_conversion_to_traditional,
            ],
            init=lambda w: w.get_combo_box().setCurrentIndex(1),
        )
        parent.addWidget(self.direction_card)

        # 文本保护选项
        self.preserve_text_card = SwitchButtonCard(
            title=Localizer.get().ts_conversion_preserve_text,
            description=Localizer.get().ts_conversion_preserve_text_desc,
            init=lambda w: w.get_switch_button().setChecked(True),
        )
        parent.addWidget(self.preserve_text_card)

        # 角色名称选项
        self.target_name_card = SwitchButtonCard(
            title=Localizer.get().ts_conversion_target_name,
            description=Localizer.get().ts_conversion_target_name_desc,
            init=lambda w: w.get_switch_button().setChecked(True),
        )
        parent.addWidget(self.target_name_card)

        # 填充剩余空间
        parent.addStretch(1)

    # 底部
    def add_widget_foot(
        self, parent: QVBoxLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        def start_triggered() -> None:
            self.start_conversion()

        self.command_bar_card.add_action(
            Action(
                FluentIcon.PLAY,
                Localizer.get().ts_conversion_action_start,
                self.command_bar_card,
                triggered=start_triggered,
            )
        )

    # ================= 业务逻辑 =================

    def on_progress_updated(self, message: str, current: int, total: int) -> None:
        self.emit(
            Base.Event.PROGRESS_TOAST_UPDATE,
            {"message": message, "current": current, "total": total},
        )

    def on_progress_finished(self, output_path: str) -> None:
        self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().task_success,
            },
        )

    def start_conversion(self) -> None:
        database = StorageContext.get().get_db()
        if database is None:
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
        is_to_traditional = self.direction_card.get_combo_box().currentIndex() == 1
        convert_name = self.target_name_card.get_switch_button().isChecked()
        preserve_text = self.preserve_text_card.get_switch_button().isChecked()

        # 获取数据总量以显示进度
        items_data = database.get_all_items()
        total = len(items_data)
        if total == 0:
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().alert_no_data,
                },
            )
            return

        # 显示进度
        self.emit(
            Base.Event.PROGRESS_TOAST_SHOW,
            {
                "message": Localizer.get()
                .ts_conversion_action_progress.replace("{CURRENT}", "1")
                .replace("{TOTAL}", str(total)),
                "indeterminate": False,
                "current": 1,
                "total": total,
            },
        )

        def conversion_task() -> None:
            try:
                config = Config().load()
                text_processor = TextProcessor(config, Item())

                # 准备转换器 (使用 opencc-pyo3)
                # s2tw: 简体 -> 台湾繁体
                # t2s: 繁体 -> 简体
                converter = opencc_pyo3.OpenCC("s2tw" if is_to_traditional else "t2s")
                suffix = "_S2T" if is_to_traditional else "_T2S"

                items_to_export = []
                for index, item_data in enumerate(items_data):
                    item = Item.from_dict(item_data)
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
                            Localizer.get()
                            .ts_conversion_action_progress.replace(
                                "{CURRENT}", str(index + 1)
                            )
                            .replace("{TOTAL}", str(total)),
                            index + 1,
                            total,
                        )

                # 直接执行导出逻辑
                # 设置临时后缀
                PathStore.custom_suffix = suffix
                try:
                    file_manager = FileManager(config)
                    output_path = file_manager.write_to_path(items_to_export)
                finally:
                    # 恢复后缀
                    PathStore.custom_suffix = ""

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
        # 根据全局“文本保护”开关决定使用自定义规则还是预置规则
        rule = text_processor.get_re_check(
            custom=QualityRuleManager.get().get_text_preserve_enable(),
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
