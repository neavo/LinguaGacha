from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock
from typing import Any

from base.Base import Base
from module.Data.Core.DataTypes import ProjectItemChange
from module.Data.Core.Item import Item
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterOptions,
)
from module.Data.Proofreading.ProofreadingFilterService import (
    ProofreadingFilterService,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadKind,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult,
)


def build_item(
    *,
    item_id: int,
    src: str,
    dst: str,
    file_path: str,
    row: int = 0,
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
) -> Item:
    """构造最小条目对象，方便固定校对 API 的返回快照。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        row=row,
        status=status,
    )


def build_load_result(
    items: list[Item],
    *,
    revision: int = 7,
) -> ProofreadingLoadResult:
    """构造最小校对快照结果，避免测试直接依赖 DataManager。"""

    warning_map: dict[int, list[object]] = {}
    if items:
        warning_map[id(items[0])] = ["GLOSSARY"]
    items_by_id = {
        item.get_id(): item for item in items if isinstance(item.get_id(), int)
    }
    items_by_file_path: dict[str, tuple[Item, ...]] = {}
    grouped_items: dict[str, list[Item]] = {}
    for item in items:
        grouped_items.setdefault(item.get_file_path(), []).append(item)
    for file_path, grouped in grouped_items.items():
        items_by_file_path[file_path] = tuple(grouped)

    return ProofreadingLoadResult(
        kind=ProofreadingLoadKind.OK,
        lg_path="demo/project.lg",
        revision=revision,
        config=SimpleNamespace(),
        total_item_count=len(items),
        items_all=list(items),
        items=list(items),
        items_by_id=items_by_id,
        items_by_file_path=items_by_file_path,
        warning_map=warning_map,
        checker=SimpleNamespace(),
        failed_terms_by_item_key={id(items[0]): (("勇者", "Hero"),)} if items else {},
        filter_options=ProofreadingFilterOptions(
            warning_types={"GLOSSARY"},
            statuses={
                Base.ProjectStatus.NONE,
                Base.ProjectStatus.PROCESSED,
                Base.ProjectStatus.ERROR,
                Base.ProjectStatus.PROCESSED_IN_PAST,
            },
            file_paths={"script/a.txt"} if items else set(),
            glossary_terms={("勇者", "Hero")} if items else set(),
        ),
        summary={
            "total_items": len(items),
            "filtered_items": len(items),
            "warning_items": 1 if items else 0,
        },
    )


def build_refreshed_load_result() -> ProofreadingLoadResult:
    """构造写入后刷新得到的快照，确保 mutation 用例验证真实回包语义。"""

    refreshed_items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="Heroine arrived refreshed",
            file_path="script/a.txt",
            row=12,
            status=Base.ProjectStatus.PROCESSED,
        ),
        build_item(
            item_id=2,
            src="旁白",
            dst="Narration refreshed",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    refreshed_result = build_load_result(refreshed_items, revision=9)
    refreshed_result.filter_options = ProofreadingFilterOptions(
        warning_types={"GLOSSARY"},
        statuses={Base.ProjectStatus.NONE},
        file_paths={"script/a.txt"},
        glossary_terms={("勇者", "Hero")},
    )
    return refreshed_result


def build_app_service() -> tuple[
    Any,
    Any,
    Any,
    Any,
    Any,
    Any,
]:
    """构造可注入依赖的校对应用服务，便于把协议层行为固定住。"""

    items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="Hero arrived",
            file_path="script/a.txt",
            row=12,
            status=Base.ProjectStatus.PROCESSED,
        ),
        build_item(
            item_id=2,
            src="旁白",
            dst="Narration",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    load_result = build_load_result(items)
    load_result.summary["warning_items"] = 99
    snapshot_service = SimpleNamespace(
        load_snapshot=MagicMock(return_value=load_result),
    )

    def filter_items(
        items_ref,
        warning_map,
        options,
        checker,
        *,
        failed_terms_by_item_key=None,
        search_keyword="",
        search_is_regex=False,
        search_dst_only=False,
        enable_search_filter=False,
        enable_glossary_term_filter=True,
    ):
        del warning_map, options, checker
        del failed_terms_by_item_key
        del search_is_regex, search_dst_only
        del enable_search_filter, enable_glossary_term_filter
        if search_keyword == "勇者":
            return [items_ref[0]]
        if search_keyword == "旁白":
            return [items_ref[1]]
        return list(items_ref)

    filter_service = SimpleNamespace(
        filter_items=MagicMock(side_effect=filter_items),
        build_lookup_filter_options=MagicMock(return_value=load_result.filter_options),
    )
    mutation_service = SimpleNamespace(
        apply_manual_edit=MagicMock(
            return_value=ProjectItemChange(
                item_ids=(1,),
                rel_paths=("script/a.txt",),
                reason="proofreading_save_item",
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
    recheck_service = SimpleNamespace(
        check_item=MagicMock(
            return_value=(
                ["GLOSSARY"],
                (("勇者", "Hero"),),
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

    from api.Application.ProofreadingAppService import ProofreadingAppService

    app_service = ProofreadingAppService(
        snapshot_service=snapshot_service,
        filter_service=filter_service,
        mutation_service=mutation_service,
        recheck_service=recheck_service,
        retranslate_service=retranslate_service,
    )
    return (
        app_service,
        snapshot_service,
        filter_service,
        mutation_service,
        recheck_service,
        retranslate_service,
    )


def test_proofreading_snapshot_returns_revision() -> None:
    app_service, snapshot_service, _, _, _, _ = build_app_service()

    result = app_service.get_snapshot({})
    snapshot = result["snapshot"]

    assert snapshot["revision"] == 7
    assert snapshot["project_id"] == "demo/project.lg"
    assert snapshot["readonly"] is False
    assert snapshot["summary"] == {
        "total_items": 2,
        "filtered_items": 2,
        "warning_items": 1,
    }
    assert snapshot["filters"]["file_paths"] == ["script/a.txt"]
    assert snapshot["items"][0] == {
        "item_id": 1,
        "file_path": "script/a.txt",
        "row_number": 12,
        "src": "勇者が来た",
        "dst": "Hero arrived",
        "status": "PROCESSED",
        "warnings": ["GLOSSARY"],
        "applied_glossary_terms": [],
        "failed_glossary_terms": [["勇者", "Hero"]],
    }


def test_proofreading_filter_returns_filtered_snapshot() -> None:
    app_service, _, filter_service, _, _, _ = build_app_service()

    result = app_service.filter_items(
        {
            "search_keyword": "旁白",
            "search_is_regex": False,
            "search_dst_only": False,
        }
    )

    assert filter_service.filter_items.call_count == 1
    assert result["snapshot"]["summary"]["filtered_items"] == 1
    assert result["snapshot"]["items"][0]["item_id"] == 2
    assert result["snapshot"]["items"][0]["src"] == "旁白"


def test_proofreading_search_returns_search_result() -> None:
    app_service, _, filter_service, _, _, _ = build_app_service()

    result = app_service.search(
        {
            "keyword": "勇者",
            "is_regex": False,
        }
    )

    assert filter_service.filter_items.call_count == 1
    assert result["search_result"]["keyword"] == "勇者"
    assert result["search_result"]["matched_item_ids"] == [1]


def build_real_filter_app_service() -> tuple[Any, Any]:
    """构造使用真实筛选服务的校对应用服务，用来锁定默认筛选语义。"""

    items = [
        build_item(
            item_id=1,
            src="勇者が来た",
            dst="Hero arrived",
            file_path="script/a.txt",
            row=12,
            status=Base.ProjectStatus.PROCESSED,
        ),
        build_item(
            item_id=2,
            src="旁白",
            dst="Narration",
            file_path="script/b.txt",
            status=Base.ProjectStatus.NONE,
        ),
    ]
    load_result = build_load_result(items)
    snapshot_service = SimpleNamespace(
        load_snapshot=MagicMock(return_value=load_result),
    )

    from api.Application.ProofreadingAppService import ProofreadingAppService

    app_service = ProofreadingAppService(
        snapshot_service=snapshot_service,
        filter_service=ProofreadingFilterService(),
        mutation_service=MagicMock(),
        recheck_service=MagicMock(),
    )
    return app_service, snapshot_service


def test_proofreading_filter_uses_snapshot_default_filter_options() -> None:
    app_service, snapshot_service = build_real_filter_app_service()

    result = app_service.filter_items({})

    assert result["snapshot"]["items"][0]["item_id"] == 1
    assert result["snapshot"]["items"][0]["warnings"] == ["GLOSSARY"]


def test_proofreading_search_uses_snapshot_default_filter_options() -> None:
    app_service, snapshot_service = build_real_filter_app_service()

    result = app_service.search({"keyword": "勇者"})

    assert result["search_result"]["matched_item_ids"] == [1]


def test_proofreading_save_item_returns_mutation_result() -> None:
    app_service, snapshot_service, _, _, _, _ = build_app_service()
    refreshed_result = build_refreshed_load_result()
    snapshot_service.load_snapshot = MagicMock(return_value=refreshed_result)

    result = app_service.save_item(
        {
            "item": {
                "id": 1,
                "dst": "Hero arrived again",
                "status": Base.ProjectStatus.PROCESSED,
            },
            "expected_revision": 7,
        }
    )

    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1]
    assert result["result"]["items"][0]["dst"] == "Heroine arrived refreshed"
    assert result["result"]["summary"]["warning_items"] == 1


def test_proofreading_save_item_uses_refreshed_snapshot_item() -> None:
    app_service, snapshot_service, _, mutation_service, _, _ = build_app_service()
    snapshot_service.load_snapshot = MagicMock(
        return_value=build_refreshed_load_result()
    )

    result = app_service.save_item(
        {
            "item": {
                "id": 1,
                "dst": "Hero arrived again",
            },
            "expected_revision": 7,
        }
    )

    saved_item = result["result"]["items"][0]
    assert saved_item["src"] == "勇者が来た"
    assert saved_item["dst"] == "Heroine arrived refreshed"
    assert saved_item["file_path"] == "script/a.txt"
    assert saved_item["row_number"] == 12
    assert saved_item["warnings"] == ["GLOSSARY"]
    assert saved_item["failed_glossary_terms"] == [["勇者", "Hero"]]


def test_proofreading_replace_all_returns_mutation_result() -> None:
    app_service, snapshot_service, _, _, _, _ = build_app_service()
    refreshed_result = build_refreshed_load_result()
    snapshot_service.load_snapshot = MagicMock(return_value=refreshed_result)

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

    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1]
    assert result["result"]["items"][0]["dst"] == "Heroine arrived refreshed"
    assert result["result"]["summary"]["warning_items"] == 1


def test_proofreading_recheck_item_returns_mutation_result() -> None:
    app_service, _, _, _, _, _ = build_app_service()

    result = app_service.recheck_item(
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

    assert result["result"]["changed_item_ids"] == [1]
    assert result["result"]["items"][0]["item_id"] == 1
    assert result["result"]["items"][0]["warnings"] == ["GLOSSARY"]
    assert result["result"]["items"][0]["failed_glossary_terms"] == [["勇者", "Hero"]]


def test_proofreading_recheck_item_prefers_snapshot_aware_branch() -> None:
    app_service, _, _, _, recheck_service, _ = build_app_service()
    recheck_service.check_item_with_snapshot = MagicMock(
        return_value=SimpleNamespace(
            warnings=("GLOSSARY",),
            failed_glossary_terms=(("勇者", "Hero"),),
            applied_glossary_terms=(("守护者", "Guardian"),),
        )
    )

    result = app_service.recheck_item(
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

    assert result["result"]["items"][0]["warnings"] == ["GLOSSARY"]
    assert result["result"]["items"][0]["failed_glossary_terms"] == [["勇者", "Hero"]]
    assert result["result"]["items"][0]["applied_glossary_terms"] == [
        ["守护者", "Guardian"]
    ]


def test_proofreading_save_all_returns_mutation_result() -> None:
    app_service, snapshot_service, _, mutation_service, _, _ = build_app_service()
    refreshed_result = build_refreshed_load_result()
    snapshot_service.load_snapshot = MagicMock(return_value=refreshed_result)
    mutation_service.save_all = MagicMock(
        return_value=ProjectItemChange(
            item_ids=(1, 2),
            rel_paths=("script/a.txt", "script/b.txt"),
            reason="proofreading_save_all",
        )
    )

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

    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1, 2]
    assert [item["item_id"] for item in result["result"]["items"]] == [1, 2]
    assert result["result"]["items"][1]["dst"] == "Narration refreshed"
    assert result["result"]["summary"]["warning_items"] == 1


def test_proofreading_retranslate_items_returns_mutation_result() -> None:
    app_service, snapshot_service, _, _, _, _ = build_app_service()
    refreshed_result = build_refreshed_load_result()
    refreshed_result.warning_map = {}
    refreshed_result.failed_terms_by_item_key = {}
    refreshed_result.summary["warning_items"] = 0
    snapshot_service.load_snapshot = MagicMock(return_value=refreshed_result)

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

    assert result["result"]["revision"] == 9
    assert result["result"]["changed_item_ids"] == [1, 2]
    assert result["result"]["items"][0]["dst"] == "Heroine arrived refreshed"
    assert result["result"]["items"][1]["dst"] == "Narration refreshed"
    assert result["result"]["summary"]["warning_items"] == 0


def test_proofreading_file_patch_returns_filtered_and_full_file_slices() -> None:
    app_service, snapshot_service = build_real_filter_app_service()

    result = app_service.get_file_patch(
        {
            "rel_paths": ["script/a.txt"],
            "removed_rel_paths": ["script/old.txt"],
            "filter_options": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["script/a.txt"],
                "glossary_terms": [["勇者", "Hero"]],
            },
        }
    )

    patch = result["patch"]
    assert patch["removed_file_paths"] == ["script/old.txt"]
    assert patch["default_filters"]["file_paths"] == ["script/a.txt"]
    assert patch["applied_filters"]["file_paths"] == ["script/a.txt"]
    assert patch["full_summary"]["total_items"] == 2
    assert patch["filtered_summary"]["filtered_items"] == 1
    assert patch["full_items"][0]["file_path"] == "script/a.txt"
    assert patch["filtered_items"][0]["item_id"] == 1


def test_proofreading_entry_patch_returns_target_item_ids_and_dual_views() -> None:
    app_service, snapshot_service = build_real_filter_app_service()

    result = app_service.get_entry_patch(
        {
            "item_ids": [1, "2"],
            "filter_options": {
                "warning_types": ["GLOSSARY"],
                "statuses": ["PROCESSED"],
                "file_paths": ["script/a.txt"],
                "glossary_terms": [["勇者", "Hero"]],
            },
        }
    )

    patch = result["patch"]
    assert patch["target_item_ids"] == [1, 2]
    assert patch["default_filters"]["file_paths"] == ["script/a.txt"]
    assert patch["applied_filters"]["file_paths"] == ["script/a.txt"]
    assert patch["full_items"][0]["item_id"] == 1
    assert patch["filtered_items"][0]["item_id"] == 1
