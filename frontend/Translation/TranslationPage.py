import time
from enum import StrEnum

from PySide6.QtCore import QPoint
from PySide6.QtCore import Qt
from PySide6.QtCore import QTime
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QHBoxLayout
from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import FlowLayout
from qfluentwidgets import FluentWindow
from qfluentwidgets import MenuAnimationType
from qfluentwidgets import MessageBox
from qfluentwidgets import ProgressRing
from qfluentwidgets import RoundMenu
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from base.BaseIcon import BaseIcon
from frontend.Translation.DashboardCard import DashboardCard
from frontend.Translation.TimerMessageBox import TimerMessageBox
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.WaveformWidget import WaveformWidget

# ==================== 图标常量 ====================
# 统一收口本页使用到的图标，方便按语义核对（开始/停止/重置等）。

ICON_ACTION_START: BaseIcon = BaseIcon.PLAY  # 命令栏：开始翻译
ICON_ACTION_CONTINUE: BaseIcon = BaseIcon.ROTATE_CW  # 命令栏：继续/重新启动翻译
ICON_ACTION_STOP: BaseIcon = BaseIcon.CIRCLE_STOP  # 命令栏：停止翻译
ICON_ACTION_RESET: BaseIcon = BaseIcon.ERASER  # 命令栏：重置
ICON_ACTION_RESET_FAILED: BaseIcon = BaseIcon.PAINTBRUSH  # 更多菜单：重置失败项
ICON_ACTION_RESET_ALL: BaseIcon = BaseIcon.BRUSH_CLEANING  # 更多菜单：重置全部
ICON_ACTION_TIMER: BaseIcon = BaseIcon.TIMER  # 命令栏：定时器


