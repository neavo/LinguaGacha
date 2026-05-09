from __future__ import annotations

from api.Application.RuntimeBridgeAppService import RuntimeBridgeAppService
from base.Base import Base


class FakeHeaders:
    """模拟请求头读取能力，隔离 runtime bridge token 校验测试。"""

    def __init__(self, token: str) -> None:
        """初始化测试 header 容器。"""

        self.token = token

    def get(self, name: str, default: str = "") -> str:
        """按 header 名读取 token，其他字段返回默认值。"""

        if name == RuntimeBridgeAppService.TOKEN_HEADER:
            return self.token
        return default


class FakeHandler:
    """模拟 route handler 依赖，保持测试只关注服务边界。"""

    def __init__(self, token: str) -> None:
        """初始化带 token 的 handler。"""

        self.headers = FakeHeaders(token)


class FakeTaskEngine:
    """模拟 Engine 任务状态和单条翻译入口。"""

    def __init__(self) -> None:
        """初始化任务引擎桩，默认空闲且允许命令进入。"""

        self.busy = False
        self.active_retranslate_item_ids: list[int] = []
        self.translate_single_dst = "【爱丽丝】"
        self.translate_single_success = True

    def is_busy(self) -> bool:
        """返回测试忙碌态。"""

        return self.busy

    def set_active_retranslate_item_ids(self, item_ids: list[int]) -> None:
        """记录当前重翻条目 id。"""

        self.active_retranslate_item_ids = list(item_ids)

    def translate_single_item(self, item, config, callback) -> None:
        """模拟单条翻译完成回调。"""

        del config
        item.set_dst(self.translate_single_dst)
        callback(item, self.translate_single_success)


def test_runtime_bridge_task_commands_emit_engine_events(monkeypatch) -> None:
    """RuntimeBridge 只保留任务命令入口，并把命令转发到 Engine 事件总线。"""

    service = RuntimeBridgeAppService(instance_token="secret")
    fake_engine = FakeTaskEngine()
    service.engine = fake_engine
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(self, event: Base.Event, payload: dict[str, object]) -> bool:
        """记录内部任务事件，避免测试触碰真实 EventManager。"""

        del self
        emitted_events.append((event, payload))
        return True

    monkeypatch.setattr(Base, "emit", capture_emit)

    translation_result = service.start_translation(
        {"mode": "NEW"},
        FakeHandler("secret"),
    )
    analysis_result = service.start_analysis(
        {"mode": "CONTINUE"},
        FakeHandler("secret"),
    )
    stop_translation_result = service.stop_translation({}, FakeHandler("secret"))
    stop_analysis_result = service.stop_analysis({}, FakeHandler("secret"))
    retranslate_result = service.start_retranslate(
        {"item_ids": [2, "1", 2]},
        FakeHandler("secret"),
    )

    assert translation_result == {"accepted": True}
    assert analysis_result == {"accepted": True}
    assert stop_translation_result == {"accepted": True}
    assert stop_analysis_result == {"accepted": True}
    assert retranslate_result == {"accepted": True}
    assert fake_engine.active_retranslate_item_ids == [2, 1]
    assert emitted_events == [
        (
            Base.Event.TRANSLATION_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.TranslationMode.NEW,
                "quality_snapshot": None,
            },
        ),
        (
            Base.Event.ANALYSIS_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "mode": Base.AnalysisMode.CONTINUE,
                "quality_snapshot": None,
            },
        ),
        (
            Base.Event.TRANSLATION_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.ANALYSIS_REQUEST_STOP,
            {"sub_event": Base.SubEvent.REQUEST},
        ),
        (
            Base.Event.RETRANSLATE_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "item_ids": [2, 1],
                "quality_snapshot": None,
            },
        ),
    ]


