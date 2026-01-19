import time
from enum import StrEnum

from PyQt5.QtCore import Qt
from PyQt5.QtCore import QTime
from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import QHBoxLayout
from PyQt5.QtWidgets import QLayout
from PyQt5.QtWidgets import QVBoxLayout
from PyQt5.QtWidgets import QWidget
from qfluentwidgets import Action
from qfluentwidgets import CaptionLabel
from qfluentwidgets import FlowLayout
from qfluentwidgets import FluentIcon
from qfluentwidgets import FluentWindow
from qfluentwidgets import IndeterminateProgressRing
from qfluentwidgets import MessageBox
from qfluentwidgets import ProgressRing
from qfluentwidgets import ToolTipFilter
from qfluentwidgets import ToolTipPosition

from base.Base import Base
from frontend.Translation.DashboardCard import DashboardCard
from frontend.Translation.TimerMessageBox import TimerMessageBox
from module.Config import Config
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from module.SessionContext import SessionContext
from widget.CommandBarCard import CommandBarCard
from widget.WaveformWidget import WaveformWidget

class TranslationPage(QWidget, Base):
    # Token 显示模式
    class TokenDisplayMode(StrEnum):
        INPUT = "INPUT"
        OUTPUT = "OUTPUT"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        # 初始化
        self.data = {}
        self._timer_delay_time: int | None = None  # 定时器剩余秒数，None 表示未激活

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

        # 定时器
        self.ui_update_timer = QTimer(self)
        self.ui_update_timer.timeout.connect(self.update_ui_tick)
        self.ui_update_timer.start(250)

    # 页面显示事件
    def showEvent(self, event) -> None:
        super().showEvent(event)

        # 重置 frontend 状态
        self.action_continue.setEnabled(False)

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

        if status == Base.TaskStatus.IDLE:
            self.indeterminate_hide()
            self.action_start.setEnabled(True)
            self.action_stop.setEnabled(False)
            self.action_export.setEnabled(False)
            self.action_timer.setEnabled(True)
        elif status == Base.TaskStatus.TESTING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(False)
            self.action_export.setEnabled(False)
            self.action_timer.setEnabled(False)
        elif status == Base.TaskStatus.TRANSLATING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(True)
            self.action_export.setEnabled(True)
            self.action_timer.setEnabled(False)
            self._reset_timer()  # 翻译开始后自动取消定时器
        elif status == Base.TaskStatus.STOPPING:
            self.action_start.setEnabled(False)
            self.action_stop.setEnabled(False)
            self.action_export.setEnabled(False)
            self.action_timer.setEnabled(False)

        if (
            status == Base.TaskStatus.IDLE
            and data.get("status") == Base.ProjectStatus.PROCESSING
        ):
            self.action_continue.setEnabled(True)
        else:
            self.action_continue.setEnabled(False)

    def translation_done(self, event: Base.Event, data: dict) -> None:
        self.update_button_status(event, data)
        self.emit(Base.Event.PROJECT_CHECK_RUN, {})

    def translation_update(self, event: Base.Event, data: dict) -> None:
        self.data = data

    # 更新时间
    def update_time(self, data: dict) -> None:
        if Engine.get().get_status() not in (
            Base.TaskStatus.STOPPING,
            Base.TaskStatus.TRANSLATING,
        ):
            return None

        if self.data.get("start_time", 0) == 0:
            total_time = 0
        else:
            total_time = int(time.time() - self.data.get("start_time", 0))

        if total_time < 60:
            self.time.set_unit("S")
            self.time.set_value(f"{total_time}")
        elif total_time < 60 * 60:
            self.time.set_unit("M")
            self.time.set_value(f"{(total_time / 60):.2f}")
        else:
            self.time.set_unit("H")
            self.time.set_value(f"{(total_time / 60 / 60):.2f}")

        remaining_time = int(
            total_time
            / max(1, self.data.get("line", 0))
            * (self.data.get("total_line", 0) - self.data.get("line", 0))
        )
        if remaining_time < 60:
            self.remaining_time.set_unit("S")
            self.remaining_time.set_value(f"{remaining_time}")
        elif remaining_time < 60 * 60:
            self.remaining_time.set_unit("M")
            self.remaining_time.set_value(f"{(remaining_time / 60):.2f}")
        else:
            self.remaining_time.set_unit("H")
            self.remaining_time.set_value(f"{(remaining_time / 60 / 60):.2f}")

    # 更新行数
    def update_line(self, data: dict) -> None:
        if Engine.get().get_status() not in (
            Base.TaskStatus.STOPPING,
            Base.TaskStatus.TRANSLATING,
        ):
            return None

        line = self.data.get("line", 0)
        if line < 1000:
            self.line_card.set_unit("Line")
            self.line_card.set_value(f"{line}")
        elif line < 1000 * 1000:
            self.line_card.set_unit("KLine")
            self.line_card.set_value(f"{(line / 1000):.2f}")
        else:
            self.line_card.set_unit("MLine")
            self.line_card.set_value(f"{(line / 1000 / 1000):.2f}")

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
        task = Engine.get().get_running_task_count()
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
            # 兼容旧缓存：若无 total_input_tokens 字段，用 total_tokens - total_output_tokens 计算
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
        if Engine.get().get_status() not in (
            Base.TaskStatus.STOPPING,
            Base.TaskStatus.TRANSLATING,
        ):
            return None

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
        self.add_remaining_time_card(self.flow_layout, config, window)
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
        self.add_command_bar_action_continue(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_export(self.command_bar_card, config, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_timer(self.command_bar_card, config, window)

        # 添加信息条
        self.indeterminate = IndeterminateProgressRing()
        self.indeterminate.setFixedSize(16, 16)
        self.indeterminate.setStrokeWidth(3)
        self.indeterminate.hide()
        self.info_label = CaptionLabel("", self)
        self.info_label.setTextColor(QColor(96, 96, 96), QColor(160, 160, 160))
        self.info_label.hide()

        self.command_bar_card.add_stretch(1)
        self.command_bar_card.add_widget(self.info_label)
        self.command_bar_card.add_spacing(4)
        self.command_bar_card.add_widget(self.indeterminate)

    # 累计时间
    def add_time_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.time = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_time,
            value=Localizer.get().none,
            unit="",
        )
        self.time.setFixedSize(204, 204)
        parent.addWidget(self.time)

    # 剩余时间
    def add_remaining_time_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.remaining_time = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_remaining_time,
            value=Localizer.get().none,
            unit="",
        )
        self.remaining_time.setFixedSize(204, 204)
        parent.addWidget(self.remaining_time)

    # 翻译行数
    def add_line_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.line_card = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_line,
            value=Localizer.get().none,
            unit="",
        )
        self.line_card.setFixedSize(204, 204)
        parent.addWidget(self.line_card)

    # 剩余行数
    def add_remaining_line_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.remaining_line = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_remaining_line,
            value=Localizer.get().none,
            unit="",
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
            value=Localizer.get().none,
            unit="",
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
            self._animate_token_card_switch()

        self.token = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_token_output,
            value=Localizer.get().none,
            unit="",
            clicked=on_token_card_clicked,
        )
        self.token.setFixedSize(204, 204)
        self.token.setCursor(Qt.CursorShape.PointingHandCursor)
        self.token.installEventFilter(
            ToolTipFilter(self.token, 300, ToolTipPosition.TOP)
        )
        self.token.setToolTip(Localizer.get().translation_page_card_token_tooltip)
        parent.addWidget(self.token)

    def _animate_token_card_switch(self) -> None:
        """为累计消耗卡片的数值标签执行淡入淡出动效"""
        from PyQt5.QtCore import QEasingCurve
        from PyQt5.QtCore import QPropertyAnimation
        from PyQt5.QtWidgets import QGraphicsOpacityEffect

        value_label = self.token.value_label
        unit_label = self.token.unit_label

        # 为标签添加透明度效果（如果还没有的话）
        if (
            not hasattr(self, "_token_value_opacity_effect")
            or self._token_value_opacity_effect is None
        ):
            self._token_value_opacity_effect = QGraphicsOpacityEffect(value_label)
            value_label.setGraphicsEffect(self._token_value_opacity_effect)

        if (
            not hasattr(self, "_token_unit_opacity_effect")
            or self._token_unit_opacity_effect is None
        ):
            self._token_unit_opacity_effect = QGraphicsOpacityEffect(unit_label)
            unit_label.setGraphicsEffect(self._token_unit_opacity_effect)

        # 创建淡出动画
        fade_out = QPropertyAnimation(self._token_value_opacity_effect, b"opacity")
        fade_out.setDuration(100)
        fade_out.setStartValue(1.0)
        fade_out.setEndValue(0.3)
        fade_out.setEasingCurve(QEasingCurve.Type.InOutQuad)

        fade_out_unit = QPropertyAnimation(self._token_unit_opacity_effect, b"opacity")
        fade_out_unit.setDuration(100)
        fade_out_unit.setStartValue(1.0)
        fade_out_unit.setEndValue(0.3)
        fade_out_unit.setEasingCurve(QEasingCurve.Type.InOutQuad)

        # 创建淡入动画
        fade_in = QPropertyAnimation(self._token_value_opacity_effect, b"opacity")
        fade_in.setDuration(100)
        fade_in.setStartValue(0.3)
        fade_in.setEndValue(1.0)
        fade_in.setEasingCurve(QEasingCurve.Type.InOutQuad)

        fade_in_unit = QPropertyAnimation(self._token_unit_opacity_effect, b"opacity")
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
        self._token_fade_out_anim = fade_out
        self._token_fade_out_unit_anim = fade_out_unit
        self._token_fade_in_anim = fade_in
        self._token_fade_in_unit_anim = fade_in_unit

    # 并行任务
    def add_task_card(
        self, parent: QLayout, config: Config, window: FluentWindow
    ) -> None:
        self.task = DashboardCard(
            parent=self,
            title=Localizer.get().translation_page_card_task,
            value=Localizer.get().none,
            unit="",
        )
        self.task.setFixedSize(204, 204)
        parent.addWidget(self.task)

    # 开始
    def add_command_bar_action_start(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            if self.action_continue.isEnabled():
                message_box = MessageBox(
                    Localizer.get().alert,
                    Localizer.get().alert_reset_translation,
                    window,
                )
                message_box.yesButton.setText(Localizer.get().confirm)
                message_box.cancelButton.setText(Localizer.get().cancel)

                # 点击取消，则不触发开始翻译事件
                if not message_box.exec():
                    return

            self.emit(
                Base.Event.TRANSLATION_RUN,
                {
                    "status": Base.ProjectStatus.NONE,
                },
            )

        self.action_start = parent.add_action(
            Action(FluentIcon.PLAY, Localizer.get().start, parent, triggered=triggered)
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
                self.indeterminate_show(
                    Localizer.get().translation_page_indeterminate_stopping
                )
                self.emit(Base.Event.TRANSLATION_REQUIRE_STOP, {})

        self.action_stop = parent.add_action(
            Action(
                FluentIcon.CANCEL_MEDIUM,
                Localizer.get().stop,
                parent,
                triggered=triggered,
            ),
        )
        self.action_stop.setEnabled(False)

    # 继续翻译
    def add_command_bar_action_continue(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            self.emit(
                Base.Event.TRANSLATION_RUN,
                {
                    "status": Base.ProjectStatus.PROCESSING,
                },
            )

        self.action_continue = parent.add_action(
            Action(
                FluentIcon.ROTATE,
                Localizer.get().translation_page_continue,
                parent,
                triggered=triggered,
            ),
        )
        self.action_continue.setEnabled(False)

    # 导出已完成的内容
    def add_command_bar_action_export(
        self, parent: CommandBarCard, config: Config, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            # 弹框让用户确认
            message_box = MessageBox(
                Localizer.get().confirm,
                Localizer.get().translation_page_export_confirm,
                window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)

            if not message_box.exec():
                return

            self._do_export()

        self.action_export = parent.add_action(
            Action(
                FluentIcon.SHARE,
                Localizer.get().translation_page_export,
                parent,
                triggered=triggered,
            ),
        )
        self.action_export.installEventFilter(
            ToolTipFilter(self.action_export, 300, ToolTipPosition.TOP)
        )
        self.action_export.setToolTip(Localizer.get().translation_page_export_tooltip)
        self.action_export.setEnabled(False)

    def _do_export(self) -> None:
        """执行导出操作"""
        self.emit(Base.Event.TRANSLATION_EXPORT, {})
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().task_success,
            },
        )

    # 重置定时器状态
    def _reset_timer(self) -> None:
        """清除定时器倒计时状态"""
        if self._timer_delay_time is not None:
            self._timer_delay_time = None
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
            if self._timer_delay_time is None:
                return None

            if self._timer_delay_time > 0:
                self._timer_delay_time = self._timer_delay_time - interval
                self.action_timer.setText(format_time(self._timer_delay_time))
            else:
                self.emit(
                    Base.Event.TRANSLATION_RUN,
                    {
                        "status": Base.ProjectStatus.NONE,
                    },
                )
                self._reset_timer()

        def message_box_close(widget: TimerMessageBox, input_time: QTime) -> None:
            self._timer_delay_time = (
                input_time.hour() * 3600
                + input_time.minute() * 60
                + input_time.second()
            )

        def triggered() -> None:
            if self._timer_delay_time is None:
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

                self._reset_timer()

        self.action_timer = parent.add_action(
            Action(
                FluentIcon.HISTORY, Localizer.get().timer, parent, triggered=triggered
            )
        )

        # 定时检查
        timer = QTimer(self)
        timer.setInterval(interval * 1000)
        timer.timeout.connect(timer_interval)
        timer.start()

    # 显示信息条
    def indeterminate_show(self, msg: str) -> None:
        self.indeterminate.show()
        self.info_label.show()
        self.info_label.setText(msg)

    # 隐藏信息条
    def indeterminate_hide(self) -> None:
        self.indeterminate.hide()
        self.info_label.hide()
        self.info_label.setText("")
