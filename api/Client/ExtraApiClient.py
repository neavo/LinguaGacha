from typing import Any

from api.Client.ApiClient import ApiClient
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from model.Api.ExtraModels import LaboratorySnapshot
from model.Api.ExtraModels import TsConversionOptionsSnapshot
from model.Api.ExtraModels import TsConversionTaskAccepted


class ExtraApiClient:
    """实验室最小闭环客户端，先收口快照与更新两类调用。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

    def get_laboratory_snapshot(self) -> LaboratorySnapshot:
        """读取实验室快照，避免页面继续依赖协议字典。"""

        response = self.api_client.post(ExtraRoutes.SNAPSHOT_PATH, {})
        return LaboratorySnapshot.from_dict(response.get("snapshot", {}))

    def update_laboratory_settings(
        self,
        request: dict[str, Any],
    ) -> LaboratorySnapshot:
        """提交实验室局部配置变更，并返回服务端确认后的最新快照。"""

        response = self.api_client.post(ExtraRoutes.UPDATE_PATH, request)
        return LaboratorySnapshot.from_dict(response.get("snapshot", {}))

    def get_ts_conversion_options(self) -> TsConversionOptionsSnapshot:
        """读取繁简转换默认选项，避免页面继续硬编码协议字典。"""

        response = self.api_client.post(ExtraRoutes.TS_CONVERSION_OPTIONS_PATH, {})
        return TsConversionOptionsSnapshot.from_dict(response.get("options", {}))

    def start_ts_conversion(
        self,
        request: dict[str, Any],
    ) -> TsConversionTaskAccepted:
        """发起繁简转换任务，并返回稳定的任务受理对象。"""

        response = self.api_client.post(ExtraRoutes.TS_CONVERSION_START_PATH, request)
        return TsConversionTaskAccepted.from_dict(response.get("task", {}))
