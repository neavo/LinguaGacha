from typing import Callable
from typing import TypeVar

from PySide6.QtWidgets import QLayout
from PySide6.QtWidgets import QVBoxLayout
from PySide6.QtWidgets import QWidget
from qfluentwidgets import FluentWindow
from qfluentwidgets import SwitchButton

from api.Client.ExtraApiClient import ExtraApiClient
from api.Client.TaskApiClient import TaskApiClient
from base.Base import Base
from model.Api.ExtraModels import LaboratorySnapshot
from model.Api.TaskModels import TaskSnapshot
from module.Localizer.Localizer import Localizer
from widget.SettingCard import CardHelpSpec
from widget.SettingCard import SettingCard

type ClientType = ExtraApiClient | TaskApiClient
TClient = TypeVar("TClient", bound=ClientType)


class LaboratoryPage(Base, QWidget):
    MTOOL_OPTIMIZER_URL_ZH: str = (
        "https://github.com/neavo/LinguaGacha/wiki/MToolOptimizer"
    )
    MTOOL_OPTIMIZER_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/MToolOptimizerEN"
    )
    FORCE_THINKING_URL_ZH: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ForceThinking"
    )
    FORCE_THINKING_URL_EN: str = (
        "https://github.com/neavo/LinguaGacha/wiki/ForceThinkingEN"
    )

    def __init__(
        self,
        text: str,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None = None,
        task_api_client: TaskApiClient | None = None,
    ) -> None:
        super().__init__(window)
        self.setObjectName(text.replace(" ", "-"))
        self.extra_api_client = self.resolve_extra_api_client(window, extra_api_client)
        self.task_api_client = self.resolve_task_api_client(window, task_api_client)
        self.mtool_switch: SwitchButton | None = None
        self.force_thinking_switch: SwitchButton | None = None

        # 首屏优先通过 API 快照驱动控件，避免页面继续直接触碰配置单例。
        laboratory_snapshot = self.get_laboratory_snapshot()

        # 设置主容器
        self.root = QVBoxLayout(self)
        self.root.setSpacing(8)
        self.root.setContentsMargins(24, 24, 24, 24)  # 左、上、右、下

        # 添加控件
        self.add_widget_mtool(self.root, laboratory_snapshot)
        self.add_widget_force_thinking(self.root, laboratory_snapshot)

        # 填充
        self.root.addStretch(1)

        # 翻译过程中禁用影响过滤/翻译语义的选项，避免与翻译写库产生竞态。
        self.subscribe_busy_state_events(self.on_translation_status_changed)
        self.on_translation_status_changed(
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.DONE,
            },
        )

    def resolve_extra_api_client(
        self,
        window: FluentWindow | None,
        extra_api_client: ExtraApiClient | None,
    ) -> ExtraApiClient | None:
        """优先消费显式注入，其次兼容现有窗口上下文，避免当前任务越界改整窗 wiring。"""

        return self.resolve_window_client(
            window=window,
            injected_client=extra_api_client,
            client_attr_name="extra_api_client",
            client_type=ExtraApiClient,
        )

    def resolve_task_api_client(
        self,
        window: FluentWindow | None,
        task_api_client: TaskApiClient | None,
    ) -> TaskApiClient | None:
        """优先复用窗口已有任务客户端，这样实验室页可以共享忙碌态来源。"""

        return self.resolve_window_client(
            window=window,
            injected_client=task_api_client,
            client_attr_name="task_api_client",
            client_type=TaskApiClient,
        )

    def resolve_window_client(
        self,
        *,
        window: FluentWindow | None,
        injected_client: TClient | None,
        client_attr_name: str,
        client_type: type[TClient],
    ) -> TClient | None:
        """统一兼容显式注入与窗口上下文，避免两个客户端解析逻辑继续分叉。"""

        resolved_client = injected_client
        if resolved_client is None and window is not None:
            window_client = getattr(window, client_attr_name, None)
            if isinstance(window_client, client_type):
                resolved_client = window_client
            else:
                app_client_context = getattr(window, "app_client_context", None)
                context_client = getattr(app_client_context, client_attr_name, None)
                if isinstance(context_client, client_type):
                    resolved_client = context_client
        return resolved_client

    def get_laboratory_snapshot(self) -> LaboratorySnapshot:
        """读取实验室快照；未接入真实客户端时保留页面可渲染的最小保护。"""

        snapshot = self.build_current_laboratory_snapshot()
        if self.extra_api_client is not None:
            snapshot = self.extra_api_client.get_laboratory_snapshot()
        return snapshot

    def update_laboratory_settings(
        self,
        request: dict[str, object],
    ) -> LaboratorySnapshot:
        """统一通过 Extra API 更新实验室设置，避免页面自己决定持久化路径。"""

        snapshot = self.build_current_laboratory_snapshot()
        if self.extra_api_client is not None:
            snapshot = self.extra_api_client.update_laboratory_settings(request)
        self.apply_laboratory_snapshot(snapshot)
        return snapshot

    def get_task_snapshot(self) -> TaskSnapshot:
        """读取任务忙碌态；未接入真实客户端时退回空闲快照，保证页面不崩。"""

        snapshot = TaskSnapshot()
        if self.task_api_client is not None:
            snapshot = self.task_api_client.get_task_snapshot()
        return snapshot

    def build_current_laboratory_snapshot(self) -> LaboratorySnapshot:
        """在缺少真实客户端时仍保留当前 UI 状态，避免开关被异常重置。"""

        return LaboratorySnapshot(
            mtool_optimizer_enabled=self.get_switch_checked(self.mtool_switch),
            force_thinking_enabled=self.get_switch_checked(self.force_thinking_switch),
        )

    def apply_laboratory_snapshot(self, snapshot: LaboratorySnapshot) -> None:
        """统一回填服务端确认后的状态，避免两个开关各自维护局部真相。"""

        self.set_switch_checked(
            self.mtool_switch,
            snapshot.mtool_optimizer_enabled,
        )
        self.set_switch_checked(
            self.force_thinking_switch,
            snapshot.force_thinking_enabled,
        )

    def set_switch_checked(
        self,
        switch_button: SwitchButton | None,
        checked: bool,
    ) -> None:
        """回填状态时临时阻断信号，避免界面同步反向触发重复写入。"""

        if switch_button is not None:
            was_blocked = switch_button.blockSignals(True)
            switch_button.setChecked(checked)
            switch_button.blockSignals(was_blocked)

    def get_switch_checked(self, switch_button: SwitchButton | None) -> bool:
        """缺少真实开关实例时统一回落为 False，避免各处重复写同一保护分支。"""

        checked = False
        if switch_button is not None:
            checked = switch_button.isChecked()
        return checked

    def get_switches_locked_state(self) -> bool:
        """忽略中间态重置信号时沿用当前禁用状态，避免按钮闪烁。"""

        locked = False
        if self.mtool_switch is not None and not self.mtool_switch.isEnabled():
            locked = True
        elif (
            self.force_thinking_switch is not None
            and not self.force_thinking_switch.isEnabled()
        ):
            locked = True
        return locked

    def on_translation_status_changed(
        self,
        event: Base.Event,
        data: dict[str, object],
    ) -> None:
        should_keep_current_state = event in Base.RESET_PROGRESS_EVENTS and (
            not Base.is_terminal_reset_event(event, data)
        )

        if should_keep_current_state:
            locked = self.get_switches_locked_state()
        else:
            task_snapshot = self.get_task_snapshot()
            locked = bool(task_snapshot.busy)

        if self.mtool_switch is not None:
            self.mtool_switch.setEnabled(not locked)
        if self.force_thinking_switch is not None:
            self.force_thinking_switch.setEnabled(not locked)

    def add_switch_card(
        self,
        *,
        parent: QLayout,
        title: str,
        description: str,
        help_url_zh: str,
        help_url_en: str,
        checked: bool,
        on_checked_changed: Callable[[], None],
    ) -> SwitchButton:
        """统一创建实验室页面的开关卡片，避免每个选项重复搭 UI。"""
        help_spec = CardHelpSpec(
            url_localized=Localizer.UnionText(
                zh=help_url_zh,
                en=help_url_en,
            )
        )
        card = SettingCard(
            title=title,
            description=description,
            help_spec=help_spec,
            parent=self,
        )
        switch_button = SwitchButton(card)
        switch_button.setOnText("")
        switch_button.setOffText("")
        switch_button.setChecked(checked)
        switch_button.checkedChanged.connect(lambda _checked: on_checked_changed())
        card.add_right_widget(switch_button)
        parent.addWidget(card)
        return switch_button

    # MTool 优化器
    def add_widget_mtool(
        self,
        parent: QLayout,
        snapshot: LaboratorySnapshot,
    ) -> None:
        def checked_changed() -> None:
            self.update_laboratory_settings(
                {"mtool_optimizer_enabled": self.get_switch_checked(self.mtool_switch)}
            )
            self.emit(Base.Event.CONFIG_UPDATED, {"keys": ["mtool_optimizer_enable"]})

        self.mtool_switch = self.add_switch_card(
            parent=parent,
            title=Localizer.get().laboratory_page_mtool_optimizer_enable,
            description=Localizer.get().laboratory_page_mtool_optimizer_enable_desc,
            help_url_zh=self.MTOOL_OPTIMIZER_URL_ZH,
            help_url_en=self.MTOOL_OPTIMIZER_URL_EN,
            checked=snapshot.mtool_optimizer_enabled,
            on_checked_changed=checked_changed,
        )

    # 强制思考
    def add_widget_force_thinking(
        self,
        parent: QLayout,
        snapshot: LaboratorySnapshot,
    ) -> None:
        def checked_changed() -> None:
            self.update_laboratory_settings(
                {
                    "force_thinking_enabled": self.get_switch_checked(
                        self.force_thinking_switch
                    )
                }
            )

        self.force_thinking_switch = self.add_switch_card(
            parent=parent,
            title=Localizer.get().laboratory_page_force_thinking_enable,
            description=Localizer.get().laboratory_page_force_thinking_enable_desc,
            help_url_zh=self.FORCE_THINKING_URL_ZH,
            help_url_en=self.FORCE_THINKING_URL_EN,
            checked=snapshot.force_thinking_enabled,
            on_checked_changed=checked_changed,
        )
