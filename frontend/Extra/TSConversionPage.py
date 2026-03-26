import threading

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ExtraApiClient import ExtraApiClient
from PySide6.QtCore import Signal
from PySide6.QtCore import QTimer
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
from model.Api.ExtraModels import ExtraTaskState
from model.Api.ExtraModels import TsConversionOptionsSnapshot
from model.Api.ExtraModels import TsConversionTaskAccepted
from module.Localizer.Localizer import Localizer
from widget.CommandBarCard import CommandBarCard
from widget.SettingCard import SettingCard


ICON_ACTION_START: BaseIcon = BaseIcon.PLAY  # 命令栏：开始转换


class TSConversionPage(Base, QWidget):
    """繁简转换页通过 Extra API 与状态仓库协作，避免继续直连 Core 单例。"""

    options_loaded = Signal(object)
    start_finished = Signal(object)
    start_failed = Signal()

    DEFAULT_TASK_ID: str = "extra_ts_conversion"
    DEFAULT_DIRECTION_TO_TRADITIONAL: str = "TO_TRADITIONAL"
    DEFAULT_DIRECTION_TO_SIMPLIFIED: str = "TO_SIMPLIFIED"
    UI_UPDATE_INTERVAL_MS: int = 250

    def __init__(
        self,
        text: str,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None = None,
        api_state_store: ApiStateStore | None = None,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.extra_api_client = self.resolve_extra_api_client(window, extra_api_client)
        self.api_state_store = self.resolve_api_state_store(window, api_state_store)
        self.active_task_id: str = ""
        self.awaiting_active_task_state: bool = False
        self.has_seen_active_task_state: bool = False
        self.progress_toast_visible: bool = False

        options_snapshot = self.build_default_options_snapshot()

        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)

        self.add_widget_head(self.root)
        self.add_widget_body(self.root, options_snapshot)
        self.add_widget_foot(self.root)

        self.ui_update_timer = QTimer(self)
        self.ui_update_timer.timeout.connect(self.update_progress_from_state_store)
        self.ui_update_timer.start(self.UI_UPDATE_INTERVAL_MS)

        # 通过 Qt 信号把后台线程结果切回 UI 线程，避免工作线程直接碰控件。
        self.options_loaded.connect(self.apply_options_snapshot)
        self.start_finished.connect(self.handle_start_result)
        self.start_failed.connect(self.handle_start_failure)
        self.load_ts_conversion_options_in_background()

    def resolve_extra_api_client(
        self,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None,
    ) -> ExtraApiClient | None:
        """优先使用显式注入，其次兼容窗口上下文，避免当前任务越界改 wiring。"""

        resolved_client = extra_api_client
        if resolved_client is None and window is not None:
            window_client = getattr(window, "extra_api_client", None)
            if isinstance(window_client, ExtraApiClient):
                resolved_client = window_client
            else:
                app_client_context = getattr(window, "app_client_context", None)
                context_client = getattr(app_client_context, "extra_api_client", None)
                if isinstance(context_client, ExtraApiClient):
                    resolved_client = context_client
        return resolved_client

    def resolve_api_state_store(
        self,
        window: FluentWindow | None,
        api_state_store: ApiStateStore | None,
    ) -> ApiStateStore | None:
        """统一读取状态仓库，保证页面的工程态与任务态都有单一来源。"""

        resolved_store = api_state_store
        if resolved_store is None and window is not None:
            window_store = getattr(window, "api_state_store", None)
            if isinstance(window_store, ApiStateStore):
                resolved_store = window_store
            else:
                app_client_context = getattr(window, "app_client_context", None)
                context_store = getattr(app_client_context, "api_state_store", None)
                if isinstance(context_store, ApiStateStore):
                    resolved_store = context_store
        return resolved_store

    def build_default_options_snapshot(self) -> TsConversionOptionsSnapshot:
        """缺少真实客户端时保留同源默认值，避免 UI 与服务层默认行为漂移。"""

        return TsConversionOptionsSnapshot.from_dict(
            {
                "default_direction": self.DEFAULT_DIRECTION_TO_TRADITIONAL,
                "preserve_text_enabled": True,
                "convert_name_enabled": True,
            }
        )

    def load_ts_conversion_options_in_background(self) -> None:
        """初始化阶段只在后台取 options，失败时继续沿用默认值避免阻塞首屏。"""

        client = self.extra_api_client
        if client is None:
            return

        def task() -> None:
            snapshot = self.build_default_options_snapshot()
            try:
                snapshot = client.get_ts_conversion_options()
            except Exception as e:
                LogManager.get().warning("繁简转换选项加载失败，已回退默认选项", e)
            self.options_loaded.emit(snapshot)

        threading.Thread(target=task, daemon=True).start()

    def apply_options_snapshot(self, snapshot: object) -> None:
        """统一消费后台拿到的 options 快照，避免控件状态被多个入口各自改写。"""

        options_snapshot = snapshot
        if not isinstance(options_snapshot, TsConversionOptionsSnapshot):
            options_snapshot = self.build_default_options_snapshot()

        self.direction_combo.setCurrentIndex(
            self.get_direction_index(options_snapshot.default_direction)
        )
        self.preserve_switch.setChecked(options_snapshot.preserve_text_enabled)
        self.target_name_switch.setChecked(options_snapshot.convert_name_enabled)

    def add_widget_head(self, parent: QVBoxLayout) -> None:
        parent.addWidget(
            SettingCard(
                title=Localizer.get().ts_conversion_page,
                description=Localizer.get().ts_conversion_page_desc,
                parent=self,
            )
        )

    def add_widget_body(
        self,
        parent: QVBoxLayout,
        options_snapshot: TsConversionOptionsSnapshot,
    ) -> None:
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
        direction_combo.setCurrentIndex(
            self.get_direction_index(options_snapshot.default_direction)
        )
        direction_card.add_right_widget(direction_combo)
        parent.addWidget(direction_card)
        self.direction_combo = direction_combo

        preserve_card = SettingCard(
            title=Localizer.get().ts_conversion_preserve_text,
            description=Localizer.get().ts_conversion_preserve_text_desc,
            parent=self,
        )
        preserve_switch = SwitchButton(preserve_card)
        preserve_switch.setOnText("")
        preserve_switch.setOffText("")
        preserve_switch.setChecked(options_snapshot.preserve_text_enabled)
        preserve_card.add_right_widget(preserve_switch)
        parent.addWidget(preserve_card)
        self.preserve_switch = preserve_switch

        target_name_card = SettingCard(
            title=Localizer.get().ts_conversion_target_name,
            description=Localizer.get().ts_conversion_target_name_desc,
            parent=self,
        )
        target_name_switch = SwitchButton(target_name_card)
        target_name_switch.setOnText("")
        target_name_switch.setOffText("")
        target_name_switch.setChecked(options_snapshot.convert_name_enabled)
        target_name_card.add_right_widget(target_name_switch)
        parent.addWidget(target_name_card)
        self.target_name_switch = target_name_switch

        parent.addStretch(1)

    def add_widget_foot(self, parent: QVBoxLayout) -> None:
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

    def get_direction_index(self, direction: str) -> int:
        """把服务端方向值映射到下拉框索引，避免页面各处重复写协议分支。"""

        index = 1
        if direction == self.DEFAULT_DIRECTION_TO_SIMPLIFIED:
            index = 0
        return index

    def get_current_direction(self) -> str:
        """统一从 UI 读取当前方向值，避免请求体与控件状态分叉。"""

        direction = self.DEFAULT_DIRECTION_TO_TRADITIONAL
        if self.direction_combo.currentIndex() == 0:
            direction = self.DEFAULT_DIRECTION_TO_SIMPLIFIED
        return direction

    def is_project_loaded(self) -> bool:
        """工程加载态统一来自状态仓库，避免页面继续直接探测数据层。"""

        loaded = False
        if self.api_state_store is not None:
            loaded = self.api_state_store.is_project_loaded()
        return loaded

    def get_active_task_state(self) -> ExtraTaskState | None:
        """Extra 长任务状态统一来自状态仓库，未命中时显式返回 None。"""

        snapshot: ExtraTaskState | None = None
        if self.api_state_store is not None and self.active_task_id != "":
            snapshot = self.api_state_store.get_extra_task_state(self.active_task_id)
        return snapshot

    def build_start_request(self) -> dict[str, object]:
        """把当前 UI 选项收口为稳定请求体，避免命令入口散写字段名。"""

        return {
            "direction": self.get_current_direction(),
            "preserve_text": self.preserve_switch.isChecked(),
            "convert_name": self.target_name_switch.isChecked(),
        }

    def is_task_running(self) -> bool:
        """当前页只按状态仓库判断运行态，避免按钮逻辑继续依赖线程对象。"""

        snapshot = self.get_active_task_state()
        running = False
        if self.active_task_id != "":
            if self.awaiting_active_task_state:
                running = True
            elif snapshot is None:
                running = self.has_seen_active_task_state
            else:
                running = snapshot.task_id != "" and not snapshot.finished
        return running

    def clear_missing_task_state(self) -> None:
        """状态仓库丢失任务时立即解锁页面，避免旧 task_id 把开始流程永久卡住。"""

        if self.active_task_id == "":
            return

        if self.progress_toast_visible:
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {"sub_event": Base.SubEvent.ERROR},
            )

        self.reset_active_task_tracking()
        self.progress_toast_visible = False

    def reset_active_task_tracking(self) -> None:
        """统一收口任务跟踪状态，避免多个分支各自维护布尔位。"""

        self.active_task_id = ""
        self.awaiting_active_task_state = False
        self.has_seen_active_task_state = False

    def show_task_failed_toast(self) -> None:
        """统一展示任务失败提示，避免多个失败分支散写同一条 Toast。"""

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": Localizer.get().task_failed,
            },
        )

    def start_conversion(self) -> None:
        request = self.build_start_request()
        should_start = False
        client = self.extra_api_client

        if self.is_task_running():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.WARNING,
                    "message": Localizer.get().task_running,
                },
            )
        elif not self.is_project_loaded():
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().alert_no_data,
                },
            )
        else:
            message_box = MessageBox(
                Localizer.get().alert,
                Localizer.get().ts_conversion_action_confirm,
                self.window(),
            )
            should_start = bool(message_box.exec())

        if should_start and client is None:
            self.show_task_failed_toast()
        elif should_start and client is not None:
            self.start_conversion_in_background(client, request)

    def start_conversion_in_background(
        self,
        client: ExtraApiClient,
        request: dict[str, object],
    ) -> None:
        """启动请求放到后台线程执行，避免 UI 主线程在网络或服务端等待中卡死。"""

        def task() -> None:
            try:
                accepted = client.start_ts_conversion(request)
            except Exception as e:
                LogManager.get().error(Localizer.get().task_failed, e)
                self.start_failed.emit()
            else:
                self.start_finished.emit(accepted)

        threading.Thread(target=task, daemon=True).start()

    def handle_start_result(self, task: object) -> None:
        """启动命令只消费受理结果对象，避免页面自己拼 task_id 与 accepted。"""

        accepted_task = task
        if not isinstance(accepted_task, TsConversionTaskAccepted):
            accepted_task = TsConversionTaskAccepted()

        if accepted_task.accepted:
            task_id = (
                accepted_task.task_id
                if accepted_task.task_id != ""
                else self.DEFAULT_TASK_ID
            )
            if self.api_state_store is not None:
                self.api_state_store.clear_extra_task_state(task_id)

            self.active_task_id = task_id
            self.awaiting_active_task_state = True
            self.has_seen_active_task_state = False
            self.progress_toast_visible = True
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {
                    "sub_event": Base.SubEvent.RUN,
                    "message": Localizer.get().ts_conversion_action_preparing,
                    "indeterminate": True,
                },
            )
            self.update_progress_from_state_store()
        else:
            self.awaiting_active_task_state = False
            self.has_seen_active_task_state = False
            self.show_task_failed_toast()

    def handle_start_failure(self) -> None:
        """后台启动失败时统一给错误提示，避免异常直接穿透到 UI 线程。"""

        self.show_task_failed_toast()
        self.awaiting_active_task_state = False
        self.has_seen_active_task_state = False

    def update_progress_from_state_store(self) -> None:
        """页面周期性读取状态仓库，让 UI 与 SSE 状态最终一致。"""

        snapshot = self.get_active_task_state()
        if snapshot is None:
            if self.awaiting_active_task_state:
                return
            if self.has_seen_active_task_state:
                self.clear_missing_task_state()
            return

        self.awaiting_active_task_state = False
        self.has_seen_active_task_state = True
        phase = snapshot.phase

        if snapshot.task_id == "":
            if self.has_seen_active_task_state:
                self.clear_missing_task_state()
        elif snapshot.finished:
            self.finish_progress(snapshot)
        elif phase == ExtraTaskState.PHASE_PREPARING:
            self.show_preparing_progress()
        else:
            self.show_running_progress(snapshot)

    def show_preparing_progress(self) -> None:
        """准备阶段沿用本地化文案，避免把内部协议字符串直接暴露给用户。"""

        self.progress_toast_visible = True
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": Base.SubEvent.RUN,
                "message": Localizer.get().ts_conversion_action_preparing,
                "indeterminate": True,
            },
        )

    def show_running_progress(self, snapshot: ExtraTaskState) -> None:
        """运行阶段统一把状态仓库快照翻译成 UI 可见进度提示。"""

        current = max(1, snapshot.current)
        total = max(current, snapshot.total, 1)
        message = (
            Localizer.get()
            .ts_conversion_action_progress.replace("{CURRENT}", str(current))
            .replace("{TOTAL}", str(total))
        )
        sub_event = Base.SubEvent.RUN
        if self.progress_toast_visible:
            sub_event = Base.SubEvent.UPDATE

        self.progress_toast_visible = True
        self.emit(
            Base.Event.PROGRESS_TOAST,
            {
                "sub_event": sub_event,
                "message": message,
                "indeterminate": False,
                "current": current,
                "total": total,
            },
        )

    def finish_progress(self, snapshot: ExtraTaskState) -> None:
        """结束阶段统一收口 Toast 与本地状态，避免成功提示重复弹出。"""

        del snapshot
        if self.progress_toast_visible:
            self.emit(
                Base.Event.PROGRESS_TOAST,
                {"sub_event": Base.SubEvent.DONE},
            )

        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().task_success,
            },
        )
        self.reset_active_task_tracking()
        self.progress_toast_visible = False
