from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from api.v2.Client.ApiStateStore import ApiStateStore
from api.v2.Client.ProofreadingApiClient import ProofreadingApiClient
from api.v2.Client.ProjectApiClient import ProjectApiClient
from api.v2.Client.QualityRuleApiClient import QualityRuleApiClient
from api.v2.Client.SettingsApiClient import SettingsApiClient
from api.v2.Client.TaskApiClient import TaskApiClient
from api.v2.Client.WorkbenchApiClient import WorkbenchApiClient

if TYPE_CHECKING:
    from api.v2.Client.ExtraApiClient import ExtraApiClient
    from api.v2.Client.ModelApiClient import ModelApiClient


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
    extra_api_client: "ExtraApiClient | None" = None
    model_api_client: "ModelApiClient | None" = None
