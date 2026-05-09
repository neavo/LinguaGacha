from __future__ import annotations

import contextlib
from collections import OrderedDict
from types import SimpleNamespace

from api.Application.RuntimeBridgeAppService import RuntimeBridgeAppService
from base.Base import Base


class FakeHeaders:
    """模拟请求头读取能力，隔离 runtime bridge token 校验测试。"""

    def __init__(self, token: str) -> None:
        """初始化 FakeHeaders 依赖和状态，保持对象写入口明确。"""

        self.token = token

    def get(self, name: str, default: str = "") -> str:
        """按 key 读取测试头，模拟 HTTP header 访问。"""

        if name == RuntimeBridgeAppService.TOKEN_HEADER:
            return self.token
        return default


class FakeHandler:
    """模拟 route handler 依赖，保持路由测试只关注响应边界。"""

    def __init__(self, token: str) -> None:
        """初始化 FakeHandler 依赖和状态，保持对象写入口明确。"""

        self.headers = FakeHeaders(token)


class FakeDataManager:
    """模拟 DataManager 项目状态，隔离 runtime bridge 状态读取测试。"""

    def __init__(self) -> None:
        """初始化 FakeDataManager 依赖和状态，保持对象写入口明确。"""

        self.loaded = True
        self.path = "E:/Project/demo.lg"
        self.begin_file_operation_count = 0
        self.finish_file_operation_count = 0
        self.unload_project_count = 0
        self.load_project_calls: list[str] = []
        self.file_operation_allowed = True
        self.asset_content: dict[str, bytes | None] = {}
        self.translation_extras: dict[str, int | float] = {
            "line": 3,
            "total_line": 9,
            "processed_line": 2,
            "error_line": 0,
            "total_tokens": 128,
            "total_input_tokens": 64,
            "total_output_tokens": 64,
            "time": 1.5,
            "start_time": 10.0,
        }
        self.analysis_snapshot: dict[str, int | float] = {
            "line": 4,
            "total_line": 8,
            "processed_line": 3,
            "error_line": 1,
            "total_tokens": 256,
            "total_input_tokens": 128,
            "total_output_tokens": 128,
            "time": 2.5,
            "start_time": 12.0,
        }
        self.analysis_candidate_count = 5
        self.session = SimpleNamespace(
            state_lock=contextlib.nullcontext(),
            meta_cache={"analysis_extras": {"line": 1}},
            rule_cache={"glossary": [{"src": "A"}]},
            rule_text_cache={"translation_prompt": "旧提示词"},
            item_cache=[{"id": 1}],
            item_cache_index={1: 0},
            asset_decompress_cache=OrderedDict({"a.txt": b"old"}),
        )

    def is_loaded(self) -> bool:
        """返回测试加载态，驱动服务分支判断。"""

        return self.loaded

    def get_lg_path(self) -> str:
        """返回测试工程路径，避免测试触碰真实文件。"""

        return self.path

    def try_begin_file_operation(self) -> bool:
        """模拟 DataManager 文件操作锁，验证 runtime bridge 互斥入口。"""

        self.begin_file_operation_count += 1
        return self.file_operation_allowed

    def finish_file_operation(self) -> None:
        """模拟释放 DataManager 文件操作锁。"""

        self.finish_file_operation_count += 1

    def unload_project(self) -> None:
        """模拟卸载工程会话，帮助断言内部桥真实触发数据层。"""

        self.unload_project_count += 1
        self.loaded = False
        self.path = ""

    def load_project(self, project_path: str) -> None:
        """模拟加载工程会话，帮助断言内部 project_load 桥接载荷。"""

        self.load_project_calls.append(project_path)
        self.loaded = True
        self.path = project_path

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        """返回测试 asset 内容，隔离真实数据库读取。"""

        return self.asset_content.get(rel_path)

    def get_task_progress_snapshot(self, task_type: str) -> dict[str, int | float]:
        """返回测试任务进度，隔离真实 DataManager 缓存。"""

        if task_type == "analysis":
            return dict(self.analysis_snapshot)
        return dict(self.translation_extras)

    def get_analysis_candidate_count(self) -> int:
        """返回测试分析候选数，供内部事件桥快照使用。"""

        return self.analysis_candidate_count


