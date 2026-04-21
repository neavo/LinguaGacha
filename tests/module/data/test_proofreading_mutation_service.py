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
    """构造最小条目对象，方便验证写入与状态变更。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=status,
    )


def build_fake_data_manager(
    *,
    revision: int,
    loaded: bool = True,
    items_all: list[Item] | None = None,
) -> tuple[SimpleNamespace, dict[str, object]]:
    """构造最小写入口假对象，方便验证 revision 与写回。"""

    meta_store: dict[str, object] = {
        "proofreading_revision.proofreading": revision,
    }
    all_items = list(items_all) if items_all is not None else []
    project_state: dict[str, object] = {
        "project_status": Base.ProjectStatus.NONE,
        "translation_extras": {"line": 0},
    }

    def save_item(item: Item) -> int:
        item_id = item.get_id() or 0
        for index, current_item in enumerate(all_items):
            if current_item.get_id() == item_id:
                all_items[index] = item
                break
        else:
            all_items.append(item)
        return item_id

    def replace_all_items(items: list[Item]) -> list[int]:
        all_items.clear()
        all_items.extend(items)
        return [item.get_id() or 0 for item in items]

    def update_batch(*, items: list[dict[str, object]]) -> None:
        for payload in items:
            for current_item in all_items:
                if current_item.get_id() != payload.get("id"):
                    continue
                if "dst" in payload:
                    current_item.set_dst(str(payload["dst"]))
                if "status" in payload:
                    current_item.set_status(payload["status"])
                break

    fake_data_manager = SimpleNamespace(
        session=SimpleNamespace(state_lock=threading.RLock()),
        save_item=MagicMock(side_effect=save_item),
        replace_all_items=MagicMock(side_effect=replace_all_items),
        update_batch=MagicMock(side_effect=update_batch),
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
        is_loaded=MagicMock(return_value=loaded),
        get_all_items=MagicMock(side_effect=lambda: list(all_items)),
        set_project_status=MagicMock(
            side_effect=lambda status: project_state.__setitem__(
                "project_status", status
            )
        ),
        get_translation_extras=MagicMock(
            side_effect=lambda: dict(project_state["translation_extras"])
        ),
        set_translation_extras=MagicMock(
            side_effect=lambda extras: project_state.__setitem__(
                "translation_extras", dict(extras)
            )
        ),
    )
    meta_store["project_state"] = project_state
    return fake_data_manager, meta_store


def test_apply_manual_edit_updates_status_and_bumps_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=3)
    service = ProofreadingMutationService(data_manager=data_manager)
    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="",
        file_path="script/a.txt",
    )

    result = service.apply_manual_edit(
        item,
        "Hero arrived",
        expected_revision=3,
    )

    assert result.item_ids == (1,)
    assert result.rel_paths == ("script/a.txt",)
    assert item.get_dst() == "Hero arrived"
    assert item.get_status() == Base.ProjectStatus.PROCESSED
    assert data_manager.save_item.call_count == 1
    assert meta_store["proofreading_revision.proofreading"] == 4


def test_apply_manual_edit_rejects_stale_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingRevisionConflictError,
    )
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, _meta_store = build_fake_data_manager(revision=4)
    service = ProofreadingMutationService(data_manager=data_manager)
    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="",
        file_path="script/a.txt",
    )

    with pytest.raises(ProofreadingRevisionConflictError):
        service.apply_manual_edit(
            item,
            "Hero arrived",
            expected_revision=3,
        )

    assert data_manager.save_item.call_count == 0


def test_apply_manual_edit_does_not_mutate_item_when_save_fails() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=4)
    data_manager.save_item.side_effect = RuntimeError("save failed")
    service = ProofreadingMutationService(data_manager=data_manager)
    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="旧译文",
        file_path="script/a.txt",
        status=Base.ProjectStatus.ERROR,
    )

    with pytest.raises(RuntimeError, match="save failed"):
        service.apply_manual_edit(
            item,
            "新译文",
            expected_revision=4,
        )

    assert item.get_dst() == "旧译文"
    assert item.get_status() == Base.ProjectStatus.ERROR
    assert meta_store["proofreading_revision.proofreading"] == 4


def test_save_all_replaces_all_items_and_bumps_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=8)
    service = ProofreadingMutationService(data_manager=data_manager)
    items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="Hero arrived",
            file_path="script/a.txt",
        ),
        build_item(
            item_id=2,
            src="旁白",
            dst="Narration",
            file_path="script/b.txt",
        ),
    ]

    result = service.save_all(items, expected_revision=8)

    assert result.item_ids == (1, 2)
    assert result.rel_paths == ("script/a.txt", "script/b.txt")
    assert data_manager.replace_all_items.call_count == 1
    assert meta_store["proofreading_revision.proofreading"] == 9


def test_replace_all_returns_changed_item_ids_and_bumps_revision() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=2)
    service = ProofreadingMutationService(data_manager=data_manager)
    items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="alpha alpha",
            file_path="script/a.txt",
        ),
        build_item(
            item_id=2,
            src="旁白",
            dst="beta",
            file_path="script/b.txt",
            status=Base.ProjectStatus.PROCESSED_IN_PAST,
        ),
    ]

    result = service.replace_all(
        items,
        expected_revision=2,
        search_text="alpha",
        replace_text="bravo",
    )

    assert result.item_ids == (1,)
    assert result.rel_paths == ("script/a.txt",)
    assert result.reason == "proofreading_replace_all"
    assert items[0].get_dst() == "bravo bravo"
    assert items[0].get_status() == Base.ProjectStatus.PROCESSED
    assert data_manager.update_batch.call_count == 1
    assert meta_store["proofreading_revision.proofreading"] == 3


def test_replace_all_does_not_mutate_items_when_write_fails() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=6)
    data_manager.update_batch.side_effect = RuntimeError("batch failed")
    service = ProofreadingMutationService(data_manager=data_manager)
    item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="alpha",
        file_path="script/a.txt",
        status=Base.ProjectStatus.ERROR,
    )

    with pytest.raises(RuntimeError, match="batch failed"):
        service.replace_all(
            [item],
            expected_revision=6,
            search_text="alpha",
            replace_text="bravo",
        )

    assert item.get_dst() == "alpha"
    assert item.get_status() == Base.ProjectStatus.ERROR
    assert meta_store["proofreading_revision.proofreading"] == 6


def test_replace_all_skips_write_when_no_item_changed() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, meta_store = build_fake_data_manager(revision=5)
    service = ProofreadingMutationService(data_manager=data_manager)
    items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="alpha",
            file_path="script/a.txt",
        )
    ]

    result = service.replace_all(
        items,
        expected_revision=5,
        search_text="missing",
        replace_text="bravo",
    )

    assert result.item_ids == ()
    assert result.rel_paths == ()
    assert data_manager.update_batch.call_count == 0
    assert meta_store["proofreading_revision.proofreading"] == 5


def test_replace_batch_forwards_payload_to_data_manager() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, _meta_store = build_fake_data_manager(revision=1)
    service = ProofreadingMutationService(data_manager=data_manager)

    service.replace_batch(
        [
            {
                "id": 1,
                "dst": "新的译文",
                "status": Base.ProjectStatus.PROCESSED,
            }
        ]
    )

    assert data_manager.update_batch.call_count == 1


def test_apply_manual_edit_syncs_project_translation_state_and_line_count() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    edited_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="",
        file_path="script/a.txt",
        status=Base.ProjectStatus.NONE,
    )
    data_manager, meta_store = build_fake_data_manager(
        revision=10,
        items_all=[edited_item],
    )
    service = ProofreadingMutationService(data_manager=data_manager)

    result = service.apply_manual_edit(
        edited_item,
        "Hero arrived",
        expected_revision=10,
    )

    assert result.item_ids == (1,)
    assert result.rel_paths == ("script/a.txt",)
    assert meta_store["proofreading_revision.proofreading"] == 11
    assert meta_store["project_state"] == {
        "project_status": Base.ProjectStatus.PROCESSED,
        "translation_extras": {"line": 1},
    }
    data_manager.set_project_status.assert_called_once_with(
        Base.ProjectStatus.PROCESSED
    )
    data_manager.set_translation_extras.assert_called_once_with({"line": 1})


def test_sync_project_translation_state_requires_full_data_manager_contract() -> None:
    from module.Data.Proofreading.ProofreadingMutationService import (
        ProofreadingMutationService,
    )

    data_manager, _meta_store = build_fake_data_manager(revision=1)
    delattr(data_manager, "is_loaded")
    service = ProofreadingMutationService(data_manager=data_manager)

    with pytest.raises(AttributeError):
        service.sync_project_translation_state()
