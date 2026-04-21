from collections.abc import Callable

from api.v2.Models.Extra import ExtraTaskState


class TsConversionService:
    """把繁简转换的最小任务协议下沉到数据层，避免页面继续自管任务入口。"""

    TASK_ID: str = "extra_ts_conversion"
    DEFAULT_DIRECTION: str = "TO_TRADITIONAL"
    PREPARING_MESSAGE: str = "preparing"

    def get_options_snapshot(self) -> dict[str, object]:
        """统一返回繁简转换的默认选项，保证客户端与页面读到同一份配置。"""

        return {
            "default_direction": self.DEFAULT_DIRECTION,
            "preserve_text_enabled": True,
            "convert_name_enabled": True,
        }

    def start_conversion(
        self,
        request: dict[str, object],
        progress_callback: Callable[[dict[str, object]], None],
    ) -> dict[str, object]:
        """先提供最小受理闭环，并通过回调发出可桥接的准备进度。"""

        normalized_request = dict(request)
        del normalized_request
        progress_callback(
            {
                "task_id": self.TASK_ID,
                "phase": ExtraTaskState.PHASE_PREPARING,
                "current": 0,
                "total": 1,
                "message": self.PREPARING_MESSAGE,
            }
        )
        return {"task_id": self.TASK_ID, "accepted": True}
