from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from model.Item import Item
from module.Data.Core.ProjectSession import ProjectSession
from module.Data.Translation.TranslationResetService import TranslationResetService


def build_service() -> tuple[TranslationResetService, ProjectSession]:
    session = ProjectSession()
    session.db = SimpleNamespace()
    captured_batch: dict[str, object] = {}

    def record_update_batch(
        *,
        items: list[dict[str, object]] | None = None,
        meta: dict[str, object] | None = None,
    ) -> None:
        captured_batch["items"] = items
        captured_batch["meta"] = meta

    batch_service = SimpleNamespace(
        update_batch=MagicMock(side_effect=record_update_batch)
    )
    meta_service = SimpleNamespace(
        get_meta=MagicMock(return_value={"processed_line": 9, "line": 9})
    )
    item_service = SimpleNamespace(get_all_items=MagicMock(return_value=[]))
    service = TranslationResetService(
        session,
        batch_service,
        meta_service,
        item_service,
    )
    session.captured_batch = captured_batch
    return service, session


def test_reset_failed_translation_items_sync_returns_none_when_project_not_loaded() -> (
    None
):
    service, session = build_service()
    session.db = None

    assert service.reset_failed_translation_items_sync() is None


def test_reset_failed_translation_items_sync_resets_failed_items_and_progress() -> None:
    service, session = build_service()
    failed_item = Item(id=1, src="A", dst="旧译文", status=Base.ProjectStatus.ERROR)
    processed_item = Item(
        id=2, src="B", dst="保留", status=Base.ProjectStatus.PROCESSED
    )
    ignored_item = Item(id=3, src="C", dst="", status=Base.ProjectStatus.NONE)
    failed_item.set_retry_count(4)
    processed_item.set_retry_count(1)
    service.item_service.get_all_items.return_value = [
        failed_item,
        processed_item,
        ignored_item,
    ]

    extras = service.reset_failed_translation_items_sync()

    assert extras == {
        "processed_line": 1,
        "error_line": 0,
        "line": 1,
        "total_line": 3,
    }
    updated_items = session.captured_batch["items"]
    assert isinstance(updated_items, list)
    assert len(updated_items) == 1
    assert updated_items[0]["id"] == 1
    assert updated_items[0]["dst"] == ""
    assert updated_items[0]["status"] == Base.ProjectStatus.NONE
    assert updated_items[0]["retry_count"] == 0
    assert session.captured_batch["meta"] == {
        "translation_extras": extras,
        "project_status": Base.ProjectStatus.PROCESSING,
    }


def test_reset_failed_translation_items_sync_returns_none_when_no_items() -> None:
    service, session = build_service()
    service.item_service.get_all_items.return_value = []

    assert service.reset_failed_translation_items_sync() is None
    assert session.captured_batch == {}


def test_reset_failed_translation_items_sync_marks_project_processed_when_no_pending() -> (
    None
):
    service, session = build_service()
    service.meta_service.get_meta.return_value = []
    processed_item = Item(id=2, src="B", dst="保留", status=Base.ProjectStatus.PROCESSED)
    processed_in_past_item = Item(
        id=3,
        src="C",
        dst="旧译文",
        status=Base.ProjectStatus.PROCESSED_IN_PAST,
    )
    service.item_service.get_all_items.return_value = [
        processed_item,
        processed_in_past_item,
    ]

    extras = service.reset_failed_translation_items_sync()

    assert extras == {
        "processed_line": 1,
        "error_line": 0,
        "line": 1,
        "total_line": 1,
    }
    assert session.captured_batch["meta"] == {
        "translation_extras": extras,
        "project_status": Base.ProjectStatus.PROCESSED,
    }
