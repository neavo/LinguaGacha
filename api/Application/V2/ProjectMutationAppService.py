from typing import Any

from api.Contract.V2.MutationPayloads import MutationAckPayload


class V2ProjectMutationAppService:
    """把 V2 mutation 服务收口为稳定的 HTTP 响应壳。"""

    def __init__(self, mutation_service: Any) -> None:
        self.mutation_service = mutation_service

    def apply_mutations(self, request: dict[str, object]) -> dict[str, object]:
        """执行 mutation 并返回标准化 ack。"""

        ack = MutationAckPayload.from_dict(
            self.mutation_service.apply_mutations(request)
        )
        return {"ack": ack.to_dict()}
