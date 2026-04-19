import pytest

from api.Application.ExtraAppService import ExtraAppService


class FakeTsConversionService:
    """提供可观测的繁简转换假服务，便于断言应用层返回与事件桥接。"""

    def __init__(self) -> None:
        self.received_requests: list[dict[str, object]] = []

    def get_options_snapshot(self) -> dict[str, object]:
        return {
            "default_direction": "TO_SIMPLIFIED",
            "preserve_text_enabled": True,
            "convert_name_enabled": False,
        }

    def start_conversion(
        self,
        request: dict[str, object],
        progress_callback,
    ) -> dict[str, object]:
        self.received_requests.append(dict(request))
        progress_callback(
            {
                "task_id": "extra_ts_conversion",
                "phase": "PREPARING",
                "message": "preparing",
                "current": 0,
                "total": 1,
            }
        )
        return {
            "task_id": "extra_ts_conversion",
            "accepted": True,
        }


class FakeNameFieldExtractionService:
    """为 Extra 应用服务测试提供稳定的姓名字段服务桩。"""

    def get_name_field_snapshot(self) -> dict[str, object]:
        return self.extract_name_fields()

    def extract_name_fields(self) -> dict[str, object]:
        return {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "未翻译",
                }
            ]
        }

    def translate_name_fields(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        del items
        return {
            "items": [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ],
            "success_count": 1,
            "failed_count": 0,
        }

    def save_name_fields_to_glossary(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        return {"items": items}


class RecordingExtraAppService(ExtraAppService):
    """把对外可观察的任务事件记录下来，避免测试依赖 EventManager 单例。"""

    def __init__(self) -> None:
        super().__init__(
            ts_conversion_service=FakeTsConversionService(),
            name_field_extraction_service=FakeNameFieldExtractionService(),
        )
        self.progress_events: list[dict[str, object]] = []
        self.finished_events: list[dict[str, object]] = []

    def publish_ts_conversion_progress(self, payload: dict[str, object]) -> None:
        self.progress_events.append(dict(payload))

    def publish_ts_conversion_finished(self, payload: dict[str, object]) -> None:
        self.finished_events.append(dict(payload))


@pytest.fixture
def extra_app_service() -> RecordingExtraAppService:
    return RecordingExtraAppService()


def test_extra_app_service_get_ts_conversion_options_returns_options_payload() -> None:
    # Arrange
    service = RecordingExtraAppService()

    # Act
    result = service.get_ts_conversion_options()

    # Assert
    assert result == {
        "options": {
            "default_direction": "TO_SIMPLIFIED",
            "preserve_text_enabled": True,
            "convert_name_enabled": False,
        }
    }


def test_start_ts_conversion_returns_task_payload(
    extra_app_service: RecordingExtraAppService,
) -> None:
    # Arrange
    request = {
        "direction": "TO_SIMPLIFIED",
        "preserve_text": True,
        "convert_name": False,
    }

    # Act
    result = extra_app_service.start_ts_conversion(request)

    # Assert
    assert result["task"]["task_id"] == "extra_ts_conversion"
    assert result["task"]["accepted"] is True
    assert extra_app_service.ts_conversion_service.received_requests == [request]
    assert extra_app_service.progress_events == [
        {
            "task_id": "extra_ts_conversion",
            "phase": "PREPARING",
            "message": "preparing",
            "current": 0,
            "total": 1,
        }
    ]
    assert extra_app_service.finished_events == [
        {
            "task_id": "extra_ts_conversion",
            "phase": "FINISHED",
            "message": "finished",
            "current": 1,
            "total": 1,
            "finished": True,
        }
    ]


def test_extra_app_service_get_name_field_snapshot_returns_snapshot_payload() -> None:
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.get_name_field_snapshot()

    # Assert
    assert result["snapshot"]["items"][0]["src"] == "勇者"
    assert result["snapshot"]["items"][0]["context"] == "勇者が来た"


def test_extra_app_service_extract_name_fields_returns_snapshot_payload() -> None:
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.extract_name_fields()

    # Assert
    assert result["snapshot"]["items"] == [
        {
            "src": "勇者",
            "dst": "",
            "context": "勇者が来た",
            "status": "未翻译",
        }
    ]


def test_extra_app_service_translate_name_fields_returns_translate_payload() -> None:
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.translate_name_fields(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "",
                    "context": "勇者が来た",
                    "status": "未翻译",
                }
            ]
        }
    )

    # Assert
    assert result["result"]["success_count"] == 1
    assert result["result"]["failed_count"] == 0
    assert result["result"]["items"][0]["dst"] == "Hero"


def test_extra_app_service_save_name_fields_to_glossary_returns_snapshot_payload() -> (
    None
):
    # Arrange
    service = ExtraAppService(
        name_field_extraction_service=FakeNameFieldExtractionService()
    )

    # Act
    result = service.save_name_fields_to_glossary(
        {
            "items": [
                {
                    "src": "勇者",
                    "dst": "Hero",
                    "context": "勇者が来た",
                    "status": "翻译完成",
                }
            ]
        }
    )

    # Assert
    assert result["snapshot"]["items"][0]["src"] == "勇者"
    assert result["snapshot"]["items"][0]["dst"] == "Hero"
