from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.DataTypes import ProjectItemChange

from api.v2.Application.ProofreadingAppService import ProofreadingAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.ProofreadingApiClient import ProofreadingApiClient
from api.v2.Models.Proofreading import ProofreadingMutationResult


def build_proofreading_app_service() -> ProofreadingAppService:
    data_manager = SimpleNamespace(
        emit_project_runtime_patch=MagicMock(),
    )
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
        build_item_records=MagicMock(return_value=[]),
        build_proofreading_block=MagicMock(return_value={"revision": 9}),
        build_task_block=MagicMock(
            return_value={
                "task_type": "translation",
                "status": "IDLE",
                "busy": False,
            }
        ),
    )

    return ProofreadingAppService(
        data_manager=data_manager,
        mutation_service=mutation_service,
        retranslate_service=retranslate_service,
        runtime_service=runtime_service,
    )


def test_proofreading_api_client_save_item_returns_mutation_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.save_item(
        {
            "item": {
                "id": 1,
                "dst": "Hero arrived again",
                "status": Base.ProjectStatus.PROCESSED,
            },
            "expected_revision": 7,
        }
    )

    assert isinstance(result, ProofreadingMutationResult)
    assert result.revision == 9
    assert result.changed_item_ids == (1,)


def test_proofreading_api_client_replace_all_returns_mutation_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.replace_all(
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

    assert isinstance(result, ProofreadingMutationResult)
    assert result.revision == 9
    assert result.changed_item_ids == (1,)


def test_proofreading_api_client_save_all_returns_mutation_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.save_all(
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

    assert isinstance(result, ProofreadingMutationResult)
    assert result.changed_item_ids == (1, 2)


def test_proofreading_api_client_retranslate_items_returns_mutation_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.retranslate_items(
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

    assert isinstance(result, ProofreadingMutationResult)
    assert result.revision == 9
    assert result.changed_item_ids == (1, 2)
