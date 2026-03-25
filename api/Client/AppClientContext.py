from dataclasses import dataclass

from api.Client.ApiStateStore import ApiStateStore
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.ProjectApiClient import ProjectApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient
from api.Client.SettingsApiClient import SettingsApiClient
from api.Client.TaskApiClient import TaskApiClient
from api.Client.WorkbenchApiClient import WorkbenchApiClient


@dataclass(frozen=True)
class AppClientContext:
    """把 UI 侧允许消费的客户端边界对象收口到一个不可变容器里。"""

    project_api_client: ProjectApiClient
    task_api_client: TaskApiClient
    workbench_api_client: WorkbenchApiClient
    settings_api_client: SettingsApiClient
    quality_rule_api_client: QualityRuleApiClient
    proofreading_api_client: ProofreadingApiClient
    api_state_store: ApiStateStore
