from __future__ import annotations

from base.Base import Base

from api.Application.ProofreadingAppService import ProofreadingAppService


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


class RecordingProofreadingMutationService:
    def __init__(self) -> None:
        self.persist_finalized_items_calls: list[dict[str, object]] = []

    def persist_finalized_items(
        self,
        items: list[dict[str, object]],
        *,
        translation_extras: dict[str, object],
        expected_section_revisions: dict[str, int] | None,
        reason: str,
    ) -> None:
        self.persist_finalized_items_calls.append(
            {
                "items": [dict(item) for item in items],
                "translation_extras": dict(translation_extras),
                "expected_section_revisions": (
                    dict(expected_section_revisions)
                    if expected_section_revisions is not None
                    else None
                ),
                "reason": reason,
            }
        )


class RecordingProjectRuntimeService:
    SECTION_REVISIONS: dict[str, int] = {
        "project": 1,
        "files": 1,
        "items": 2,
        "quality": 1,
        "prompts": 1,
        "analysis": 1,
        "proofreading": 9,
        "task": 0,
    }

    def build_item_records(self, item_ids: list[int]) -> list[dict[str, object]]:
        return [
            {
                "item_id": item_id,
                "file_path": "script/a.txt",
                "row_number": 12,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "status": "PROCESSED",
                "text_type": "NONE",
                "retry_count": 0,
            }
            for item_id in item_ids
        ]

    def build_proofreading_block(self) -> dict[str, object]:
        return {"revision": 9}

    def build_task_block(self) -> dict[str, object]:
        return {
            "task_type": "translation",
            "status": "IDLE",
            "busy": False,
        }

    def get_section_revision(self, section: str) -> int:
        return self.SECTION_REVISIONS.get(section, 0)

    def build_section_revisions(self) -> dict[str, int]:
        return dict(self.SECTION_REVISIONS)

    def build_project_mutation_ack(
        self,
        updated_sections: list[str],
    ) -> dict[str, object]:
        return {
            "accepted": True,
            "projectRevision": 11,
            "sectionRevisions": {
                "items": 8,
                "proofreading": 9,
            },
        }


def build_app_service() -> tuple[
    ProofreadingAppService,
    FakeProofreadingDataManager,
    RecordingProofreadingMutationService,
]:
    data_manager = FakeProofreadingDataManager()
    mutation_service = RecordingProofreadingMutationService()
    runtime_service = RecordingProjectRuntimeService()

    app_service = ProofreadingAppService(
        data_manager=data_manager,
        mutation_service=mutation_service,
        runtime_service=runtime_service,
    )
    return app_service, data_manager, mutation_service


def test_proofreading_save_item_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, mutation_service = build_app_service()

    result = app_service.save_item(
        {
            "items": [
                {
                    "id": 1,
                    "src": "勇者が来た",
                    "dst": "Hero arrived again",
                    "file_path": "script/a.txt",
                    "status": Base.ItemStatus.PROCESSED,
                }
            ],
            "translation_extras": {"line": 1},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    assert mutation_service.persist_finalized_items_calls == [
        {
            "items": [
                {
                    "id": 1,
                    "src": "勇者が来た",
                    "dst": "Hero arrived again",
                    "file_path": "script/a.txt",
                    "status": Base.ItemStatus.PROCESSED,
                }
            ],
            "translation_extras": {"line": 1},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
            "reason": "proofreading_save_item",
        }
    ]
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
    app_service, data_manager, mutation_service = build_app_service()

    result = app_service.save_all(
        {
            "items": [
                {
                    "id": 1,
                    "dst": "",
                    "status": Base.ItemStatus.NONE,
                },
                {
                    "id": 2,
                    "dst": "",
                    "status": Base.ItemStatus.NONE,
                },
            ],
            "translation_extras": {"line": 2},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    assert mutation_service.persist_finalized_items_calls == [
        {
            "items": [
                {
                    "id": 1,
                    "dst": "",
                    "status": Base.ItemStatus.NONE,
                },
                {
                    "id": 2,
                    "dst": "",
                    "status": Base.ItemStatus.NONE,
                },
            ],
            "translation_extras": {"line": 2},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
            "reason": "proofreading_save_all",
        }
    ]
    assert result["accepted"] is True
    assert result["sectionRevisions"] == {
        "items": 8,
        "proofreading": 9,
    }
    assert data_manager.emitted_patches == []


def test_proofreading_replace_all_returns_minimal_mutation_ack() -> None:
    app_service, data_manager, mutation_service = build_app_service()

    result = app_service.replace_all(
        {
            "items": [
                {
                    "id": 1,
                    "dst": "Hero arrived",
                    "status": Base.ItemStatus.PROCESSED,
                }
            ],
            "search_text": "Hero",
            "replace_text": "Heroine",
            "translation_extras": {"line": 1},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
        }
    )

    assert mutation_service.persist_finalized_items_calls == [
        {
            "items": [
                {
                    "id": 1,
                    "dst": "Hero arrived",
                    "status": Base.ItemStatus.PROCESSED,
                }
            ],
            "translation_extras": {"line": 1},
            "expected_section_revisions": {"items": 7, "proofreading": 6},
            "reason": "proofreading_replace_all",
        }
    ]
    assert result["projectRevision"] == 11
    assert data_manager.emitted_patches == []