class TranslationPage(Base, QWidget):
    # Token 显示模式
    class TokenDisplayMode(StrEnum):
        INPUT = "INPUT"
        OUTPUT = "OUTPUT"

    # 时间显示模式
    class TimeDisplayMode(StrEnum):
        REMAINING = "REMAINING"
        ELAPSED = "ELAPSED"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 初始化
        self.data = {}
        self.timer_delay_time: int | None = None  # 定时器剩余秒数，None 表示未激活
        self.is_prefiltering = False
        # 仅用于避免误关其他模块触发的进度 Toast。
        self.is_stopping_toast_active: bool = False

        # 载入并保存默认配置
        config = Config().load().save()

        # 设置主容器
        self.container = QVBoxLayout(self)
        self.container.setSpacing(8)
        self.container.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_head(self.container, config, window)
        self.add_widget_body(self.container, config, window)
        self.add_widget_foot(self.container, config, window)

        # 注册事件
        self.subscribe(Base.Event.PROJECT_CHECK_DONE, self.update_button_status)
        self.subscribe(Base.Event.APITEST_RUN, self.update_button_status)
        self.subscribe(Base.Event.APITEST_DONE, self.update_button_status)
        self.subscribe(Base.Event.TRANSLATION_RUN, self.update_button_status)
        self.subscribe(Base.Event.TRANSLATION_DONE, self.translation_done)
        self.subscribe(Base.Event.TRANSLATION_UPDATE, self.translation_update)
        self.subscribe(Base.Event.TRANSLATION_REQUIRE_STOP, self.update_button_status)
        self.subscribe(Base.Event.TRANSLATION_RESET, self.on_project_unloaded)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)
        self.subscribe(
            Base.Event.PROJECT_PREFILTER_RUN, self.on_project_prefilter_changed
        )
        self.subscribe(
            Base.Event.PROJECT_PREFILTER_DONE, self.on_project_prefilter_changed
        )

        # 定时器
        self.ui_update_timer = QTimer(self)
        self.ui_update_timer.timeout.connect(self.update_ui_tick)
        self.ui_update_timer.start(250)

    # 页面显示事件
    def showEvent(self, a0) -> None:
        super().showEvent(a0)

        # 触发事件
        self.emit(Base.Event.PROJECT_CHECK_RUN, {})

    def update_ui_tick(self) -> None:
        self.update_time(self.data)
        self.update_line(self.data)
        self.update_token(self.data)
        self.update_task(self.data)
        self.update_status(self.data)

    def update_button_status(self, event: Base.Event, data: dict) -> None:
        status = Engine.get().get_status()

        # 如果是状态检查返回，同步更新进度数据
        if event == Base.Event.PROJECT_CHECK_DONE:
            self.data = data.get("extras", {})
            # 如果进度被清空，主动重置 UI 卡片显示
            if not self.data:
                self.clear_ui_cards()

        # 判定是否有进度
        has_progress = (
            self.data.get("line", 0) > 0 if isinstance(self.data, dict) else False
        )

        # 更新开始按钮图标和文案
        if has_progress:
            self.action_start.setText(Localizer.get().translation_page_continue)
            self.action_start.setIcon(ICON_ACTION_CONTINUE)
        else:
            self.action_start.setText(Localizer.get().start)
            self.action_start.setIcon(ICON_ACTION_START)

        if status == Base.TaskStatus.IDLE:
            if self.is_stopping_toast_active and event in (
                Base.Event.TRANSLATION_DONE,
                Base.Event.TRANSLATION_RESET,
                Base.Event.PROJECT_UNLOADED,
            ):
                self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
                self.is_stopping_toast_active = False
            self.action_start.setEnabled(True)
            self.action_stop.setEnabled(False)
            self.action_reset.setEnabled(True)
            self.action_timer.setEnabled(True)
        elif status == Base.TaskStatus.TESTING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(False)
            self.action_reset.setEnabled(False)
            self.action_timer.setEnabled(False)
        elif status == Base.TaskStatus.TRANSLATING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(True)
            self.action_reset.setEnabled(False)
            self.action_timer.setEnabled(False)
            self.reset_timer()  # 翻译开始后自动取消定时器
        elif status == Base.TaskStatus.STOPPING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(False)
            self.action_reset.setEnabled(False)
            self.action_timer.setEnabled(False)

        if self.is_prefiltering:
            self.action_start.setEnabled(False)

    def on_project_prefilter_changed(self, event: Base.Event, data: dict) -> None:
        del data
        self.is_prefiltering = event == Base.Event.PROJECT_PREFILTER_RUN
        self.update_button_status(event, {})

    def translation_done(self, event: Base.Event, data: dict) -> None:
        self.update_button_status(event, data)
        self.emit(Base.Event.PROJECT_CHECK_RUN, {})

    def translation_update(self, event: Base.Event, data: dict) -> None:
        self.data = data

    # 更新时间
    def update_time(self, data: dict) -> None:
        # 如果正在翻译，计算实时耗时；否则使用最后保存的累计耗时
        if Engine.get().get_status() in (
            Base.TaskStatus.STOPPING,
            Base.TaskStatus.TRANSLATING,
        ):
            if self.data.get("start_time", 0) == 0:
                total_time = 0
            else:
                total_time = int(time.time() - self.data.get("start_time", 0))
        else:
            total_time = int(self.data.get("time", 0))

        remaining_time = int(
            total_time
            / max(1, self.data.get("line", 0))
            * (self.data.get("total_line", 0) - self.data.get("line", 0))
        )

        display_mode = getattr(
            self, "time_display_mode", self.TimeDisplayMode.REMAINING
        )
        display_value = remaining_time
        if display_mode == self.TimeDisplayMode.ELAPSED:
            display_value = total_time

        if display_value < 60:
            self.time.set_unit("S")
            self.time.set_value(f"{display_value}")
        elif display_value < 60 * 60:
            self.time.set_unit("M")
            self.time.set_value(f"{(display_value / 60):.2f}")
        else:
            self.time.set_unit("H")
            self.time.set_value(f"{(display_value / 60 / 60):.2f}")

    # 更新行数
    def update_line(self, data: dict) -> None:
        processed_line = self.data.get("processed_line", self.data.get("line", 0))
        error_line = self.data.get("error_line", 0)

        if processed_line < 1000:
            self.processed_line_card.set_unit("Line")
            self.processed_line_card.set_value(f"{processed_line}")
        elif processed_line < 1000 * 1000:
            self.processed_line_card.set_unit("KLine")
            self.processed_line_card.set_value(f"{(processed_line / 1000):.2f}")
        else:
            self.processed_line_card.set_unit("MLine")
            self.processed_line_card.set_value(f"{(processed_line / 1000 / 1000):.2f}")

        if error_line < 1000:
            self.error_line_card.set_unit("Line")
            self.error_line_card.set_value(f"{error_line}")
        elif error_line < 1000 * 1000:
            self.error_line_card.set_unit("KLine")
            self.error_line_card.set_value(f"{(error_line / 1000):.2f}")
        else:
            self.error_line_card.set_unit("MLine")
            self.error_line_card.set_value(f"{(error_line / 1000 / 1000):.2f}")

        remaining_line = self.data.get("total_line", 0) - self.data.get("line", 0)

        if remaining_line < 1000:
            self.remaining_line.set_unit("Line")
            self.remaining_line.set_value(f"{remaining_line}")
        elif remaining_line < 1000 * 1000:
            self.remaining_line.set_unit("KLine")
            self.remaining_line.set_value(f"{(remaining_line / 1000):.2f}")
        else:
            self.remaining_line.set_unit("MLine")
            self.remaining_line.set_value(f"{(remaining_line / 1000 / 1000):.2f}")

    # 更新实时任务数
    def update_task(self, data: dict) -> None:
        # UI 上的“实时任务数”仅展示正在发送请求的数量（不包含限速等待）。
        task = Engine.get().get_request_in_flight_count()
        if task < 1000:
            self.task.set_unit("Task")
            self.task.set_value(f"{task}")
        else:
            self.task.set_unit("KTask")
            self.task.set_value(f"{(task / 1000):.2f}")

    # 更新 Token 数据
    def update_token(self, data: dict) -> None:
        # 根据显示模式选择要展示的 Token 数量
        display_mode = getattr(self, "token_display_mode", self.TokenDisplayMode.OUTPUT)

        if display_mode == self.TokenDisplayMode.OUTPUT:
            token = self.data.get("total_output_tokens", 0)
        else:
            # 兼容旧版本进度字段：若无 total_input_tokens，则用 total_tokens - total_output_tokens 估算
            token = self.data.get("total_input_tokens", 0)
            if token == 0:
                token = self.data.get("total_tokens", 0) - self.data.get(
                    "total_output_tokens", 0
                )

        if token < 1000:
            self.token.set_unit("Token")
            self.token.set_value(f"{token}")
        elif token < 1000 * 1000:
            self.token.set_unit("KToken")
            self.token.set_value(f"{(token / 1000):.2f}")
        else:
            self.token.set_unit("MToken")
            self.token.set_value(f"{(token / 1000 / 1000):.2f}")

        # 速度计算仅在翻译/停止状态下更新，避免空闲时干扰波形图
        if Engine.get().get_status() in (
            Base.TaskStatus.STOPPING,
            Base.TaskStatus.TRANSLATING,
        ):
            speed = self.data.get("total_output_tokens", 0) / max(
                1, time.time() - self.data.get("start_time", 0)
            )
            self.waveform.add_value(speed)
            if speed < 1000:
                self.speed.set_unit("T/S")
                self.speed.set_value(f"{speed:.2f}")
            else:
                self.speed.set_unit("KT/S")
                self.speed.set_value(f"{(speed / 1000):.2f}")

    # 更新进度环
    def update_status(self, data: dict) -> None:
        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
            percent = self.data.get("line", 0) / max(1, self.data.get("total_line", 0))
            self.ring.setValue(int(percent * 10000))
            self.ring.setFormat(
                f"{Localizer.get().translation_page_status_stopping}\n{percent * 100:.2f}%"
            )
        elif Engine.get().get_status() == Base.TaskStatus.TRANSLATING:
            percent = self.data.get("line", 0) / max(1, self.data.get("total_line", 0))
            self.ring.setValue(int(percent * 10000))
            self.ring.setFormat(
                f"{Localizer.get().translation_page_status_translating}\n{percent * 100:.2f}%"
            )
        elif self.data:
            # 即使在空闲状态，如果存在进度数据，也要显示最终的进度百分比
            percent = self.data.get("line", 0) / max(1, self.data.get("total_line", 0))
            self.ring.setValue(int(percent * 10000))
            self.ring.setFormat(
                f"{Localizer.get().translation_page_status_idle}\n{percent * 100:.2f}%"
            )
        else:
            self.ring.setValue(0)
            self.ring.setFormat(Localizer.get().translation_page_status_idle)

    # 头部
    def add_widget_head(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.head_hbox_container = QWidget(self)
        self.head_hbox = QHBoxLayout(self.head_hbox_container)
        parent.addWidget(self.head_hbox_container)

        # 波形图
        self.waveform = WaveformWidget()
        self.waveform.set_matrix_size(100, 20)

        waveform_vbox_container = QWidget()
        waveform_vbox = QVBoxLayout(waveform_vbox_container)
        waveform_vbox.addStretch(1)
        waveform_vbox.addWidget(self.waveform)

        # 进度环
        self.ring = ProgressRing()
        self.ring.setRange(0, 10000)
        self.ring.setValue(0)
        self.ring.setTextVisible(True)
        self.ring.setStrokeWidth(12)
        self.ring.setFixedSize(140, 140)
        self.ring.setFormat(Localizer.get().translation_page_status_idle)

        ring_vbox_container = QWidget()
        ring_vbox = QVBoxLayout(ring_vbox_container)
        ring_vbox.addStretch(1)
        ring_vbox.addWidget(self.ring)

        # 添加控件
        self.head_hbox.addWidget(ring_vbox_container)
        self.head_hbox.addSpacing(8)
        self.head_hbox.addStretch(1)
        self.head_hbox.addWidget(waveform_vbox_container)
        self.head_hbox.addStretch(1)

    # 中部
    def add_widget_body(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.flow_container = QWidget(self)
        self.flow_layout = FlowLayout(self.flow_container, needAni=False)
        self.flow_layout.setSpacing(8)
        self.flow_layout.setContentsMargins(0, 0, 0, 0)

        self.add_time_card(self.flow_layout, config, window)
        self.add_line_card(self.flow_layout, config, window)
        self.add_remaining_line_card(self.flow_layout, config, window)
        self.add_speed_card(self.flow_layout, config, window)
        self.add_token_card(self.flow_layout, config, window)
        self.add_task_card(self.flow_layout, config, window)

        self.container.addWidget(self.flow_container, 1)

    # 底部
    def add_widget_foot(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.command_bar_card = CommandBarCard()
        parent.addWidget(self.command_bar_card)

        # 添加命令
        self.command_bar_card.set_minimum_width(640)
        self.add_command_bar_action_start(self.command_bar_card, config, window)
        self.add_command_bar_action_stop(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_reset(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_timer(self.command_bar_card, config, window)

        self.command_bar_card.add_stretch(1)

    # 累计时间
    def add_time_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.time_display_mode = self.TimeDisplayMode.REMAINING

        def on_time_card_clicked(card: DashboardCard) -> None:
            if self.time_display_mode == self.TimeDisplayMode.REMAINING:
                self.time_display_mode = self.TimeDisplayMode.ELAPSED
                card.title_label.setText(Localizer.get().translation_page_card_time)
            else:
                self.time_display_mode = self.TimeDisplayMode.REMAINING
                card.title_label.setText(
                    Localizer.get().translation_page_card_remaining_time
                )

            self.update_time(self.data)

        self.time = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_remaining_time,
            value="0",
            unit="S",
            clicked=on_time_card_clicked,
        )
        self.time.setFixedSize(204, 204)
        self.time.setCursor(Qt.CursorShape.PointingHandCursor)
        self.time.installEventFilter(ToolTipFilter(self.time, 300, ToolTipPosition.TOP))
        self.time.setToolTip(Localizer.get().translation_page_card_time_tooltip)
        parent.addWidget(self.time)

    # 翻译行数
    def add_line_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.processed_line_card = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_line_processed,
            value="0",
            unit="Line",
        )
        self.processed_line_card.setFixedSize(204, 204)
        parent.addWidget(self.processed_line_card)

        self.error_line_card = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_line_error,
            value="0",
            unit="Line",
        )
        self.error_line_card.setFixedSize(204, 204)
        self.error_line_card.installEventFilter(
            ToolTipFilter(self.error_line_card, 300, ToolTipPosition.TOP)
        )
        self.error_line_card.setToolTip(
            Localizer.get().translation_page_card_line_error_tooltip
        )
        parent.addWidget(self.error_line_card)

    # 剩余行数
    def add_remaining_line_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.remaining_line = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_remaining_line,
            value="0",
            unit="Line",
        )
        self.remaining_line.setFixedSize(204, 204)
        parent.addWidget(self.remaining_line)

    # 平均速度
    def add_speed_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.speed = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_speed,
            value="0",
            unit="T/S",
        )
        self.speed.setFixedSize(204, 204)
        parent.addWidget(self.speed)

    # 累计消耗
    def add_token_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        # 默认显示输出 Token
        self.token_display_mode = self.TokenDisplayMode.OUTPUT

        def on_token_card_clicked(card: DashboardCard) -> None:
            # 切换显示模式
            if self.token_display_mode == self.TokenDisplayMode.OUTPUT:
                self.token_display_mode = self.TokenDisplayMode.INPUT
                card.title_label.setText(
                    Localizer.get().translation_page_card_token_input
                )
            else:
                self.token_display_mode = self.TokenDisplayMode.OUTPUT
                card.title_label.setText(
                    Localizer.get().translation_page_card_token_output
                )

            # 应用淡入淡出动效
            self.animate_token_card_switch()

        self.token = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_token_output,
            value="0",
            unit="Token",
            clicked=on_token_card_clicked,
        )
        self.token.setFixedSize(204, 204)
        self.token.setCursor(Qt.CursorShape.PointingHandCursor)
        self.token.installEventFilter(
            ToolTipFilter(self.token, 300, ToolTipPosition.TOP)
        )
        self.token.setToolTip(Localizer.get().translation_page_card_token_tooltip)
        parent.addWidget(self.token)

    def animate_token_card_switch(self) -> None:
        """为累计消耗卡片的数值标签执行淡入淡出动效"""
        from PySide6.QtCore import QEasingCurve
        from PySide6.QtCore import QPropertyAnimation
        from PySide6.QtWidgets import QGraphicsOpacityEffect

        value_label = self.token.value_label
        unit_label = self.token.unit_label

        # 为标签添加透明度效果（如果还没有的话）
        if (
            not hasattr(self, "token_value_opacity_effect")
            or self.token_value_opacity_effect is None
        ):
            self.token_value_opacity_effect = QGraphicsOpacityEffect(value_label)
            value_label.setGraphicsEffect(self.token_value_opacity_effect)

        if (
            not hasattr(self, "token_unit_opacity_effect")
            or self.token_unit_opacity_effect is None
        ):
            self.token_unit_opacity_effect = QGraphicsOpacityEffect(unit_label)
            unit_label.setGraphicsEffect(self.token_unit_opacity_effect)

        # 创建淡出动画
        fade_out = QPropertyAnimation(self.token_value_opacity_effect, b"opacity")
        fade_out.setDuration(100)
        fade_out.setStartValue(1.0)
        fade_out.setEndValue(0.3)
        fade_out.setEasingCurve(QEasingCurve.Type.InOutQuad)

        fade_out_unit = QPropertyAnimation(self.token_unit_opacity_effect, b"opacity")
        fade_out_unit.setDuration(100)
        fade_out_unit.setStartValue(1.0)
        fade_out_unit.setEndValue(0.3)
        fade_out_unit.setEasingCurve(QEasingCurve.Type.InOutQuad)

        # 创建淡入动画
        fade_in = QPropertyAnimation(self.token_value_opacity_effect, b"opacity")
        fade_in.setDuration(100)
        fade_in.setStartValue(0.3)
        fade_in.setEndValue(1.0)
        fade_in.setEasingCurve(QEasingCurve.Type.InOutQuad)

        fade_in_unit = QPropertyAnimation(self.token_unit_opacity_effect, b"opacity")
        fade_in_unit.setDuration(100)
        fade_in_unit.setStartValue(0.3)
        fade_in_unit.setEndValue(1.0)
        fade_in_unit.setEasingCurve(QEasingCurve.Type.InOutQuad)

        # 淡出完成后更新数据并开始淡入
        def on_fade_out_finished() -> None:
            self.update_token(self.data)
            fade_in.start()
            fade_in_unit.start()

        fade_out.finished.connect(on_fade_out_finished)
        fade_out.start()
        fade_out_unit.start()

        # 保持动画引用避免被垃圾回收
        self.token_fade_out_anim = fade_out
        self.token_fade_out_unit_anim = fade_out_unit
        self.token_fade_in_anim = fade_in
        self.token_fade_in_unit_anim = fade_in_unit

    # 并行任务
    def add_task_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.task = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_task,
            value="0",
            unit="Task",
        )
        self.task.setFixedSize(204, 204)
        parent.addWidget(self.task)

    # 开始
    def add_command_bar_action_start(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            # 根据是否有进度决定模式：有进度则 CONTINUE，无进度则 NEW
            has_progress = (
                self.data.get("line", 0) > 0 if isinstance(self.data, dict) else False
            )

            self.emit(
                Base.Event.TRANSLATION_RUN,
                {
                    "mode": Base.TranslationMode.CONTINUE
                    if has_progress
                    else Base.TranslationMode.NEW,
                },
            )

        self.action_start = parent.add_action(
            Action(
                ICON_ACTION_START, Localizer.get().start, parent, triggered=triggered
            )
        )

    # 停止
    def add_command_bar_action_stop(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            message_box = MessageBox(
                Localizer.get().alert,
                Localizer.get().translation_page_alert_pause,
                window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            # 确认则触发停止翻译事件
            if message_box.exec():
                self.emit(
                    Base.Event.PROGRESS_TOAST_SHOW,
                    {
                        "message": Localizer.get().translation_page_indeterminate_stopping,
                        "indeterminate": True,
                    },
                )
                self.is_stopping_toast_active = True
                self.emit(Base.Event.TRANSLATION_REQUIRE_STOP, {})

        self.action_stop = parent.add_action(
            Action(
                ICON_ACTION_STOP,
                Localizer.get().stop,
                parent,
                triggered=triggered,
            ),
        )
        self.action_stop.setEnabled(False)

    # 重置翻译进度
    def add_command_bar_action_reset(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            def confirm_and_emit(message: str, event: Base.Event) -> None:
                message_box = MessageBox(Localizer.get().alert, message, window)
                message_box.yesButton.setText(Localizer.get().confirm)
                message_box.cancelButton.setText(Localizer.get().cancel)

                if message_box.exec():
                    self.emit(event, {})

            menu = RoundMenu("", self.action_reset)
            menu.addAction(
                Action(
                    ICON_ACTION_RESET_FAILED,
                    Localizer.get().translation_page_reset_failed,
                    triggered=lambda: confirm_and_emit(
                        Localizer.get().translation_page_alert_reset_failed,
                        Base.Event.TRANSLATION_RESET_FAILED,
                    ),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    ICON_ACTION_RESET_ALL,
                    Localizer.get().translation_page_reset_all,
                    triggered=lambda: confirm_and_emit(
                        Localizer.get().translation_page_alert_reset_all,
                        Base.Event.TRANSLATION_RESET,
                    ),
                )
            )
            global_pos = self.action_reset.mapToGlobal(QPoint(0, 0))
            menu.exec(global_pos, ani=True, aniType=MenuAnimationType.PULL_UP)

        self.action_reset = parent.add_action(
            Action(
                ICON_ACTION_RESET,
                Localizer.get().reset,
                parent,
                triggered=triggered,
            ),
        )
        self.action_reset.installEventFilter(
            ToolTipFilter(self.action_reset, 300, ToolTipPosition.TOP)
        )
        self.action_reset.setToolTip(Localizer.get().translation_page_reset_tooltip)
        self.action_reset.setEnabled(False)

    # 重置定时器状态
    def reset_timer(self) -> None:
        """清除定时器倒计时状态"""
        if self.timer_delay_time is not None:
            self.timer_delay_time = None
            self.action_timer.setText(Localizer.get().timer)

    # 定时器
    def add_command_bar_action_timer(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        interval = 1

        def format_time(full: int) -> str:
            hours = int(full / 3600)
            minutes = int((full - hours * 3600) / 60)
            seconds = full - hours * 3600 - minutes * 60

            return f"{hours:02}:{minutes:02}:{seconds:02}"

        def timer_interval() -> None:
            if self.timer_delay_time is None:
                return None

            if self.timer_delay_time > 0:
                self.timer_delay_time = self.timer_delay_time - interval
                self.action_timer.setText(format_time(self.timer_delay_time))
            else:
                self.emit(
                    Base.Event.TRANSLATION_RUN,
                    {
                        "status": Base.ProjectStatus.NONE,
                    },
                )
                self.reset_timer()

        def message_box_close(widget: TimerMessageBox, input_time: QTime) -> None:
            self.timer_delay_time = (
                input_time.hour() * 3600
                + input_time.minute() * 60
                + input_time.second()
            )

        def triggered() -> None:
            if self.timer_delay_time is None:
                TimerMessageBox(
                    parent=window,
                    title=Localizer.get().translation_page_timer,
                    message_box_close=message_box_close,
                ).exec()
            else:
                message_box = MessageBox(
                    Localizer.get().alert, Localizer.get().alert_reset_timer, window
                )
                message_box.yesButton.setText(Localizer.get().confirm)
                message_box.cancelButton.setText(Localizer.get().cancel)

                # 点击确认则取消定时器
                if not message_box.exec():
                    return

                self.reset_timer()

        self.action_timer = parent.add_action(
            Action(
                ICON_ACTION_TIMER, Localizer.get().timer, parent, triggered=triggered
            )
        )

        # 定时检查
        timer = QTimer(self)
        timer.setInterval(interval * 1000)
        timer.timeout.connect(timer_interval)
        timer.start()

    def clear_ui_cards(self) -> None:
        """清理所有 UI 卡片和进度显示"""
        self.data = {}
        self.waveform.clear()
        self.ring.setValue(0)
        self.ring.setFormat(Localizer.get().translation_page_status_idle)

        # 重置卡片数据
        self.time_display_mode = self.TimeDisplayMode.REMAINING
        self.time.title_label.setText(
            Localizer.get().translation_page_card_remaining_time
        )
        self.time.set_value("0")
        self.time.set_unit("S")
        self.processed_line_card.set_value("0")
        self.processed_line_card.set_unit("Line")
        self.error_line_card.set_value("0")
        self.error_line_card.set_unit("Line")
        self.remaining_line.set_value("0")
        self.remaining_line.set_unit("Line")
        self.speed.set_value("0")
        self.speed.set_unit("T/S")
        self.token.set_value("0")
        self.token.set_unit("Token")
        self.task.set_value("0")
        self.task.set_unit("Task")

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        """工程卸载后清理数据"""
        self.clear_ui_cards()

        # 重置按钮状态
        self.update_button_status(event, {"status": Base.ProjectStatus.NONE})

        # 重置定时器
        self.reset_timer()
