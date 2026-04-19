from dataclasses import FrozenInstanceError

from api.Client.AppClientContext import AppClientContext
import pytest


def build_app_client_context() -> AppClientContext:
    """用显式占位对象构造上下文，避免把其他客户端误当成被测对象。"""

    return AppClientContext(
        project_api_client=object(),
        task_api_client=object(),
        workbench_api_client=object(),
        settings_api_client=object(),
        quality_rule_api_client=object(),
        proofreading_api_client=object(),
        api_state_store=object(),
        extra_api_client=object(),
        model_api_client=object(),
    )


def test_app_client_context_keeps_all_boundaries_together() -> None:
    # 准备
    context = build_app_client_context()

    # 执行
    grouped_boundaries = (
        context.project_api_client,
        context.task_api_client,
        context.workbench_api_client,
        context.settings_api_client,
        context.quality_rule_api_client,
        context.proofreading_api_client,
        context.api_state_store,
        context.extra_api_client,
        context.model_api_client,
    )

    # 断言
    assert all(boundary is not None for boundary in grouped_boundaries)


def test_app_client_context_is_frozen() -> None:
    # 准备
    context = build_app_client_context()

    # 执行
    with pytest.raises(FrozenInstanceError):
        context.project_api_client = object()
