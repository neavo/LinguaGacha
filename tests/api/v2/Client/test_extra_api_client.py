from collections.abc import Callable

from api.v2.Application.ExtraAppService import ExtraAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.ExtraApiClient import ExtraApiClient
from api.v2.Server.Routes.ExtraRoutes import ExtraRoutes
from api.v2.Models.Extra import NameFieldSnapshot
from api.v2.Models.Extra import NameFieldTranslateResult
from api.v2.Models.Extra import TsConversionOptionsSnapshot
from api.v2.Models.Extra import TsConversionTaskAccepted


class FakeNameFieldExtractionService:
    """为客户端测试提供稳定的姓名字段服务桩。"""

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


def test_extra_api_client_get_ts_conversion_options_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(extra_app_service=ExtraAppService())
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.get_ts_conversion_options()

    # Assert
    assert isinstance(result, TsConversionOptionsSnapshot)
    assert result.default_direction == "TO_TRADITIONAL"
    assert result.preserve_text_enabled is True
    assert result.convert_name_enabled is True


def test_extra_api_client_get_name_field_snapshot_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            name_field_extraction_service=FakeNameFieldExtractionService()
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.get_name_field_snapshot()

    # Assert
    assert isinstance(result, NameFieldSnapshot)
    assert result.items[0].src == "勇者"
    assert result.items[0].dst == ""


def test_extra_api_client_start_ts_conversion_returns_task_result(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(extra_app_service=ExtraAppService())
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.start_ts_conversion(
        {
            "direction": "TO_SIMPLIFIED",
            "preserve_text": True,
            "convert_name": False,
        }
    )

    # Assert
    assert isinstance(result, TsConversionTaskAccepted)
    assert result.accepted is True
    assert result.task_id == "extra_ts_conversion"


def test_extra_api_client_extract_name_fields_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            name_field_extraction_service=FakeNameFieldExtractionService()
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.extract_name_fields()

    # Assert
    assert isinstance(result, NameFieldSnapshot)
    assert result.items[0].src == "勇者"
    assert result.items[0].context == "勇者が来た"


def test_extra_api_client_translate_name_fields_returns_translate_result(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            name_field_extraction_service=FakeNameFieldExtractionService()
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.translate_name_fields(
        [
            {
                "src": "勇者",
                "dst": "",
                "context": "勇者が来た",
                "status": "未翻译",
            }
        ]
    )

    # Assert
    assert isinstance(result, NameFieldTranslateResult)
    assert result.success_count == 1
    assert result.failed_count == 0
    assert result.items[0].dst == "Hero"


def test_extra_api_client_save_name_fields_to_glossary_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            name_field_extraction_service=FakeNameFieldExtractionService()
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.save_name_fields_to_glossary(
        [
            {
                "src": "勇者",
                "dst": "Hero",
                "context": "勇者が来た",
                "status": "翻译完成",
            }
        ]
    )

    # Assert
    assert isinstance(result, NameFieldSnapshot)
    assert result.items[0].src == "勇者"
    assert result.items[0].dst == "Hero"
    assert ExtraRoutes.NAME_FIELD_SAVE_GLOSSARY_PATH.endswith("save-to-glossary")
