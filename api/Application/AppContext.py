from dataclasses import dataclass

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient


@dataclass(frozen=True)
class AppContext:
    """UI 侧 API 依赖容器，后续页面统一从这里拿边界对象。"""

    project_api_client: ProjectApiClient
    task_api_client: TaskApiClient
    workbench_api_client: WorkbenchApiClient
    api_state_store: ApiStateStore
