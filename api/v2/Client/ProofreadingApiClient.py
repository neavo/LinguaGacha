from __future__ import annotations

from typing import Any

from api.v2.Client.ApiClient import ApiClient
from api.v2.Models.ProjectRuntime import ProjectMutationAck
from api.v2.Models.Proofreading import ProofreadingMutationResult
from api.v2.Server.Routes.ProjectRoutes import ProjectRoutes


class ProofreadingApiClient:
    """校对 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def save_item(self, request: dict[str, Any]) -> ProjectMutationAck:
        """保存单条条目，并返回统一 mutation ack。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_SAVE_ITEM_PATH, request
        )
        return ProjectMutationAck.from_dict(response)

    def save_all(self, request: dict[str, Any]) -> ProjectMutationAck:
        """批量保存条目，并返回统一 mutation ack。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_SAVE_ALL_PATH, request
        )
        return ProjectMutationAck.from_dict(response)

    def replace_all(self, request: dict[str, Any]) -> ProjectMutationAck:
        """执行批量替换，并返回统一 mutation ack。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_REPLACE_ALL_PATH, request
        )
        return ProjectMutationAck.from_dict(response)

    def retranslate_items(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """单条/批量重译条目，并返回刷新后的写入结果。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_RETRANSLATE_ITEMS_PATH,
            request,
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))
