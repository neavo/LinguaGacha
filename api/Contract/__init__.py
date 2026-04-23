"""API 契约层导出。"""

from api.Contract.ProofreadingPayloads import ProofreadingMutationResultPayload
from api.Contract.QualityPayloads import QualityRuleSnapshotPayload

__all__: list[str] = [
    "ProofreadingMutationResultPayload",
    "QualityRuleSnapshotPayload",
]