class FakeTaskEngine:
    """模拟 Engine 任务状态和单条翻译入口。"""

    def __init__(self) -> None:
        """初始化任务引擎桩，默认处于翻译中。"""

        self.status = Base.TaskStatus.TRANSLATING
        self.request_in_flight_count = 2
        self.active_task_type = "translation"
        self.active_retranslate_item_ids: list[int] = []
        self.translate_single_dst = "【爱丽丝】"
        self.translate_single_success = True

    def get_status(self) -> Base.TaskStatus:
        """返回测试任务状态。"""

        return self.status

    def is_busy(self) -> bool:
        """返回基于状态的忙碌态。"""

        return self.status in Base.ENGINE_BUSY_STATUSES

    def get_request_in_flight_count(self) -> int:
        """返回测试实时请求数。"""

        return self.request_in_flight_count

    def get_active_task_type(self) -> str:
        """返回测试活跃任务类型。"""

        return self.active_task_type

    def set_active_retranslate_item_ids(self, item_ids: list[int]) -> None:
        """记录内部重翻条目 id。"""

        self.active_retranslate_item_ids = list(item_ids)

    def get_active_retranslate_item_ids(self) -> list[int]:
        """返回当前重翻条目 id。"""

        return list(self.active_retranslate_item_ids)

    def translate_single_item(self, item, config, callback) -> None:
        """模拟单条翻译完成回调。"""

        del config
        item.set_dst(self.translate_single_dst)
        callback(item, self.translate_single_success)


def test_runtime_bridge_project_state_requires_token() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    service.data_manager = FakeDataManager()
    service.engine = SimpleNamespace(is_busy=lambda: False)

    result = service.get_project_state({}, FakeHandler("secret"))

    assert result == {
        "loaded": True,
        "projectPath": "E:/Project/demo.lg",
        "busy": False,
    }


def test_runtime_bridge_project_state_exposes_busy() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    service.data_manager = FakeDataManager()
    service.engine = SimpleNamespace(is_busy=lambda: True)

    result = service.get_project_state({}, FakeHandler("secret"))

    assert result["busy"] is True


def test_runtime_bridge_task_state_requires_token() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_engine = FakeTaskEngine()
    fake_engine.active_retranslate_item_ids = [1, 3]
    service.data_manager = FakeDataManager()
    service.engine = fake_engine

    result = service.get_task_state({}, FakeHandler("secret"))

    assert result == {
        "status": Base.TaskStatus.TRANSLATING.value,
        "busy": True,
        "request_in_flight_count": 2,
        "active_task_type": "translation",
        "retranslating_item_ids": [1, 3],
    }


def test_runtime_bridge_task_commands_emit_engine_events(monkeypatch) -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_engine = FakeTaskEngine()
    fake_engine.status = Base.TaskStatus.IDLE
    service.data_manager = FakeDataManager()
    service.engine = fake_engine
    emitted_events: list[tuple[Base.Event, dict[str, object]]] = []

    def capture_emit(self, event: Base.Event, payload: dict[str, object]) -> bool:
        """记录内部任务事件，避免测试触碰全局 EventManager。"""

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
    stop_result = service.stop_translation({}, FakeHandler("secret"))
    retranslate_result = service.start_retranslate(
        {"item_ids": [2, "1", 2]},
        FakeHandler("secret"),
    )

    assert translation_result == {"accepted": True}
    assert analysis_result == {"accepted": True}
    assert stop_result == {"accepted": True}
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
            Base.Event.RETRANSLATE_TASK,
            {
                "sub_event": Base.SubEvent.REQUEST,
                "item_ids": [2, 1],
            },
        ),
    ]


def test_runtime_bridge_build_task_snapshot_for_event_bridge() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    service.data_manager = FakeDataManager()
    service.engine = FakeTaskEngine()

    result = service.build_task_snapshot("analysis")

    assert result["task_type"] == "analysis"
    assert result["status"] == Base.TaskStatus.TRANSLATING.value
    assert result["request_in_flight_count"] == 2
    assert result["line"] == 4
    assert result["analysis_candidate_count"] == 5


def test_runtime_bridge_translate_single_uses_engine(monkeypatch) -> None:
    class FakeConfig:
        """提供单条翻译测试所需的激活模型。"""

        def load(self) -> "FakeConfig":
            """返回自身，模拟真实 Config().load()。"""

            return self

        def get_active_model(self) -> dict[str, str]:
            """返回激活模型，允许请求进入 Engine。"""

            return {"id": "model-1"}

    service = RuntimeBridgeAppService(instance_token="secret")
    fake_engine = FakeTaskEngine()
    service.data_manager = FakeDataManager()
    service.engine = fake_engine
    monkeypatch.setattr(
        "api.Application.RuntimeBridgeAppService.Config",
        lambda: FakeConfig(),
    )

    result = service.translate_single({"text": "【Alice】"}, FakeHandler("secret"))

    assert result == {"success": True, "status": "OK", "dst": "【爱丽丝】"}


