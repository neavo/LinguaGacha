from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.Proofreading.ProofreadingRetranslateService import (
    ProofreadingRetranslateService,
)


def build_data_manager() -> SimpleNamespace:
    current_items = [Item(id=1, src="勇者", dst="Hero", file_path="script/a.txt")]
    return SimpleNamespace(
        save_item=MagicMock(side_effect=lambda target_item: target_item.get_id() or 0),
        is_loaded=MagicMock(return_value=True),
        get_all_items=MagicMock(return_value=current_items),
        set_project_status=MagicMock(),
        get_translation_extras=MagicMock(return_value={"line": 0}),
        set_translation_extras=MagicMock(),
        emit_project_item_change_refresh=MagicMock(),
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
        status=Base.ProjectStatus.ERROR,
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(target_item, True),
    )

    change = service.retranslate_items([item], expected_revision=3)

    assert change.item_ids == (1,)
    assert change.rel_paths == ("script/a.txt",)
    assert change.reason == "proofreading_retranslate_items"
    data_manager.save_item.assert_called_once()
    data_manager.emit_project_item_change_refresh.assert_called_once()


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
        status=Base.ProjectStatus.PROCESSED,
    )
    service = ProofreadingRetranslateService(
        data_manager=data_manager,
        config_loader=lambda: Config(),
        revision_service=revision_service,
        translate_item_runner=lambda target_item, config, callback: callback(target_item, False),
    )

    change = service.retranslate_items([item])

    assert change.item_ids == (2,)
    assert item.get_status() == Base.ProjectStatus.ERROR
