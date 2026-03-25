from __future__ import annotations

from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.ProofreadingRoutes import ProofreadingRoutes
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot


class ProofreadingApiClient:
    """校对 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_snapshot(
        self, request: dict[str, Any] | None = None
    ) -> ProofreadingSnapshot:
        """读取校对快照，供页面首屏与主动刷新共用。"""

        response = self.api_client.post(ProofreadingRoutes.SNAPSHOT_PATH, request or {})
        return ProofreadingSnapshot.from_dict(response.get("snapshot", {}))

    def filter_items(self, request: dict[str, Any]) -> ProofreadingSnapshot:
        """按筛选条件读取校对快照。"""

        response = self.api_client.post(ProofreadingRoutes.FILTER_PATH, request)
        return ProofreadingSnapshot.from_dict(response.get("snapshot", {}))

    def search(self, request: dict[str, Any]) -> ProofreadingSearchResult:
        """执行校对页搜索，只返回命中信息。"""

        response = self.api_client.post(ProofreadingRoutes.SEARCH_PATH, request)
        return ProofreadingSearchResult.from_dict(response.get("search_result", {}))

    def save_item(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """保存单条条目，并返回写入结果。"""

        response = self.api_client.post(ProofreadingRoutes.SAVE_ITEM_PATH, request)
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def save_all(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """批量保存条目，并返回写入结果。"""

        response = self.api_client.post(ProofreadingRoutes.SAVE_ALL_PATH, request)
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def replace_all(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """执行批量替换，并返回写入结果。"""

        response = self.api_client.post(ProofreadingRoutes.REPLACE_ALL_PATH, request)
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def recheck_item(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """重新检查单条条目，并返回警告结果。"""

        response = self.api_client.post(ProofreadingRoutes.RECHECK_ITEM_PATH, request)
        return ProofreadingMutationResult.from_dict(response.get("result", {}))

    def retranslate_items(self, request: dict[str, Any]) -> ProofreadingMutationResult:
        """单条/批量重译条目，并返回刷新后的写入结果。"""

        response = self.api_client.post(
            ProofreadingRoutes.RETRANSLATE_ITEMS_PATH,
            request,
        )
        return ProofreadingMutationResult.from_dict(response.get("result", {}))