def test_runtime_bridge_rejects_invalid_token() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")

    try:
        service.get_project_state({}, FakeHandler("bad"))
    except ValueError as error:
        assert "令牌无效" in str(error)
    else:
        raise AssertionError("无效 token 应该被拒绝")


def test_runtime_bridge_project_data_changed_clears_section_caches() -> None:
    """TS 项目写入口同步后，Py 运行态缓存必须按影响 section 失效。"""

    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: False)

    result = service.sync(
        {
            "type": "project_data_changed",
            "payload": {"sections": ["files", "items", "quality", "analysis"]},
        },
        FakeHandler("secret"),
    )

    assert result == {"accepted": True}
    assert fake_data_manager.session.meta_cache == {}
    assert fake_data_manager.session.rule_cache == {}
    assert fake_data_manager.session.rule_text_cache == {}
    assert fake_data_manager.session.item_cache is None
    assert fake_data_manager.session.item_cache_index == {}
    assert fake_data_manager.session.asset_decompress_cache == OrderedDict()


def test_runtime_bridge_items_section_clears_meta_cache() -> None:
    """items 只同步时也要清 meta cache，避免 revision 读到旧值。"""

    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: False)

    service.sync(
        {
            "type": "project_data_changed",
            "payload": {"sections": ["items"]},
        },
        FakeHandler("secret"),
    )

    assert fake_data_manager.session.meta_cache == {}
    assert fake_data_manager.session.item_cache is None
    assert fake_data_manager.session.asset_decompress_cache == OrderedDict(
        {"a.txt": b"old"}
    )


def test_runtime_bridge_file_operation_guard_begin_and_end() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: False)

    begin_result = service.sync(
        {"type": "project_file_operation_begin", "payload": {}},
        FakeHandler("secret"),
    )
    end_result = service.sync(
        {"type": "project_file_operation_end", "payload": {}},
        FakeHandler("secret"),
    )

    assert begin_result == {"accepted": True}
    assert end_result == {"accepted": True}
    assert fake_data_manager.begin_file_operation_count == 1
    assert fake_data_manager.finish_file_operation_count == 1


def test_runtime_bridge_project_unload_calls_data_manager() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: False)

    result = service.sync(
        {"type": "project_unload", "payload": {}},
        FakeHandler("secret"),
    )

    assert result == {"accepted": True}
    assert fake_data_manager.unload_project_count == 1
    assert fake_data_manager.is_loaded() is False
    assert fake_data_manager.get_lg_path() == ""


def test_runtime_bridge_project_load_calls_data_manager() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    fake_data_manager.loaded = False
    fake_data_manager.path = ""
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: False)

    result = service.sync(
        {
            "type": "project_load",
            "payload": {"project_path": "E:/Project/demo.lg"},
        },
        FakeHandler("secret"),
    )

    assert result == {"accepted": True}
    assert fake_data_manager.load_project_calls == ["E:/Project/demo.lg"]
    assert fake_data_manager.is_loaded() is True
    assert fake_data_manager.get_lg_path() == "E:/Project/demo.lg"


def test_runtime_bridge_project_load_rejects_missing_path() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    service.data_manager = FakeDataManager()
    service.engine = SimpleNamespace(is_busy=lambda: False)

    try:
        service.sync({"type": "project_load", "payload": {}}, FakeHandler("secret"))
    except ValueError as error:
        assert "project_path" in str(error)
    else:
        raise AssertionError("project_load 缺少路径时应拒绝同步")


def test_runtime_bridge_file_operation_guard_rejects_busy_engine() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    fake_data_manager = FakeDataManager()
    service.data_manager = fake_data_manager
    service.engine = SimpleNamespace(is_busy=lambda: True)

    try:
        service.sync(
            {"type": "project_file_operation_begin", "payload": {}},
            FakeHandler("secret"),
        )
    except ValueError as error:
        assert "任务" in str(error) or "Task" in str(error)
    else:
        raise AssertionError("任务忙碌时应拒绝工作台文件操作")

    assert fake_data_manager.begin_file_operation_count == 0
