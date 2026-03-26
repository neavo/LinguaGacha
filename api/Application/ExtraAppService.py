from api.Contract.ExtraPayloads import LaboratorySnapshotPayload
from module.Data.Extra.LaboratoryService import LaboratoryService


class ExtraAppService:
    """把 Extra 入口的最小用例先收口到应用服务，方便继续 API 化扩展。"""

    def __init__(
        self,
        laboratory_service: LaboratoryService | None = None,
    ) -> None:
        self.laboratory_service = (
            laboratory_service
            if laboratory_service is not None
            else LaboratoryService()
        )

    def get_laboratory_snapshot(
        self,
        request: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """提供实验室首屏快照，避免页面直接读取配置单例。"""

        del request
        snapshot = self.laboratory_service.get_snapshot()
        return LaboratorySnapshotPayload.from_dict(snapshot).to_dict()

    def update_laboratory_settings(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        """提供实验室局部写入入口，避免页面自己决定配置持久化方式。"""

        snapshot = self.laboratory_service.update_settings(request)
        return LaboratorySnapshotPayload.from_dict(snapshot).to_dict()
