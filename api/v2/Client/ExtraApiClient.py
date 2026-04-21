from typing import Any

from api.v2.Client.ApiClient import ApiClient
from api.v2.Server.Routes.ExtraRoutes import ExtraRoutes
from api.v2.Models.Extra import NameFieldSnapshot
from api.v2.Models.Extra import NameFieldTranslateResult
from api.v2.Models.Extra import TsConversionOptionsSnapshot
from api.v2.Models.Extra import TsConversionTaskAccepted


class ExtraApiClient:
    """Extra 能力客户端，统一收口工具页 HTTP 调用。"""

    def __init__(self, api_client: ApiClient) -> None:
        self.api_client = api_client

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

    def get_name_field_snapshot(self) -> NameFieldSnapshot:
        """读取姓名字段快照，避免页面继续自己扫描工程条目。"""

        response = self.api_client.post(ExtraRoutes.NAME_FIELD_SNAPSHOT_PATH, {})
        return NameFieldSnapshot.from_dict(response.get("snapshot", {}))

    def extract_name_fields(self) -> NameFieldSnapshot:
        """触发姓名字段提取，并返回服务端确认后的整表快照。"""

        response = self.api_client.post(ExtraRoutes.NAME_FIELD_EXTRACT_PATH, {})
        return NameFieldSnapshot.from_dict(response.get("snapshot", {}))

    def translate_name_fields(
        self,
        items: list[dict[str, Any]],
    ) -> NameFieldTranslateResult:
        """提交姓名字段整表翻译请求，并返回完整结果与统计。"""

        response = self.api_client.post(
            ExtraRoutes.NAME_FIELD_TRANSLATE_PATH,
            {"items": items},
        )
        return NameFieldTranslateResult.from_dict(response.get("result", {}))

    def save_name_fields_to_glossary(
        self,
        items: list[dict[str, Any]],
    ) -> NameFieldSnapshot:
        """提交姓名字段整表导入请求，并返回服务端确认后的快照。"""

        response = self.api_client.post(
            ExtraRoutes.NAME_FIELD_SAVE_GLOSSARY_PATH,
            {"items": items},
        )
        return NameFieldSnapshot.from_dict(response.get("snapshot", {}))
