from base.Base import Base
from base.EventManager import EventManager
from api.Contract.ExtraPayloads import NameFieldSnapshotPayload
from api.Contract.ExtraPayloads import NameFieldTranslateResultPayload
from api.Contract.ExtraPayloads import TsConversionOptionsPayload
from api.Contract.ExtraPayloads import TsConversionTaskPayload
from api.Models.Extra import ExtraTaskState
from module.Data.Extra.NameFieldExtractionService import NameFieldExtractionService
from module.Data.Extra.TsConversionService import TsConversionService


class ExtraAppService:
    """把 Extra 入口的最小用例先收口到应用服务，方便继续 API 化扩展。"""

    def __init__(
        self,
        ts_conversion_service: TsConversionService | None = None,
        name_field_extraction_service: NameFieldExtractionService | None = None,
    ) -> None:
        self.ts_conversion_service = (
            ts_conversion_service
            if ts_conversion_service is not None
            else TsConversionService()
        )
        self.name_field_extraction_service = (
            name_field_extraction_service
            if name_field_extraction_service is not None
            else NameFieldExtractionService()
        )

    def get_ts_conversion_options(
        self,
        request: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """提供繁简转换默认选项，避免页面自行硬编码默认行为。"""

        del request
        options = self.ts_conversion_service.get_options_snapshot()
        return TsConversionOptionsPayload.from_dict(options).to_dict()

    def start_ts_conversion(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        """统一受理繁简转换任务，并把最小进度事件桥接到 SSE。"""

        task = self.ts_conversion_service.start_conversion(
            request,
            self.publish_ts_conversion_progress,
        )
        self.publish_ts_conversion_finished(
            {
                "task_id": str(task.get("task_id", "")),
                "phase": ExtraTaskState.PHASE_FINISHED,
                "message": "finished",
                "current": 1,
                "total": 1,
                "finished": True,
            }
        )
        return TsConversionTaskPayload.from_dict(task).to_dict()

    def get_name_field_snapshot(
        self,
        request: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """提供姓名字段快照入口，避免页面自己探测数据层。"""

        del request
        snapshot = self.name_field_extraction_service.get_name_field_snapshot()
        return NameFieldSnapshotPayload.from_dict(snapshot).to_dict()

    def extract_name_fields(
        self,
        request: dict[str, object] | None = None,
    ) -> dict[str, object]:
        """统一受理姓名字段提取命令，保持快照返回结构稳定。"""

        del request
        snapshot = self.name_field_extraction_service.extract_name_fields()
        return NameFieldSnapshotPayload.from_dict(snapshot).to_dict()

    def translate_name_fields(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        """统一受理姓名字段整表翻译，避免页面继续直接操作引擎。"""

        raw_items = request.get("items", [])
        items = raw_items if isinstance(raw_items, list) else []
        result = self.name_field_extraction_service.translate_name_fields(items)
        return NameFieldTranslateResultPayload.from_dict(result).to_dict()

    def save_name_fields_to_glossary(
        self,
        request: dict[str, object],
    ) -> dict[str, object]:
        """统一受理姓名字段导入术语表命令，避免页面继续直接写 glossary。"""

        raw_items = request.get("items", [])
        items = raw_items if isinstance(raw_items, list) else []
        snapshot = self.name_field_extraction_service.save_name_fields_to_glossary(
            items
        )
        return NameFieldSnapshotPayload.from_dict(snapshot).to_dict()

    def publish_ts_conversion_progress(self, payload: dict[str, object]) -> None:
        """应用服务统一发出繁简转换进度事件，避免页面自行拼装内部事件。"""

        EventManager.get().emit_event(Base.Event.EXTRA_TS_CONVERSION_PROGRESS, payload)

    def publish_ts_conversion_finished(self, payload: dict[str, object]) -> None:
        """任务结束时发出稳定完成事件，保证客户端可以收口终态。"""

        EventManager.get().emit_event(Base.Event.EXTRA_TS_CONVERSION_FINISHED, payload)
