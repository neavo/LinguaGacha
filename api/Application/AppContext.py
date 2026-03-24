from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AppContext:
    """旧 UI 启动上下文占位类型，后续迁移到 Client 层后会删除。"""

    project_api_client: Any
    task_api_client: Any
    workbench_api_client: Any
    settings_api_client: Any
    api_state_store: Any
