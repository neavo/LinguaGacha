from __future__ import annotations

from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.QualityRoutes import QualityRoutes
from model.Api.QualityRuleModels import ProofreadingLookupQuery
from model.Api.QualityRuleModels import QualityRuleSnapshot


class QualityRuleApiClient:
    """质量规则 API 客户端。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_rule_snapshot(self, rule_type: str) -> QualityRuleSnapshot:
        """读取指定规则类型的快照。"""

        response = self.api_client.post(
            QualityRoutes.SNAPSHOT_PATH,
            {"rule_type": rule_type},
        )
        return QualityRuleSnapshot.from_dict(response.get("snapshot", {}))

    def save_entries(self, request: dict[str, Any]) -> QualityRuleSnapshot:
        """保存规则条目列表，并返回最新快照。"""

        response = self.api_client.post(QualityRoutes.SAVE_ENTRIES_PATH, request)
        return QualityRuleSnapshot.from_dict(response.get("snapshot", {}))

    def update_meta(self, request: dict[str, Any]) -> QualityRuleSnapshot:
        """更新规则 meta，并返回最新快照。"""

        response = self.api_client.post(QualityRoutes.UPDATE_META_PATH, request)
        return QualityRuleSnapshot.from_dict(response.get("snapshot", {}))

    def query_proofreading(
        self,
        entry: dict[str, Any],
    ) -> ProofreadingLookupQuery:
        """把质量规则条目转换成校对页查询对象。"""

        response = self.api_client.post(
            QualityRoutes.QUERY_PROOFREADING_PATH,
            {"entry": entry},
        )
        return ProofreadingLookupQuery.from_dict(response.get("query", {}))
