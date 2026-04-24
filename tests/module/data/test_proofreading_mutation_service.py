from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from base.Base import Base
from module.Data.Core.Item import Item


def build_item(
    *,
    item_id: int,
    src: str,
    dst: str,
    file_path: str,
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
) -> Item:
    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=status,
    )


def build_fake_data_manager(
    *,
    proofreading_revision: int,
    items: list[dict[str, object]],
    item_section_revision: int = 7,
) -> tuple[SimpleNamespace, dict[str, object]]:
    meta_store: dict[str, object] = {
        "proofreading_revision.proofreading": proofreading_revision,
    }

    def assert_project_runtime_section_revision(
        section: str,
        expected_revision: int,
    ) -> int:
        if section != "items" or expected_revision != item_section_revision:
            raise ValueError("items revision conflict")
        return item_section_revision

    fake_data_manager = SimpleNamespace(
        session=SimpleNamespace(state_lock=threading.RLock()),
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
        get_all_item_dicts=MagicMock(
            side_effect=lambda: [dict(item) for item in items]
        ),
        update_batch=MagicMock(),
        assert_project_runtime_section_revision=MagicMock(
            side_effect=assert_project_runtime_section_revision,
        ),
        bump_project_runtime_section_revisions=MagicMock(),
    )
    return fake_data_manager, meta_store


def test_persist_finalized_items_normalizes_payload_and_bumps_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(
        proofreading_revision=3,
        items=[
            {
                "id": 1,
                "src": "勇者が来た",
                "dst": "",
                "status": "NONE",
                "file_path": "script/a.txt",
                "row": 1,
                "text_type": "NONE",
                "retry_count": 2,
            },
            {
                "id": 2,
                "src": "旁白",
                "dst": "Narration",
                "status": "PROCESSED",
                "file_path": "script/b.txt",
                "row": 2,
                "text_type": "NONE",
                "retry_count": 0,
            },
        ],
    )
    service = ProofreadingMutationService(data_manager=data_manager)

    result = service.persist_finalized_items(
        [
            {
                "item_id": "1",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "row_number": 5,
                "retry_count": 0,
            },
            {"id": 404, "dst": "missing"},
        ],
        translation_extras={"line": 1},
        project_status="PROCESSING",
        expected_section_revisions={"proofreading": 3, "items": 7},
        reason="proofreading_save_item",
    )

    data_manager.update_batch.assert_called_once_with(
        items=[
            {
                "id": 1,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "file_path": "script/a.txt",
                "row": 5,
                "text_type": "NONE",
                "retry_count": 0,
            }
        ],
        meta={
            "translation_extras": {"line": 1},
            "project_status": "PROCESSING",
        },
    )
    data_manager.bump_project_runtime_section_revisions.assert_called_once_with(
        ("items",)
    )
    assert meta_store["proofreading_revision.proofreading"] == 4
    assert result.item_ids == (1,)
    assert result.rel_paths == ("script/a.txt",)
    assert result.reason == "proofreading_save_item"


def test_persist_finalized_items_rejects_stale_proofreading_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingRevisionConflictError,
    )
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(
        proofreading_revision=4,
        items=[
            {
                "id": 1,
                "src": "勇者が来た",
                "dst": "",
                "status": "NONE",
                "file_path": "script/a.txt",
            }
        ],
    )
    service = ProofreadingMutationService(data_manager=data_manager)

    with pytest.raises(ProofreadingRevisionConflictError):
        service.persist_finalized_items(
            [{"id": 1, "dst": "Hero arrived"}],
            translation_extras={},
            project_status="PROCESSING",
            expected_section_revisions={"proofreading": 3},
            reason="proofreading_save_item",
        )

    data_manager.update_batch.assert_not_called()
    assert meta_store["proofreading_revision.proofreading"] == 4


def test_persist_finalized_items_keeps_meta_write_when_no_item_matches() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(
        proofreading_revision=1,
        items=[
            {
                "id": 1,
                "src": "勇者が来た",
                "dst": "",
                "status": "NONE",
                "file_path": "script/a.txt",
            }
        ],
    )
    service = ProofreadingMutationService(data_manager=data_manager)

    result = service.persist_finalized_items(
        [{"id": 404, "dst": "missing"}],
        translation_extras={"line": 0},
        project_status="PROCESSING",
        expected_section_revisions=None,
        reason="proofreading_save_all",
    )

    data_manager.update_batch.assert_called_once_with(
        items=None,
        meta={
            "translation_extras": {"line": 0},
            "project_status": "PROCESSING",
        },
    )
    assert meta_store["proofreading_revision.proofreading"] == 2
    assert result.item_ids == ()
    assert result.rel_paths == ()


def test_build_project_item_change_accepts_items_and_payload_dicts() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, _meta_store = build_fake_data_manager(
        proofreading_revision=1,
        items=[],
    )
    service = ProofreadingMutationService(data_manager=data_manager)

    result = service.build_project_item_change(
        [
            build_item(
                item_id=1,
                src="勇者が来た",
                dst="Hero arrived",
                file_path="script/a.txt",
            ),
            {"item_id": 2, "file_path": "script/b.txt"},
            {"id": 1, "file_path": "script/a.txt"},
            {"id": "ignored", "file_path": ""},
        ],
        reason="proofreading_replace_all",
    )

    assert result.item_ids == (1, 2)
    assert result.rel_paths == ("script/a.txt", "script/b.txt")
    assert result.reason == "proofreading_replace_all"
