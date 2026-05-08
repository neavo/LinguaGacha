from __future__ import annotations

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

    def is_loaded(self) -> bool:
        """返回测试加载态，驱动服务分支判断。"""

        return self.loaded

    def get_lg_path(self) -> str:
        """返回测试工程路径，避免测试触碰真实文件。"""

        return self.path


def test_runtime_bridge_project_state_requires_token() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")
    service.data_manager = FakeDataManager()

    result = service.get_project_state({}, FakeHandler("secret"))

    assert result == {"loaded": True, "projectPath": "E:/Project/demo.lg"}


def test_runtime_bridge_rejects_invalid_token() -> None:
    service = RuntimeBridgeAppService(instance_token="secret")

    try:
        service.get_project_state({}, FakeHandler("bad"))
    except ValueError as error:
        assert "令牌无效" in str(error)
    else:
        raise AssertionError("无效 token 应该被拒绝")
