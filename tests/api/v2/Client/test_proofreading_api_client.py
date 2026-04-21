from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import Mock

from api.v2.Application.ProofreadingAppService import ProofreadingAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.ProofreadingApiClient import ProofreadingApiClient
from base.Base import Base
from api.v2.Models.Proofreading import ProofreadingMutationResult
from api.v2.Models.Proofreading import ProofreadingSnapshot
from module.Data.Core.Item import Item
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingSnapshotService import ProofreadingLoadKind
from module.Data.Proofreading.ProofreadingSnapshotService import ProofreadingLoadResult
from module.ResultChecker import WarningType


def build_proofreading_app_service() -> ProofreadingAppService:
    """构造最小校对应用服务，目的是固定客户端与服务端之间的协议行为。"""

    items = [
        Item(
            id=1,
            src="勇者が来た",
            dst="Hero arrived",
            file_path="script/a.txt",
            status=Base.ProjectStatus.PROCESSED,
        ),
        Item(
            id=2,
            src="旁白",
            dst="Narration",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    snapshot_result = ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        revision=7,
        config=SimpleNamespace(),
        items_all=list(items),
        items=list(items),
        warning_map={id(items[0]): [WarningType.GLOSSARY]},
        checker=SimpleNamespace(),
        failed_terms_by_item_key={id(items[0]): (("勇者", "Hero"),)},
        filter_options=ProofreadingFilterOptions(
            warning_types={"GLOSSARY"},
            statuses={Base.ProjectStatus.NONE, Base.ProjectStatus.PROCESSED},
            file_paths={"script/a.txt", "script/b.txt"},
            glossary_terms={("勇者", "Hero")},
            include_without_glossary_miss=True,
        ),
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )
    refreshed_items = [
        Item(
            id=1,
            src="勇者が来た",
            dst="Heroine arrived refreshed",
            file_path="script/a.txt",
            row=12,
            status=Base.ProjectStatus.PROCESSED,
        ),
        Item(
            id=2,
            src="旁白",
            dst="Narration refreshed",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    refreshed_result = ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        revision=9,
        config=SimpleNamespace(),
        items_all=list(refreshed_items),
        items=list(refreshed_items),
        warning_map={id(refreshed_items[0]): [WarningType.GLOSSARY]},
        checker=SimpleNamespace(),
        failed_terms_by_item_key={id(refreshed_items[0]): (("勇者", "Hero"),)},
        filter_options=ProofreadingFilterOptions(
            warning_types={"GLOSSARY"},
            statuses={Base.ProjectStatus.NONE, Base.ProjectStatus.PROCESSED},
            file_paths={"script/a.txt", "script/b.txt"},
            glossary_terms={("勇者", "Hero")},
            include_without_glossary_miss=True,
        ),
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )

    snapshot_service = Mock()
    mutation_state = {"mutated": False}

    def load_snapshot(lg_path: str) -> ProofreadingLoadResult:
        del lg_path
        return refreshed_result if mutation_state["mutated"] else snapshot_result

    snapshot_service.load_snapshot.side_effect = load_snapshot

    def filter_items(
        items_ref: list[Item],
        warning_map: object,
        options: object,
        checker: object,
        *,
        failed_terms_by_item_key: object | None = None,
    ) -> list[Item]:
        del warning_map, checker
        del failed_terms_by_item_key
        target_file_paths = getattr(options, "file_paths", None)
        if not target_file_paths:
            return list(items_ref)
        return [item for item in items_ref if item.get_file_path() in target_file_paths]

    filter_service = Mock()
    filter_service.filter_items.side_effect = filter_items
    filter_service.build_lookup_filter_options.return_value = (
        snapshot_result.filter_options
    )

    def apply_manual_edit(
        item: Item,
        new_dst: str,
        *,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        del expected_revision
        item.set_dst(new_dst)
        item.set_status(Base.ProjectStatus.PROCESSED)
        mutation_state["mutated"] = True
        return ProjectItemChange(
            item_ids=(1,),
            rel_paths=("script/a.txt",),
            reason="proofreading_save_item",
        )

    def replace_all(
        items_ref: list[Item],
        *,
        search_text: str,
        replace_text: str,
        is_regex: bool = False,
        expected_revision: int | None = None,
    ) -> ProjectItemChange:
        del items_ref, search_text, replace_text, is_regex, expected_revision
        mutation_state["mutated"] = True
        return ProjectItemChange(
            item_ids=(1,),
            rel_paths=("script/a.txt",),
            reason="proofreading_replace_all",
        )

    mutation_service = Mock()
    mutation_service.apply_manual_edit.side_effect = apply_manual_edit
    mutation_service.replace_all.side_effect = replace_all
    mutation_service.save_all.side_effect = lambda items, **kwargs: (
        mutation_state.__setitem__("mutated", True)
        or ProjectItemChange(
            item_ids=(1, 2),
            rel_paths=("script/a.txt", "script/b.txt"),
            reason="proofreading_save_all",
        )
    )

    retranslate_service = Mock()
    retranslate_service.retranslate_items.side_effect = lambda items, **kwargs: (
        mutation_state.__setitem__("mutated", True)
        or ProjectItemChange(
            item_ids=(1, 2),
            rel_paths=("script/a.txt", "script/b.txt"),
            reason="proofreading_retranslate_items",
        )
    )

    return ProofreadingAppService(
        snapshot_service=snapshot_service,
        filter_service=filter_service,
        mutation_service=mutation_service,
        retranslate_service=retranslate_service,
    )


def test_proofreading_api_client_get_snapshot_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.get_snapshot({})

    assert isinstance(result, ProofreadingSnapshot)
    assert result.revision == 7
    assert result.items[0].item_id == 1
    assert result.filters.include_without_glossary_miss is True


def test_proofreading_api_client_filter_items_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.filter_items(
        {
            "filter_options": {
                "file_paths": ["script/b.txt"],
            },
        }
    )

    assert isinstance(result, ProofreadingSnapshot)
    assert [item.item_id for item in result.items] == [2]


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
    assert result.items[0].dst == "Heroine arrived refreshed"
    assert result.summary.warning_items == 1


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
    assert result.items[0].dst == "Heroine arrived refreshed"
    assert result.summary.warning_items == 1


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
