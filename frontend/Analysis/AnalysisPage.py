import time
from enum import StrEnum

from PySide6.QtCore import QPoint
from PySide6.QtCore import Qt
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
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.WaveformWidget import WaveformWidget

# ==================== 图标常量 ====================

ICON_ACTION_START: BaseIcon = BaseIcon.PLAY
ICON_ACTION_CONTINUE: BaseIcon = BaseIcon.ROTATE_CW
ICON_ACTION_STOP: BaseIcon = BaseIcon.CIRCLE_STOP
ICON_ACTION_RESET: BaseIcon = BaseIcon.ERASER
ICON_ACTION_RESET_FAILED: BaseIcon = BaseIcon.PAINTBRUSH
ICON_ACTION_RESET_ALL: BaseIcon = BaseIcon.BRUSH_CLEANING
ICON_ACTION_IMPORT: BaseIcon = BaseIcon.FILE_DOWN


class AnalysisPage(Base, QWidget):
    class TokenDisplayMode(StrEnum):
        INPUT = "INPUT"
        OUTPUT = "OUTPUT"

    class TimeDisplayMode(StrEnum):
        REMAINING = "REMAINING"
        ELAPSED = "ELAPSED"

    def __init__(self, text: str, window: FluentWindow) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))

        self.data: dict = {}
        self.is_stopping_toast_active: bool = False
        self.is_importing_glossary: bool = False
        self.analysis_candidate_count: int = 0

        self.container = QVBoxLayout(self)
        self.container.setSpacing(8)
        self.container.setContentsMargins(24, 24, 24, 24)

        self.add_widget_head(self.container)
        self.add_widget_body(self.container)
        self.add_widget_foot(self.container, window)

        self.subscribe(Base.Event.PROJECT_CHECK, self.update_button_status)
        self.subscribe(Base.Event.APITEST, self.update_button_status)
        self.subscribe(Base.Event.ANALYSIS_TASK, self.update_button_status)
        self.subscribe(
            Base.Event.ANALYSIS_REQUEST_STOP,
            self.update_button_status,
        )
        self.subscribe(Base.Event.ANALYSIS_TASK, self.analysis_done)
        self.subscribe(Base.Event.ANALYSIS_PROGRESS, self.analysis_update)
        self.subscribe(Base.Event.ANALYSIS_RESET_ALL, self.on_analysis_reset)
        self.subscribe(Base.Event.ANALYSIS_RESET_FAILED, self.on_analysis_reset)
        self.subscribe(
            Base.Event.ANALYSIS_IMPORT_GLOSSARY,
            self.on_analysis_import_glossary,
        )
        self.subscribe(Base.Event.PROJECT_FILE_UPDATE, self.on_project_source_changed)
        self.subscribe(Base.Event.PROJECT_PREFILTER, self.on_project_prefilter_changed)
        self.subscribe(Base.Event.PROJECT_UNLOADED, self.on_project_unloaded)

        # 和翻译页保持一致，空闲时也能稳定刷新时间、任务数和波形显示。
        self.ui_update_timer = QTimer(self)
        self.ui_update_timer.timeout.connect(self.update_ui_tick)
        self.ui_update_timer.start(250)

    def showEvent(self, a0) -> None:
        super().showEvent(a0)
        self.emit(Base.Event.PROJECT_CHECK, {"sub_event": Base.SubEvent.REQUEST})

    def has_progress(self) -> bool:
        """分析页和翻译页统一口径：只要存在历史进度，就保留“继续”语义。"""
        if not isinstance(self.data, dict):
            return False
        return int(self.data.get("line", 0) or 0) > 0

    def set_action_enabled(
        self, *, start: bool, stop: bool, reset: bool, import_glossary: bool
    ) -> None:
        self.action_start.setEnabled(start)
        self.action_stop.setEnabled(stop)
        self.action_reset.setEnabled(reset)
        self.action_import.setEnabled(import_glossary)

    def should_hide_stopping_toast(self, event: Base.Event, data: dict) -> bool:
        if event == Base.Event.PROJECT_UNLOADED:
            return True

        if event == Base.Event.ANALYSIS_TASK:
            return data.get("sub_event") in (Base.SubEvent.DONE, Base.SubEvent.ERROR)

        if event in (
            Base.Event.ANALYSIS_RESET_ALL,
            Base.Event.ANALYSIS_RESET_FAILED,
        ):
            return data.get("sub_event") in (
                Base.SubEvent.DONE,
                Base.SubEvent.ERROR,
            )

        return False

    def set_progress_ring(self, status_text: str) -> None:
        percent = self.data.get("line", 0) / max(1, self.data.get("total_line", 0))
        self.ring.setValue(int(percent * 10000))
        self.ring.setFormat(f"{status_text}\n{percent * 100:.2f}%")

    def get_total_time(self) -> int:
        if Engine.get().get_status() in (
            Base.TaskStatus.ANALYZING,
            Base.TaskStatus.STOPPING,
        ):
            start_time = float(self.data.get("start_time", 0) or 0)
            if start_time == 0:
                return 0
            return int(time.time() - start_time)

        return int(self.data.get("time", 0))

    def reset_card(self, card: DashboardCard, value: str, unit: str) -> None:
        card.set_value(value)
        card.set_unit(unit)

    def update_button_status(self, event: Base.Event, data: dict) -> None:
        status = Engine.get().get_status()

        if event == Base.Event.PROJECT_CHECK:
            if data.get("sub_event") != Base.SubEvent.DONE:
                return
            self.data = dict(data.get("analysis_extras", {}))
            self.analysis_candidate_count = int(
                data.get("analysis_candidate_count") or 0
            )
            if not self.data:
                self.clear_ui_cards()
            else:
                self.update_ui_tick()

        if self.has_progress():
            self.action_start.setText(Localizer.get().analysis_page_continue)
            self.action_start.setIcon(ICON_ACTION_CONTINUE)
        else:
            self.action_start.setText(Localizer.get().start)
            self.action_start.setIcon(ICON_ACTION_START)

        if status == Base.TaskStatus.IDLE:
            if self.is_stopping_toast_active and self.should_hide_stopping_toast(
                event, data
            ):
                self.emit(Base.Event.PROGRESS_TOAST, {"sub_event": Base.SubEvent.DONE})
                self.is_stopping_toast_active = False

            self.set_action_enabled(
                start=not self.is_importing_glossary,
                stop=False,
                reset=not self.is_importing_glossary,
                import_glossary=(
                    not self.is_importing_glossary and self.analysis_candidate_count > 0
                ),
            )
        elif status == Base.TaskStatus.ANALYZING:
            self.set_action_enabled(
                start=False,
                stop=True,
                reset=False,
                import_glossary=False,
            )
        elif status in (
            Base.TaskStatus.TESTING,
            Base.TaskStatus.TRANSLATING,
            Base.TaskStatus.STOPPING,
        ):
            self.set_action_enabled(
                start=False,
                stop=False,
                reset=False,
                import_glossary=False,
            )

    def analysis_done(self, event: Base.Event, data: dict) -> None:
        if event != Base.Event.ANALYSIS_TASK:
            return
        if data.get("sub_event") not in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            return
        self.update_button_status(event, data)
        self.emit(Base.Event.PROJECT_CHECK, {"sub_event": Base.SubEvent.REQUEST})

    def analysis_update(self, event: Base.Event, data: dict) -> None:
        del event
        # 高频进度只覆盖最新快照，避免每个事件都直接重绘整页；
        # 真正的卡片刷新统一交给定时器节流入口处理。
        self.data = dict(data) if isinstance(data, dict) else {}

    def on_analysis_reset(self, event: Base.Event, data: dict) -> None:
        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.DONE and event == Base.Event.ANALYSIS_RESET_ALL:
            self.analysis_candidate_count = 0
            self.clear_ui_cards()

        self.update_button_status(event, data)
        if sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            self.emit(Base.Event.PROJECT_CHECK, {"sub_event": Base.SubEvent.REQUEST})

    def on_project_source_changed(self, event: Base.Event, data: dict) -> None:
        del event, data
        self.emit(Base.Event.PROJECT_CHECK, {"sub_event": Base.SubEvent.REQUEST})

    def on_project_prefilter_changed(self, event: Base.Event, data: dict) -> None:
        del event
        if data.get("sub_event") == Base.ProjectPrefilterSubEvent.UPDATED:
            self.emit(Base.Event.PROJECT_CHECK, {"sub_event": Base.SubEvent.REQUEST})

    def on_analysis_import_glossary(self, event: Base.Event, data: dict) -> None:
        del event
        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.RUN:
            self.is_importing_glossary = True
        elif sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            self.is_importing_glossary = False

        self.update_button_status(Base.Event.ANALYSIS_IMPORT_GLOSSARY, data)

    def update_ui_tick(self) -> None:
        self.update_time()
        self.update_line()
        self.update_speed()
        self.update_token()
        self.update_task()
        self.update_status()

    def set_scaled_card_value(
        self, card: DashboardCard, value: int, base_unit: str
    ) -> None:
        """按翻译页相同口径缩写大数值，避免分析页和翻译页展示风格不一致。"""
        if value < 1000:
            card.set_unit(base_unit)
            card.set_value(f"{value}")
        elif value < 1000 * 1000:
            card.set_unit(f"K{base_unit}")
            card.set_value(f"{(value / 1000):.2f}")
        else:
            card.set_unit(f"M{base_unit}")
            card.set_value(f"{(value / 1000 / 1000):.2f}")

    def add_widget_head(self, parent: QLayout) -> None:
        self.head_hbox_container = QWidget(self)
        self.head_hbox = QHBoxLayout(self.head_hbox_container)
        parent.addWidget(self.head_hbox_container)

        self.waveform = WaveformWidget()
        self.waveform.set_matrix_size(100, 20)

        waveform_container = QWidget()
        waveform_vbox = QVBoxLayout(waveform_container)
        waveform_vbox.addStretch(1)
        waveform_vbox.addWidget(self.waveform)

        self.ring = ProgressRing()
        self.ring.setRange(0, 10000)
        self.ring.setValue(0)
        self.ring.setTextVisible(True)
        self.ring.setStrokeWidth(12)
        self.ring.setFixedSize(140, 140)
        self.ring.setFormat(Localizer.get().analysis_page_status_idle)

        ring_container = QWidget()
        ring_vbox = QVBoxLayout(ring_container)
        ring_vbox.addStretch(1)
        ring_vbox.addWidget(self.ring)

        self.head_hbox.addWidget(ring_container)
        self.head_hbox.addSpacing(8)
        self.head_hbox.addStretch(1)
        self.head_hbox.addWidget(waveform_container)
        self.head_hbox.addStretch(1)

    def add_widget_body(self, parent: QLayout) -> None:
        self.flow_container = QWidget(self)
        self.flow_layout = FlowLayout(self.flow_container, needAni=False)
        self.flow_layout.setSpacing(8)
        self.flow_layout.setContentsMargins(0, 0, 0, 0)

        self.add_time_card(self.flow_layout)
        self.add_line_card(self.flow_layout)
        self.add_remaining_line_card(self.flow_layout)
        self.add_speed_card(self.flow_layout)
        self.add_token_card(self.flow_layout)
        self.add_task_card(self.flow_layout)

        parent.addWidget(self.flow_container, 1)

    def add_widget_foot(self, parent: QLayout, window: FluentWindow) -> None:
        self.command_bar_card = CommandBarCard()
        self.command_bar_card.set_minimum_width(640)
        parent.addWidget(self.command_bar_card)

        self.add_command_bar_action_start(self.command_bar_card)
        self.add_command_bar_action_stop(self.command_bar_card, window)
        self.command_bar_card.add_separator()
        self.add_command_bar_action_reset(self.command_bar_card, window)
        self.add_command_bar_action_import(self.command_bar_card)
        self.command_bar_card.add_stretch(1)

    def add_time_card(self, parent: QLayout) -> None:
        self.time_display_mode = self.TimeDisplayMode.REMAINING

        def on_clicked(card: DashboardCard) -> None:
            if self.time_display_mode == self.TimeDisplayMode.REMAINING:
                self.time_display_mode = self.TimeDisplayMode.ELAPSED
                card.title_label.setText(Localizer.get().analysis_page_card_time)
            else:
                self.time_display_mode = self.TimeDisplayMode.REMAINING
                card.title_label.setText(
                    Localizer.get().analysis_page_card_remaining_time
                )
            self.update_time()

        self.time = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_remaining_time,
            value="0",
            unit="S",
            clicked=on_clicked,
        )
        self.time.setFixedSize(204, 204)
        self.time.setCursor(Qt.CursorShape.PointingHandCursor)
        self.time.installEventFilter(ToolTipFilter(self.time, 300, ToolTipPosition.TOP))
        self.time.setToolTip(Localizer.get().analysis_page_card_time_tooltip)
        parent.addWidget(self.time)

    def add_line_card(self, parent: QLayout) -> None:
        self.processed_line_card = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_line_processed,
            value="0",
            unit="Line",
        )
        self.processed_line_card.setFixedSize(204, 204)
        parent.addWidget(self.processed_line_card)

        self.error_line_card = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_line_error,
            value="0",
            unit="Line",
        )
        self.error_line_card.setFixedSize(204, 204)
        self.error_line_card.installEventFilter(
            ToolTipFilter(self.error_line_card, 300, ToolTipPosition.TOP)
        )
        self.error_line_card.setToolTip(
            Localizer.get().analysis_page_card_line_error_tooltip
        )
        parent.addWidget(self.error_line_card)

    def add_remaining_line_card(self, parent: QLayout) -> None:
        self.remaining_line = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_remaining_line,
            value="0",
            unit="Line",
        )
        self.remaining_line.setFixedSize(204, 204)
        parent.addWidget(self.remaining_line)

    def add_speed_card(self, parent: QLayout) -> None:
        self.speed = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_speed,
            value="0",
            unit="T/S",
        )
        self.speed.setFixedSize(204, 204)
        parent.addWidget(self.speed)

    def add_token_card(self, parent: QLayout) -> None:
        self.token_display_mode = self.TokenDisplayMode.OUTPUT

        def on_clicked(card: DashboardCard) -> None:
            if self.token_display_mode == self.TokenDisplayMode.OUTPUT:
                self.token_display_mode = self.TokenDisplayMode.INPUT
                card.title_label.setText(Localizer.get().analysis_page_card_token_input)
            else:
                self.token_display_mode = self.TokenDisplayMode.OUTPUT
                card.title_label.setText(
                    Localizer.get().analysis_page_card_token_output
                )
            self.update_token()

        self.token = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_token_output,
            value="0",
            unit="Token",
            clicked=on_clicked,
        )
        self.token.setFixedSize(204, 204)
        self.token.setCursor(Qt.CursorShape.PointingHandCursor)
        self.token.installEventFilter(
            ToolTipFilter(self.token, 300, ToolTipPosition.TOP)
        )
        self.token.setToolTip(Localizer.get().analysis_page_card_token_tooltip)
        parent.addWidget(self.token)

    def add_task_card(self, parent: QLayout) -> None:
        self.task = DashboardCard(
            parent=self,
            title=Localizer.get().analysis_page_card_task,
            value="0",
            unit="Task",
        )
        self.task.setFixedSize(204, 204)
        parent.addWidget(self.task)

    def add_command_bar_action_start(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.emit(
                Base.Event.ANALYSIS_TASK,
                {
                    "sub_event": Base.SubEvent.REQUEST,
                    "mode": (
                        Base.AnalysisMode.CONTINUE
                        if self.has_progress()
                        else Base.AnalysisMode.NEW
                    ),
                },
            )

        self.action_start = parent.add_action(
            Action(
                ICON_ACTION_START, Localizer.get().start, parent, triggered=triggered
            )
        )

    def add_command_bar_action_stop(
        self, parent: CommandBarCard, window: FluentWindow
    ) -> None:
        def triggered() -> None:
            message_box = MessageBox(
                Localizer.get().alert,
                Localizer.get().analysis_page_alert_pause,
                window,
            )
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)
            if not message_box.exec():
                return

            self.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "message": Localizer.get().analysis_page_indeterminate_stopping,
                    "indeterminate": True,
                },
            )
            self.is_stopping_toast_active = True
            self.emit(
                Base.Event.ANALYSIS_REQUEST_STOP,
                {"sub_event": Base.SubEvent.REQUEST},
            )

        self.action_stop = parent.add_action(
            Action(ICON_ACTION_STOP, Localizer.get().stop, parent, triggered=triggered)
        )
        self.action_stop.setEnabled(False)

    def add_command_bar_action_reset(
        self, parent: CommandBarCard, window: FluentWindow
    ) -> None:
        def confirm_and_emit(message: str, reset_event: Base.Event) -> None:
            message_box = MessageBox(Localizer.get().alert, message, window)
            message_box.yesButton.setText(Localizer.get().confirm)
            message_box.cancelButton.setText(Localizer.get().cancel)
            if message_box.exec():
                self.emit(reset_event, {"sub_event": Base.SubEvent.REQUEST})

        def triggered() -> None:
            menu = RoundMenu("", self.action_reset)
            menu.addAction(
                Action(
                    ICON_ACTION_RESET_FAILED,
                    Localizer.get().analysis_page_reset_failed,
                    triggered=lambda: confirm_and_emit(
                        Localizer.get().analysis_page_alert_reset_failed,
                        Base.Event.ANALYSIS_RESET_FAILED,
                    ),
                )
            )
            menu.addSeparator()
            menu.addAction(
                Action(
                    ICON_ACTION_RESET_ALL,
                    Localizer.get().analysis_page_reset_all,
                    triggered=lambda: confirm_and_emit(
                        Localizer.get().analysis_page_alert_reset_all,
                        Base.Event.ANALYSIS_RESET_ALL,
                    ),
                )
            )
            menu.exec(
                self.action_reset.mapToGlobal(QPoint(0, 0)),
                ani=True,
                aniType=MenuAnimationType.PULL_UP,
            )

        self.action_reset = parent.add_action(
            Action(
                ICON_ACTION_RESET, Localizer.get().reset, parent, triggered=triggered
            )
        )
        self.action_reset.installEventFilter(
            ToolTipFilter(self.action_reset, 300, ToolTipPosition.TOP)
        )
        self.action_reset.setToolTip(Localizer.get().analysis_page_reset_tooltip)
        self.action_reset.setEnabled(False)

    def add_command_bar_action_import(self, parent: CommandBarCard) -> None:
        def triggered() -> None:
            self.emit(
                Base.Event.ANALYSIS_IMPORT_GLOSSARY,
                {"sub_event": Base.SubEvent.REQUEST},
            )

        self.action_import = parent.add_action(
            Action(
                ICON_ACTION_IMPORT,
                Localizer.get().analysis_page_action_import,
                parent,
                triggered=triggered,
            )
        )
        self.action_import.setEnabled(False)

    def update_time(self) -> None:
        total_time = self.get_total_time()

        remaining_time = int(
            total_time
            / max(1, self.data.get("line", 0))
            * max(0, self.data.get("total_line", 0) - self.data.get("line", 0))
        )
        display_value = remaining_time
        if self.time_display_mode == self.TimeDisplayMode.ELAPSED:
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

    def update_line(self) -> None:
        processed_line = int(self.data.get("processed_line", 0) or 0)
        error_line = int(self.data.get("error_line", 0) or 0)
        remaining_line = max(
            0,
            int(self.data.get("total_line", 0) or 0)
            - int(self.data.get("line", 0) or 0),
        )
        self.set_scaled_card_value(self.processed_line_card, processed_line, "Line")
        self.set_scaled_card_value(self.error_line_card, error_line, "Line")
        self.set_scaled_card_value(self.remaining_line, remaining_line, "Line")

    def update_speed(self) -> None:
        if Engine.get().get_status() in (
            Base.TaskStatus.ANALYZING,
            Base.TaskStatus.STOPPING,
        ):
            speed = int(self.data.get("total_output_tokens", 0) or 0) / max(
                1, time.time() - float(self.data.get("start_time", 0) or 0)
            )
            self.waveform.add_value(speed)
            if speed < 1000:
                self.speed.set_unit("T/S")
                self.speed.set_value(f"{speed:.2f}")
            else:
                self.speed.set_unit("KT/S")
                self.speed.set_value(f"{(speed / 1000):.2f}")

    def update_token(self) -> None:
        if self.token_display_mode == self.TokenDisplayMode.OUTPUT:
            token = int(self.data.get("total_output_tokens", 0) or 0)
        else:
            token = int(self.data.get("total_input_tokens", 0) or 0)
            if token == 0:
                token = int(self.data.get("total_tokens", 0) or 0) - int(
                    self.data.get("total_output_tokens", 0) or 0
                )

        self.set_scaled_card_value(self.token, token, "Token")

    def update_task(self) -> None:
        task = Engine.get().get_request_in_flight_count()
        self.set_scaled_card_value(self.task, task, "Task")

    def update_status(self) -> None:
        if Engine.get().get_status() == Base.TaskStatus.STOPPING:
            self.set_progress_ring(Localizer.get().analysis_page_status_stopping)
        elif Engine.get().get_status() == Base.TaskStatus.ANALYZING:
            self.set_progress_ring(Localizer.get().analysis_page_status_analyzing)
        elif self.data:
            self.set_progress_ring(Localizer.get().analysis_page_status_idle)
        else:
            self.ring.setValue(0)
            self.ring.setFormat(Localizer.get().analysis_page_status_idle)

    def clear_ui_cards(self) -> None:
        self.data = {}
        self.waveform.clear()
        self.ring.setValue(0)
        self.ring.setFormat(Localizer.get().analysis_page_status_idle)
        self.time_display_mode = self.TimeDisplayMode.REMAINING
        self.time.title_label.setText(Localizer.get().analysis_page_card_remaining_time)
        self.reset_card(self.time, "0", "S")
        self.reset_card(self.processed_line_card, "0", "Line")
        self.reset_card(self.error_line_card, "0", "Line")
        self.reset_card(self.remaining_line, "0", "Line")
        self.reset_card(self.speed, "0", "T/S")
        self.reset_card(self.token, "0", "Token")
        self.reset_card(self.task, "0", "Task")

    def on_project_unloaded(self, event: Base.Event, data: dict) -> None:
        del event, data
        self.analysis_candidate_count = 0
        self.is_importing_glossary = False
        self.clear_ui_cards()
        self.update_button_status(Base.Event.PROJECT_UNLOADED, {})
