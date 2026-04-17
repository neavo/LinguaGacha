from collections.abc import Callable

from api.Application.ExtraAppService import ExtraAppService
from api.Client.ApiClient import ApiClient
from api.Client.ExtraApiClient import ExtraApiClient
from api.Server.Routes.ExtraRoutes import ExtraRoutes
from model.Api import ExtraToolEntry
from model.Api import ExtraToolSnapshot
from model.Api import LaboratorySnapshot
from model.Api import NameFieldEntryDraft
from model.Api import NameFieldSnapshot
from model.Api import NameFieldTranslateResult
from model.Api import TsConversionOptionsSnapshot
from model.Api import TsConversionTaskAccepted
from module.Data.Extra.LaboratoryService import LaboratoryService
from tests.api.support.application_fakes import FakeSettingsConfig


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


def test_extra_models_expose_minimal_ts_conversion_contract() -> None:
    # Arrange
    snapshot = TsConversionOptionsSnapshot()
    accepted = TsConversionTaskAccepted()

    # Assert
    assert snapshot.default_direction == ""
    assert snapshot.preserve_text_enabled is False
    assert snapshot.convert_name_enabled is False
    assert accepted.accepted is False
    assert accepted.task_id == ""


def test_extra_models_expose_minimal_name_field_contract() -> None:
    # Arrange
    draft = NameFieldEntryDraft()
    name_field_snapshot = NameFieldSnapshot()
    translate_result = NameFieldTranslateResult()

    # Assert
    assert draft.src == ""
    assert draft.dst == ""
    assert draft.context == ""
    assert draft.status == ""
    assert name_field_snapshot.items == ()
    assert translate_result.items == ()
    assert translate_result.success_count == 0
    assert translate_result.failed_count == 0


def test_extra_models_expose_minimal_laboratory_and_tool_contract() -> None:
    # Arrange
    laboratory_snapshot = LaboratorySnapshot()
    tool_entry = ExtraToolEntry()
    tool_snapshot = ExtraToolSnapshot()

    # Assert
    assert laboratory_snapshot.mtool_optimizer_enabled is True
    assert laboratory_snapshot.force_thinking_enabled is False
    assert tool_entry.tool_id == ""
    assert tool_snapshot.entries == ()


def test_extra_api_client_get_laboratory_snapshot_returns_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    fake_settings_config.mtool_optimizer_enable = False
    fake_settings_config.force_thinking_enable = True
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            laboratory_service=LaboratoryService(
                config_loader=lambda: fake_settings_config
            )
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.get_laboratory_snapshot()

    # Assert
    assert isinstance(result, LaboratorySnapshot)
    assert result.mtool_optimizer_enabled is False
    assert result.force_thinking_enabled is True


def test_extra_api_client_update_laboratory_settings_returns_snapshot(
    fake_settings_config: FakeSettingsConfig,
    start_api_server: Callable[..., str],
) -> None:
    # Arrange
    fake_settings_config.mtool_optimizer_enable = False
    fake_settings_config.force_thinking_enable = False
    base_url = start_api_server(
        extra_app_service=ExtraAppService(
            laboratory_service=LaboratoryService(
                config_loader=lambda: fake_settings_config
            )
        )
    )
    extra_api_client = ExtraApiClient(ApiClient(base_url))

    # Act
    result = extra_api_client.update_laboratory_settings(
        {"force_thinking_enabled": True}
    )

    # Assert
    assert isinstance(result, LaboratorySnapshot)
    assert result.force_thinking_enabled is True


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
