from __future__ import annotations

from api.Application.TaskExecutorAppService import TaskExecutorAppService


class FakeHeaders:
    """模拟请求头读取能力，隔离 task-executor token 校验测试。"""

    def __init__(self, token: str) -> None:
        """初始化测试 header 容器。"""

        self.token = token

    def get(self, name: str, default: str = "") -> str:
        """按 header 名读取 token，其他字段返回默认值。"""

        if name == TaskExecutorAppService.TOKEN_HEADER:
            return self.token
        return default


class FakeHandler:
    """模拟 route handler 依赖，保持测试只关注服务边界。"""

    def __init__(self, token: str) -> None:
        """初始化带 token 的 handler。"""

        self.headers = FakeHeaders(token)


def build_model_payload() -> dict[str, object]:
    """构造不触发真实网络请求的最小模型快照。"""

    return {"id": "model-1", "api_format": "OpenAI", "model_id": "gpt-test"}


def build_base_request() -> dict[str, object]:
    """构造 executor 公共载荷，确保测试覆盖 TS 传入快照路径。"""

    model = build_model_payload()
    return {
        "run_id": "run-1",
        "work_unit_id": "unit-1",
        "task_type": "translation",
        "model": model,
        "config_snapshot": {"activate_model_id": "model-1", "models": [model]},
        "quality_snapshot": {},
    }


def test_translation_chunk_accepts_empty_work_unit_without_task_lifecycle() -> None:
    """空翻译 chunk 不触发 LLM 请求，只返回 work-unit 结果。"""

    service = TaskExecutorAppService(instance_token="secret")
    request = {
        **build_base_request(),
        "items": [],
        "precedings": [],
    }

    result = service.execute_translation_chunk(request, FakeHandler("secret"))

    assert result == {
        "items": [],
        "row_count": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "stopped": False,
    }


def test_analysis_chunk_accepts_empty_context() -> None:
    """空分析 chunk 会成功返回空候选，checkpoint 提交仍交给 TS。"""

    service = TaskExecutorAppService(instance_token="secret")
    request = {
        **build_base_request(),
        "task_type": "analysis",
        "context": {"file_path": "", "items": [], "retry_count": 0},
    }

    result = service.execute_analysis_chunk(request, FakeHandler("secret"))

    assert result == {
        "success": True,
        "stopped": False,
        "input_tokens": 0,
        "output_tokens": 0,
        "glossary_entries": [],
    }


def test_task_executor_rejects_invalid_token() -> None:
    """所有内部 work-unit 路由都必须携带 task-executor token。"""

    service = TaskExecutorAppService(instance_token="secret")

    try:
        service.execute_translation_chunk({}, FakeHandler("bad"))
    except ValueError as error:
        assert "令牌无效" in str(error)
    else:
        raise AssertionError("无效 token 应该被拒绝")
