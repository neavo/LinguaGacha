from module.Migration.ItemStatusMigrationService import ItemStatusMigrationService


def test_normalize_item_payload_rewrites_legacy_status_and_preserves_fields() -> None:
    item_data = {
        "src": "old",
        "dst": "done",
        "status": "PROCESSED_IN_PAST",
        "extra_field": {"keep": True},
    }

    normalized_data, changed = ItemStatusMigrationService.normalize_item_payload(
        item_data
    )

    assert changed is True
    assert normalized_data == {
        "src": "old",
        "dst": "done",
        "status": "PROCESSED",
        "extra_field": {"keep": True},
    }
    assert item_data["status"] == "PROCESSED_IN_PAST"


def test_normalize_item_payload_leaves_current_status_untouched() -> None:
    item_data = {"src": "new", "status": "PROCESSED"}

    normalized_data, changed = ItemStatusMigrationService.normalize_item_payload(
        item_data
    )

    assert changed is False
    assert normalized_data is item_data


def test_normalize_item_payload_rewrites_legacy_processing_to_none() -> None:
    item_data = {"src": "old", "status": "PROCESSING"}

    normalized_data, changed = ItemStatusMigrationService.normalize_item_payload(
        item_data
    )

    assert changed is True
    assert normalized_data == {"src": "old", "status": "NONE"}


def test_normalize_item_status_value_rejects_unknown_status() -> None:
    assert ItemStatusMigrationService.normalize_item_status_value("UNKNOWN") == "NONE"
