import time
from enum import StrEnum

from api.Client.ApiStateStore import ApiStateStore
from api.Client.TaskApiClient import TaskApiClient
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
from model.Api.TaskModels import TaskSnapshot
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.WaveformWidget import WaveformWidget

# ==================== 图标常量 ====================

ICON_ACTION_START: BaseIcon = BaseIcon.PLAY
ICON_ACTION_CONTINUE: BaseIcon = BaseIcon.ROTATE_CW
ICON_ACTION_STOP: BaseIcon = BaseIcon.CIRCLE_STOP
ICON_ACTION_RESET: BaseIcon = BaseIcon.RECYCLE
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

    def __init__(
        self,
        text: str,
        window: FluentWindow,
        task_api_client: TaskApiClient,
        api_state_store: ApiStateStore,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.task_api_client = task_api_client
        self.api_state_store = api_state_store

        self.data: TaskSnapshot | None = None
        self.is_stopping_toast_active: bool = False
        self.is_importing_glossary: bool = False
        self.analysis_candidate_count: int = 0

        self.container = QVBoxLayout(self)
        self.container.setSpacing(8)
        self.container.setContentsMargins(24, 24, 24, 24)

        self.add_widget_head(self.container)
        self.add_widget_body(self.container)
        self.add_widget_foot(self.container, window)

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
        self.refresh_analysis_snapshot()
        self.sync_task_snapshot()
        self.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    def has_progress(self) -> bool:
        """分析页和翻译页统一口径：只要存在历史进度，就保留“继续”语义。"""
        return self.get_display_snapshot().line > 0

    def refresh_analysis_snapshot(self) -> None:
        """分析页显式拉取分析快照，避免首屏被其他任务历史进度挤占。"""

        task_snapshot = self.task_api_client.get_task_snapshot(
            {"task_type": "analysis"}
        )
        self.analysis_candidate_count = task_snapshot.analysis_candidate_count
        self.data = task_snapshot

    def sync_task_snapshot(self) -> None:
        """优先消费状态仓库中的实时任务快照，分析空闲时回退到本地快照。"""

        task_snapshot = self.api_state_store.get_task_snapshot()
        if task_snapshot.task_type == "analysis":
            self.data = task_snapshot
            self.analysis_candidate_count = (
                task_snapshot.analysis_candidate_count or self.analysis_candidate_count
            )

    def get_display_snapshot(self) -> TaskSnapshot:
        """统一返回当前展示快照，避免页面散落空值判断。"""

        if self.data is None:
            return TaskSnapshot.from_dict({})
        return self.data

    def set_action_enabled(
        self, *, start: bool, stop: bool, reset: bool, import_glossary: bool
    ) -> None:
        self.action_start.setEnabled(start)
        self.action_stop.setEnabled(stop)
        self.action_reset.setEnabled(reset)
        self.action_import.setEnabled(import_glossary)

    def set_progress_ring(self, status_text: str) -> None:
        snapshot = self.get_display_snapshot()
        percent = snapshot.line / max(1, snapshot.total_line)
        self.ring.setValue(int(percent * 10000))
        self.ring.setFormat(f"{status_text}\n{percent * 100:.2f}%")

    def get_total_time(self) -> int:
        task_snapshot = self.api_state_store.get_task_snapshot()
        status = task_snapshot.status
        task_type = task_snapshot.task_type
        snapshot = self.get_display_snapshot()
        if (
            status in ("ANALYZING", "STOPPING", "RUN", "REQUEST")
            and task_type == "analysis"
        ):
            start_time = snapshot.start_time
            if start_time == 0:
                return 0
            return int(time.time() - start_time)

        return int(snapshot.time)

    def reset_card(self, card: DashboardCard, value: str, unit: str) -> None:
        card.set_value(value)
        card.set_unit(unit)

    def update_button_status(self, event: Base.Event, data: dict) -> None:
        del event
        del data
        task_snapshot = self.api_state_store.get_task_snapshot()
        status = task_snapshot.status
        is_busy = task_snapshot.busy
        task_type = task_snapshot.task_type
        is_project_loaded = self.api_state_store.is_project_loaded()

        if self.has_progress():
            self.action_start.setText(Localizer.get().analysis_page_continue)
            self.action_start.setIcon(ICON_ACTION_CONTINUE)
        else:
            self.action_start.setText(Localizer.get().start)
            self.action_start.setIcon(ICON_ACTION_START)

        if self.is_stopping_toast_active and not is_busy:
            self.emit(Base.Event.PROGRESS_TOAST, {"sub_event": Base.SubEvent.DONE})
            self.is_stopping_toast_active = False

        if self.data is None and not is_busy:
            self.clear_ui_cards()

        if not is_project_loaded:
            self.set_action_enabled(
                start=False,
                stop=False,
                reset=False,
                import_glossary=False,
            )
        elif status in ("IDLE", "DONE", "ERROR"):
            self.set_action_enabled(
                start=not self.is_importing_glossary,
                stop=False,
                reset=not self.is_importing_glossary,
                import_glossary=(
                    not self.is_importing_glossary and self.analysis_candidate_count > 0
                ),
            )
        # 命令回执的 REQUEST 已经代表“本页任务已受理”，这里先切到可停止态，
        # 避免等待下一帧 SSE 期间按钮全部置灰，造成交互回退。
        elif status in ("ANALYZING", "RUN", "REQUEST") and task_type == "analysis":
            self.set_action_enabled(
                start=False,
                stop=True,
                reset=False,
                import_glossary=False,
            )
        else:
            self.set_action_enabled(
                start=False,
                stop=False,
                reset=False,
                import_glossary=False,
            )

    def on_analysis_reset(self, event: Base.Event, data: dict) -> None:
        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.DONE and event == Base.Event.ANALYSIS_RESET_ALL:
            self.analysis_candidate_count = 0
            self.clear_ui_cards()

        if sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            self.refresh_analysis_snapshot()
        self.update_button_status(event, data)

    def on_project_source_changed(self, event: Base.Event, data: dict) -> None:
        del event, data
        self.refresh_analysis_snapshot()
        self.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    def on_project_prefilter_changed(self, event: Base.Event, data: dict) -> None:
        del event
        if data.get("sub_event") == Base.ProjectPrefilterSubEvent.UPDATED:
            self.refresh_analysis_snapshot()
            self.update_button_status(Base.Event.PROJECT_UNLOADED, {})

    def on_analysis_import_glossary(self, event: Base.Event, data: dict) -> None:
        del event
        sub_event = data.get("sub_event")
        if sub_event == Base.SubEvent.RUN:
            self.is_importing_glossary = True
        elif sub_event in (Base.SubEvent.DONE, Base.SubEvent.ERROR):
            self.is_importing_glossary = False
            self.refresh_analysis_snapshot()

        self.update_button_status(Base.Event.ANALYSIS_IMPORT_GLOSSARY, data)

    def update_ui_tick(self) -> None:
        self.sync_task_snapshot()
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
        self.command_bar_card.add_separator()
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
            self.request_start_analysis()

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
            self.request_stop_analysis()

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
        snapshot = self.get_display_snapshot()

        remaining_time = int(
            total_time
            / max(1, snapshot.line)
            * max(0, snapshot.total_line - snapshot.line)
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
        snapshot = self.get_display_snapshot()
        processed_line = snapshot.processed_line
        error_line = snapshot.error_line
        remaining_line = max(
            0,
            snapshot.total_line - snapshot.line,
        )
        self.set_scaled_card_value(self.processed_line_card, processed_line, "Line")
        self.set_scaled_card_value(self.error_line_card, error_line, "Line")
        self.set_scaled_card_value(self.remaining_line, remaining_line, "Line")

    def update_speed(self) -> None:
        task_snapshot = self.api_state_store.get_task_snapshot()
        status = task_snapshot.status
        task_type = task_snapshot.task_type
        if (
            status in ("ANALYZING", "STOPPING", "RUN", "REQUEST")
            and task_type == "analysis"
        ):
            snapshot = self.get_display_snapshot()
            speed = snapshot.total_output_tokens / max(
                1, time.time() - snapshot.start_time
            )
            self.waveform.add_value(speed)
            if speed < 1000:
                self.speed.set_unit("T/S")
                self.speed.set_value(f"{speed:.2f}")
            else:
                self.speed.set_unit("KT/S")
                self.speed.set_value(f"{(speed / 1000):.2f}")

    def update_token(self) -> None:
        snapshot = self.get_display_snapshot()
        if self.token_display_mode == self.TokenDisplayMode.OUTPUT:
            token = snapshot.total_output_tokens
        else:
            token = snapshot.total_input_tokens
            if token == 0:
                token = snapshot.total_tokens - snapshot.total_output_tokens

        self.set_scaled_card_value(self.token, token, "Token")

    def update_task(self) -> None:
        task = self.get_display_snapshot().request_in_flight_count
        self.set_scaled_card_value(self.task, task, "Task")

    def update_status(self) -> None:
        task_snapshot = self.api_state_store.get_task_snapshot()
        status = task_snapshot.status
        task_type = task_snapshot.task_type
        if status == "STOPPING" and task_type == "analysis":
            self.set_progress_ring(Localizer.get().analysis_page_status_stopping)
        elif status in ("ANALYZING", "RUN", "REQUEST") and task_type == "analysis":
            self.set_progress_ring(Localizer.get().analysis_page_status_analyzing)
        elif self.data is not None:
            self.set_progress_ring(Localizer.get().analysis_page_status_idle)
        else:
            self.ring.setValue(0)
            self.ring.setFormat(Localizer.get().analysis_page_status_idle)

    def clear_ui_cards(self) -> None:
        self.data = None
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

    def request_start_analysis(self) -> None:
        """通过 TaskApiClient 发起分析命令，并把回执写入状态仓库。"""

        mode = "CONTINUE" if self.has_progress() else "NEW"
        result = self.task_api_client.start_analysis({"mode": mode})
        self.api_state_store.hydrate_task(result)

    def request_stop_analysis(self) -> None:
        """通过 TaskApiClient 发起停止命令，并把回执写入状态仓库。"""

        result = self.task_api_client.stop_analysis()
        self.api_state_store.hydrate_task(result)
