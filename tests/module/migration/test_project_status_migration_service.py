from module.Migration.ProjectStatusMigrationService import ProjectStatusMigrationService


def test_normalize_item_payload_rewrites_legacy_status_and_preserves_fields() -> None:
    item_data = {
        "src": "old",
        "dst": "done",
        "status": "PROCESSED_IN_PAST",
        "extra_field": {"keep": True},
    }

    normalized_data, changed = ProjectStatusMigrationService.normalize_item_payload(
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

    normalized_data, changed = ProjectStatusMigrationService.normalize_item_payload(
        item_data
    )

    assert changed is False
    assert normalized_data is item_data


def test_normalize_project_status_meta_rewrites_legacy_status() -> None:
    normalized_status, changed = (
        ProjectStatusMigrationService.normalize_project_status_meta("PROCESSED_IN_PAST")
    )

    assert changed is True
    assert normalized_status == "PROCESSED"


def test_normalize_project_status_meta_leaves_current_status_untouched() -> None:
    normalized_status, changed = (
        ProjectStatusMigrationService.normalize_project_status_meta("PROCESSING")
    )

    assert changed is False
    assert normalized_status == "PROCESSING"
