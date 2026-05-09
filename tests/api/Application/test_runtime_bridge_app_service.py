from __future__ import annotations

import contextlib
from collections import OrderedDict
from types import SimpleNamespace

from api.Application.RuntimeBridgeAppService import RuntimeBridgeAppService


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
        self.file_operation_allowed = True
        self.asset_content: dict[str, bytes | None] = {}
        self.project_file_service = SimpleNamespace(
            parse_file_preview=lambda source_path, current_rel_path=None: {
                "target_rel_path": current_rel_path or "book.epub",
                "file_type": "EPUB",
                "parsed_items": [{"src": "章节", "file_type": "EPUB"}],
            }
        )
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

    def get_asset_decompressed(self, rel_path: str) -> bytes | None:
        """返回测试 asset 内容，隔离真实数据库读取。"""

        return self.asset_content.get(rel_path)


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
