from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import Mock

from api.Application.ProofreadingAppService import ProofreadingAppService
from api.Client.ApiClient import ApiClient
from api.Client.ProofreadingApiClient import ProofreadingApiClient
from base.Base import Base
from model.Api.ProofreadingModels import ProofreadingMutationResult
from model.Api.ProofreadingModels import ProofreadingSearchResult
from model.Api.ProofreadingModels import ProofreadingSnapshot
from model.Item import Item
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
        ),
        summary={
            "total_items": 2,
            "filtered_items": 2,
            "warning_items": 1,
        },
    )

    snapshot_service = Mock()
    snapshot_service.load_snapshot.side_effect = [snapshot_result, refreshed_result]

    def filter_items(
        items_ref: list[Item],
        warning_map: object,
        options: object,
        checker: object,
        *,
        failed_terms_by_item_key: object | None = None,
        search_keyword: str = "",
        search_is_regex: bool = False,
        search_dst_only: bool = False,
        enable_search_filter: bool = False,
        enable_glossary_term_filter: bool = True,
    ) -> list[Item]:
        del warning_map, options, checker
        del failed_terms_by_item_key
        del search_is_regex, search_dst_only
        del enable_search_filter, enable_glossary_term_filter
        if search_keyword == "勇者":
            return [items_ref[0]]
        if search_keyword == "旁白":
            return [items_ref[1]]
        return list(items_ref)

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
    ) -> int:
        del expected_revision
        item.set_dst(new_dst)
        item.set_status(Base.ProjectStatus.PROCESSED)
        return 1

    def replace_all(
        items_ref: list[Item],
        *,
        search_text: str,
        replace_text: str,
        is_regex: bool = False,
        expected_revision: int | None = None,
    ) -> dict[str, object]:
        del items_ref, search_text, replace_text, is_regex, expected_revision
        return {
            "revision": 8,
            "changed_item_ids": [1],
            "items": [
                {
                    "id": 1,
                    "dst": "Hero arrived again",
                    "status": Base.ProjectStatus.PROCESSED,
                }
            ],
        }

    mutation_service = Mock()
    mutation_service.apply_manual_edit.side_effect = apply_manual_edit
    mutation_service.replace_all.side_effect = replace_all
    mutation_service.save_all.return_value = [1, 2]

    def check_item(
        config: object,
        item: Item,
    ) -> tuple[list[WarningType], tuple[tuple[str, str], ...] | None]:
        del config
        if item.get_id() == 1:
            return [WarningType.GLOSSARY], (("勇者", "Hero"),)
        return [], None

    recheck_service = Mock()
    recheck_service.check_item.side_effect = check_item
    retranslate_service = Mock()
    retranslate_service.retranslate_items.return_value = {
        "revision": 9,
        "changed_item_ids": [1, 2],
    }

    return ProofreadingAppService(
        snapshot_service=snapshot_service,
        filter_service=filter_service,
        mutation_service=mutation_service,
        recheck_service=recheck_service,
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


def test_proofreading_api_client_filter_items_returns_snapshot(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.filter_items(
        {
            "search_keyword": "旁白",
            "search_is_regex": False,
        }
    )

    assert isinstance(result, ProofreadingSnapshot)
    assert result.items[0].item_id == 2


def test_proofreading_api_client_search_returns_search_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.search(
        {
            "keyword": "勇者",
            "is_regex": False,
        }
    )

    assert isinstance(result, ProofreadingSearchResult)
    assert result.keyword == "勇者"
    assert result.matched_item_ids == (1,)


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
            "new_dst": "Hero arrived again",
            "expected_revision": 7,
        }
    )

    assert isinstance(result, ProofreadingMutationResult)
    assert result.revision >= 0
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
    assert result.items[0].dst == "Heroine arrived refreshed"
    assert result.summary.warning_items == 1


def test_proofreading_api_client_recheck_item_returns_mutation_result(
    start_api_server: Callable[..., str],
) -> None:
    app_service = build_proofreading_app_service()
    base_url = start_api_server(proofreading_app_service=app_service)
    proofreading_client = ProofreadingApiClient(ApiClient(base_url))

    result = proofreading_client.recheck_item(
        {
            "item": {
                "id": 1,
                "src": "勇者が来た",
                "dst": "Hero arrived",
                "file_path": "script/a.txt",
                "status": Base.ProjectStatus.PROCESSED,
            }
        }
    )

    assert isinstance(result, ProofreadingMutationResult)
    assert result.changed_item_ids == (1,)
    assert result.items[0].item_id == 1


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