def test_runtime_bridge_retranslate_rejects_busy_engine() -> None:
    """Python Engine 忙碌时仍拒绝新的重翻命令。"""

    service = RuntimeBridgeAppService(instance_token="secret")
    fake_engine = FakeTaskEngine()
    fake_engine.busy = True
    service.engine = fake_engine

    try:
        service.start_retranslate({"item_ids": [1]}, FakeHandler("secret"))
    except ValueError as error:
        assert "任务" in str(error) or "Task" in str(error)
    else:
        raise AssertionError("忙碌时应拒绝重翻任务")


def test_runtime_bridge_retranslate_emits_quality_snapshot(monkeypatch) -> None:
    """重翻命令必须携带当前质量快照，保证与普通翻译规则一致。"""

    service = RuntimeBridgeAppService(instance_token="secret")
    service.engine = FakeTaskEngine()
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(self, event: Base.Event, payload: dict[str, object]) -> bool:
        """记录事件载荷，便于断言快照已经在桥接层还原。"""

        del self
        emitted_events.append((event, payload))
        return True

    monkeypatch.setattr(Base, "emit", capture_emit)

    result = service.start_retranslate(
        {
            "item_ids": [1],
            "quality_snapshot": {
                "quality": {
                    "glossary": {
                        "enabled": True,
                        "entries": [{"src": "勇者", "dst": "Hero"}],
                    },
                },
            },
        },
        FakeHandler("secret"),
    )

    quality_snapshot = emitted_events[0][1]["quality_snapshot"]
    assert result == {"accepted": True}
    assert emitted_events[0][0] == Base.Event.RETRANSLATE_TASK
    assert getattr(quality_snapshot, "glossary_enable") is True
    assert getattr(quality_snapshot, "glossary_entries") == [
        {"src": "勇者", "dst": "Hero"}
    ]


def test_runtime_bridge_translate_single_uses_engine(monkeypatch) -> None:
    """单条翻译继续复用 Python Engine 的同步回调入口。"""

    class FakeConfig:
        """提供单条翻译测试所需的激活模型。"""

        def load(self) -> "FakeConfig":
            """返回自身，模拟真实 Config().load()。"""

            return self

        def get_active_model(self) -> dict[str, str]:
            """返回激活模型，允许请求进入 Engine。"""

            return {"id": "model-1"}

    service = RuntimeBridgeAppService(instance_token="secret")
    service.engine = FakeTaskEngine()
    monkeypatch.setattr(
        "api.Application.RuntimeBridgeAppService.Config",
        lambda: FakeConfig(),
    )

    result = service.translate_single({"text": "【Alice】"}, FakeHandler("secret"))

    assert result == {"success": True, "status": "OK", "dst": "【爱丽丝】"}


def test_runtime_bridge_translate_single_returns_no_active_model(monkeypatch) -> None:
    """没有激活模型时，单条翻译直接返回明确失败状态。"""

    class FakeConfig:
        """提供无激活模型的配置桩。"""

        def load(self) -> "FakeConfig":
            """返回自身，模拟真实 Config().load()。"""

            return self

        def get_active_model(self) -> None:
            """返回空激活模型。"""

            return None

    service = RuntimeBridgeAppService(instance_token="secret")
    service.engine = FakeTaskEngine()
    monkeypatch.setattr(
        "api.Application.RuntimeBridgeAppService.Config",
        lambda: FakeConfig(),
    )

    result = service.translate_single({"text": "原文"}, FakeHandler("secret"))

    assert result == {"success": False, "status": "NO_ACTIVE_MODEL", "dst": ""}


def test_runtime_bridge_rejects_invalid_token() -> None:
    """所有内部任务命令都必须携带 RuntimeBridge token。"""

    service = RuntimeBridgeAppService(instance_token="secret")

    try:
        service.start_translation({"mode": "NEW"}, FakeHandler("bad"))
    except ValueError as error:
        assert "令牌无效" in str(error)
    else:
        raise AssertionError("无效 token 应该被拒绝")
