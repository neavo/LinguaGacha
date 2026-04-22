from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.DataTypes import ProjectItemChange

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
    mutation_ack = {
        "accepted": True,
        "projectRevision": 11,
        "sectionRevisions": {
            "items": 8,
            "proofreading": 9,
        },
    }
    mutation_service = SimpleNamespace(
        persist_finalized_items=MagicMock(),
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
        build_project_mutation_ack=MagicMock(return_value=mutation_ack),
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
            "items": [
                {
                    "id": 1,
                    "src": "勇者が来た",
                    "dst": "Hero arrived again",
                    "file_path": "script/a.txt",
                    "status": Base.ProjectStatus.PROCESSED,
                }
            ],
            "translation_extras": {"line": 1},
            "project_status": "PROCESSING",
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    mutation_service.persist_finalized_items.assert_called_once_with(
        [
            {
                "id": 1,
                "src": "勇者が来た",
                "dst": "Hero arrived again",
                "file_path": "script/a.txt",
                "status": Base.ProjectStatus.PROCESSED,
            }
        ],
        translation_extras={"line": 1},
        project_status="PROCESSING",
        expected_section_revisions={"items": 7, "proofreading": 6},
        reason="proofreading_save_item",
    )
    assert result == {
        "accepted": True,
        "projectRevision": 11,
        "sectionRevisions": {
            "items": 8,
            "proofreading": 9,
        },
    }
    assert data_manager.emitted_patches == []


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
            "translation_extras": {"line": 2},
            "project_status": "NONE",
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    mutation_service.persist_finalized_items.assert_called_once_with(
        [
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
        translation_extras={"line": 2},
        project_status="NONE",
        expected_section_revisions={"items": 7, "proofreading": 6},
        reason="proofreading_save_all",
    )
    assert result["accepted"] is True
    assert result["sectionRevisions"] == {
        "items": 8,
        "proofreading": 9,
    }
    assert data_manager.emitted_patches == []


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
            "translation_extras": {"line": 1},
            "project_status": "PROCESSING",
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    mutation_service.persist_finalized_items.assert_called_once_with(
        [
            {
                "id": 1,
                "dst": "Hero arrived",
                "status": Base.ProjectStatus.PROCESSED,
            }
        ],
        translation_extras={"line": 1},
        project_status="PROCESSING",
        expected_section_revisions={"items": 7, "proofreading": 6},
        reason="proofreading_replace_all",
    )
    assert result["projectRevision"] == 11
    assert data_manager.emitted_patches == []


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
