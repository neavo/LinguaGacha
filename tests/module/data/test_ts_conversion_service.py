from module.Data.Extra.TsConversionService import TsConversionService


def test_ts_conversion_service_builds_default_options() -> None:
    # Arrange
    service = TsConversionService()

    # Act
    options = service.get_options_snapshot()

    # Assert
    assert options["default_direction"] == "TO_TRADITIONAL"
    assert options["preserve_text_enabled"] is True
    assert options["convert_name_enabled"] is True


def test_ts_conversion_service_start_conversion_emits_preparing_phase() -> None:
    # Arrange
    service = TsConversionService()
    observed: list[dict[str, object]] = []

    def progress_callback(payload: dict[str, object]) -> None:
        observed.append(payload)

    # Act
    result = service.start_conversion(
        {
            "direction": "TO_SIMPLIFIED",
            "preserve_text": True,
            "convert_name": False,
        },
        progress_callback,
    )

    # Assert
    assert result["task_id"] == "extra_ts_conversion"
    assert observed == [
        {
            "task_id": "extra_ts_conversion",
            "phase": "PREPARING",
            "current": 0,
            "total": 1,
            "message": "preparing",
        }
    ]
