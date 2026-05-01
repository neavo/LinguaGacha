from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Proofreading.ProofreadingRetranslateService import (
    ProofreadingRetranslateService,
)


def build_data_manager() -> SimpleNamespace:
    current_items = [
        Item(
            id=1,
            src="勇者",
            dst="Hero",
            file_type=Item.FileType.TXT,
            file_path="script/a.txt",
            status=Base.ItemStatus.PROCESSED,
        ),
        Item(
            id=2,
            src="旁白",
            dst="Narration",
            file_type=Item.FileType.TXT,
            file_path="script/b.txt",
            status=Base.ItemStatus.PROCESSED,
        ),
    ]
    current_item_dicts = [item.to_dict() for item in current_items]
    return SimpleNamespace(
        save_item=MagicMock(side_effect=lambda target_item: target_item.get_id() or 0),
        is_loaded=MagicMock(return_value=True),
        get_all_items=MagicMock(return_value=current_items),
        get_item_dicts_by_ids=MagicMock(
            side_effect=lambda item_ids: [
                item_dict
                for item_id in item_ids
                for item_dict in current_item_dicts
                if item_dict.get("id") == item_id
            ]
        ),
        get_translation_extras=MagicMock(return_value={"line": 0}),
        set_translation_extras=MagicMock(),
        bump_project_runtime_section_revisions=MagicMock(return_value={"items": 2}),
    )


def test_retranslate_items_returns_project_item_change_and_emits_refresh() -> None:
    data_manager = build_data_manager()
    revision_service = SimpleNamespace(
        assert_revision=MagicMock(return_value=3),
        bump_revision=MagicMock(return_value=4),
        get_revision=MagicMock(return_value=3),
    )
    item = Item(
        id=1,
        src="勇者が来た",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.ERROR,
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(
            target_item, True
        ),
    )

    change = service.retranslate_items([item], expected_revision=3)

    assert change.item_ids == (1,)
    assert change.rel_paths == ("script/a.txt",)
    assert change.reason == "proofreading_retranslate_items"
    data_manager.get_item_dicts_by_ids.assert_called_once_with([1])
    data_manager.save_item.assert_called_once()
    data_manager.bump_project_runtime_section_revisions.assert_called_once_with(
        ("items",)
    )


def test_retranslate_items_marks_failed_items_as_error() -> None:
    data_manager = build_data_manager()
    revision_service = SimpleNamespace(
        assert_revision=MagicMock(return_value=None),
        bump_revision=MagicMock(return_value=0),
        get_revision=MagicMock(return_value=5),
    )
    item = Item(
        id=2,
        src="旁白",
        dst="旧译文",
        file_path="script/b.txt",
        status=Base.ItemStatus.PROCESSED,
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(
            target_item, False
        ),
    )

    change = service.retranslate_items([item])

    assert change.item_ids == (2,)
    saved_item = data_manager.save_item.call_args.args[0]
    assert saved_item.get_status() == Base.ItemStatus.ERROR


def test_retranslate_items_preserves_persisted_format_fields_for_frontend_payload() -> (
    None
):
    data_manager = build_data_manager()
    revision_service = SimpleNamespace(
        assert_revision=MagicMock(return_value=7),
        bump_revision=MagicMock(return_value=8),
        get_revision=MagicMock(return_value=7),
    )
    frontend_payload_item = Item(
        id=1,
        src="勇者",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ItemStatus.PROCESSED,
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(
            target_item, True
        ),
    )

    change = service.retranslate_items([frontend_payload_item], expected_revision=7)

    saved_item = data_manager.save_item.call_args.args[0]
    assert change.item_ids == (1,)
    assert saved_item.get_file_type() == Item.FileType.TXT
    assert saved_item.get_file_path() == "script/a.txt"
    assert saved_item.get_row() == 0
    assert frontend_payload_item.get_file_type() == Item.FileType.NONE


def test_retranslate_items_skips_missing_ids_without_creating_items() -> None:
    data_manager = build_data_manager()
    revision_service = SimpleNamespace(
        assert_revision=MagicMock(return_value=9),
        bump_revision=MagicMock(return_value=10),
        get_revision=MagicMock(return_value=9),
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(
            target_item, True
        ),
    )

    change = service.retranslate_items(
        [Item(id=404, src="missing")], expected_revision=9
    )

    assert change.item_ids == ()
    assert change.rel_paths == ()
    data_manager.save_item.assert_not_called()
    data_manager.bump_project_runtime_section_revisions.assert_not_called()
    revision_service.bump_revision.assert_not_called()
