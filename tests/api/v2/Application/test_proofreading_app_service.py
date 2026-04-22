from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.Core.Item import Item

from api.v2.Application.ProofreadingAppService import ProofreadingAppService


class FakeProofreadingDataManager:
    def __init__(self) -> None:
        self.emitted_patches: list[dict[str, object]] = []

    def emit_project_runtime_patch(
        self,
        *,
        reason: str,
        updated_sections: tuple[str, ...],
        patch: list[dict[str, object]],
        section_revisions: dict[str, int] | None = None,
        project_revision: int | None = None,
    ) -> None:
        self.emitted_patches.append(
            {
                "reason": reason,
                "updated_sections": updated_sections,
                "patch": patch,
                "section_revisions": section_revisions or {},
                "project_revision": project_revision,
            }
        )


def build_app_service() -> tuple[
    ProofreadingAppService,
    FakeProofreadingDataManager,
    SimpleNamespace,
    SimpleNamespace,
]:
    data_manager = FakeProofreadingDataManager()
    mutation_service = SimpleNamespace(
        apply_manual_edit=MagicMock(
            return_value=ProjectItemChange(
                item_ids=(1,),
                rel_paths=("script/a.txt",),
                reason="proofreading_save_item",
            )
        ),
        save_all=MagicMock(
            return_value=ProjectItemChange(
                item_ids=(1, 2),
                rel_paths=("script/a.txt", "script/b.txt"),
                reason="proofreading_save_all",
            )
        ),
        replace_all=MagicMock(
            return_value=ProjectItemChange(
                item_ids=(1,),
                rel_paths=("script/a.txt",),
                reason="proofreading_replace_all",
            )
        ),
    )
    retranslate_service = SimpleNamespace(
        retranslate_items=MagicMock(
            return_value=ProjectItemChange(
                item_ids=(1, 2),
                rel_paths=("script/a.txt", "script/b.txt"),
                reason="proofreading_retranslate_items",
            )
        )
    )
    runtime_service = SimpleNamespace(
        build_item_records=MagicMock(
            return_value=[
                {
                    "item_id": 1,
                    "file_path": "script/a.txt",
                    "row_number": 12,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "status": "PROCESSED",
                    "text_type": "NONE",
                    "retry_count": 0,
                }
            ]
        ),
        build_proofreading_block=MagicMock(return_value={"revision": 9}),
        build_task_block=MagicMock(
            return_value={
                "task_type": "translation",
                "status": "IDLE",
                "busy": False,
            }
        ),
    )

    app_service = ProofreadingAppService(
        data_manager=data_manager,
        mutation_service=mutation_service,
        retranslate_service=retranslate_service,
        runtime_service=runtime_service,
    )
    return app_service, data_manager, mutation_service, retranslate_service


def test_proofreading_save_item_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, mutation_service, _ = build_app_service()

    result = app_service.save_item(
        {
            "item": {
                "id": 1,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "file_path": "script/a.txt",
                "status": Base.ProjectStatus.PROCESSED,
            },
            "new_dst": "Hero arrived again",
            "expected_revision": 7,
        }
    )

    mutation_service.apply_manual_edit.assert_called_once()
    called_item = mutation_service.apply_manual_edit.call_args.args[0]
    assert isinstance(called_item, Item)
    assert called_item.get_id() == 1
    assert result["result"] == {
        "revision": 9,
        "changed_item_ids": [1],
    }
    assert data_manager.emitted_patches[0]["updated_sections"] == (
        "items",
        "proofreading",
        "task",
    )


def test_proofreading_save_all_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, mutation_service, _ = build_app_service()

    result = app_service.save_all(
        {
            "items": [
                {
                    "id": 1,
                    "dst": "",
                    "status": Base.ProjectStatus.NONE,
                },
                {
                    "id": 2,
                    "dst": "",
                    "status": Base.ProjectStatus.NONE,
                },
            ],
            "expected_revision": 7,
        }
    )

    mutation_service.save_all.assert_called_once()
    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1, 2]
    assert data_manager.emitted_patches[0]["reason"] == "proofreading_save_all"


def test_proofreading_replace_all_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, mutation_service, _ = build_app_service()

    result = app_service.replace_all(
        {
            "items": [
                {
                    "id": 1,
                    "dst": "Hero arrived",
                    "status": Base.ProjectStatus.PROCESSED,
                }
            ],
            "search_text": "Hero",
            "replace_text": "Heroine",
            "expected_revision": 7,
        }
    )

    mutation_service.replace_all.assert_called_once()
    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1]
    assert data_manager.emitted_patches[0]["reason"] == "proofreading_replace_all"


def test_proofreading_retranslate_items_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, _, retranslate_service = build_app_service()

    result = app_service.retranslate_items(
        {
            "items": [
                {
                    "id": 1,
                    "src": "勇者が来た",
                    "dst": "Hero arrived",
                    "file_path": "script/a.txt",
                    "status": Base.ProjectStatus.PROCESSED,
                },
                {
                    "id": 2,
                    "src": "旁白",
                    "dst": "Narration",
                    "file_path": "script/b.txt",
                    "status": Base.ProjectStatus.NONE,
                },
            ],
            "expected_revision": 7,
        }
    )

    retranslate_service.retranslate_items.assert_called_once()
    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1, 2]
    assert data_manager.emitted_patches[0]["reason"] == "proofreading_retranslate_items"
