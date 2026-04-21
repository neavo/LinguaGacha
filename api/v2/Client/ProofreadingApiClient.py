from __future__ import annotations

from typing import Any

from api.v2.Client.ApiClient import ApiClient
from api.v2.Models.Proofreading import ProofreadingMutationResult
from api.v2.Models.Proofreading import ProofreadingSnapshot
from api.v2.Server.Routes.ProjectRoutes import ProjectRoutes


class ProofreadingApiClient:
    """校对 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_snapshot(
        self, request: dict[str, Any] | None = None
    ) -> ProofreadingSnapshot:
        """读取校对快照，供页面首屏与主动刷新共用。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_SNAPSHOT_PATH, request or {}
        )
        return ProofreadingSnapshot.from_dict(response.get("snapshot", {}))

    def filter_items(self, request: dict[str, Any]) -> ProofreadingSnapshot:
        """按筛选条件读取校对快照。"""

        response = self.api_client.post(ProjectRoutes.PROOFREADING_FILTER_PATH, request)
        return ProofreadingSnapshot.from_dict(response.get("snapshot", {}))

    def save_item(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """保存单条条目，并返回写入结果。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_SAVE_ITEM_PATH, request
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def save_all(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """批量保存条目，并返回写入结果。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_SAVE_ALL_PATH, request
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def replace_all(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """执行批量替换，并返回写入结果。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_REPLACE_ALL_PATH, request
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def retranslate_items(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """单条/批量重译条目，并返回刷新后的写入结果。"""

        response = self.api_client.post(
            ProjectRoutes.PROOFREADING_RETRANSLATE_ITEMS_PATH,
            request,
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))
