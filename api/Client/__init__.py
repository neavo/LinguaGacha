"""API 客户端层。"""

from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Client.QualityRuleApiClient import QualityRuleApiClient

__all__: list[str] = [
    "ProofreadingApiClient",
    "QualityRuleApiClient",
]
