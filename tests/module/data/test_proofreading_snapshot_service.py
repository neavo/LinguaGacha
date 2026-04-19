from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from base.Base import Base
from module.Data.Core.Item import Item
from module.Data.Core.DataEnums import TextPreserveMode
from module.ResultChecker import WarningType


def build_item(
    *,
    item_id: int,
    src: str,
    dst: str,
    file_path: str,
    status: Base.ProjectStatus = Base.ProjectStatus.PROCESSED,
) -> Item:
    """构造最小条目对象，方便固定 `id(item)` 与数据内容。"""

    return Item(
        id=item_id,
        src=src,
        dst=dst,
        file_path=file_path,
        status=status,
    )


def build_fake_data_manager(
    *,
    loaded: bool,
    lg_path: str | None,
    items: list[Item],
    revision: int = 0,
) -> tuple[SimpleNamespace, dict[str, object]]:
    """构造最小工程假对象，方便验证快照加载分支。"""

    meta_store: dict[str, object] = {
        "proofreading_revision.proofreading": revision,
    }
    fake_session = SimpleNamespace(state_lock=threading.RLock())
    fake_data_manager = SimpleNamespace(
        session=fake_session,
        is_loaded=MagicMock(return_value=loaded),
        get_lg_path=MagicMock(return_value=lg_path),
        get_all_items=MagicMock(return_value=items),
        get_all_item_dicts=MagicMock(return_value=[item.to_dict() for item in items]),
        get_meta=MagicMock(
            side_effect=lambda key, default=None: meta_store.get(key, default)
        ),
        set_meta=MagicMock(
            side_effect=lambda key, value: meta_store.__setitem__(key, value)
        ),
    )
    return fake_data_manager, meta_store


def test_load_snapshot_returns_no_project_when_project_is_not_loaded() -> None:
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingLoadKind,
    )
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingSnapshotService,
    )

    data_manager, _meta_store = build_fake_data_manager(
        loaded=False,
        lg_path=None,
        items=[],
    )
    service = ProofreadingSnapshotService(data_manager=data_manager)

    result = service.load_snapshot("demo/project.lg")

    assert result.kind == ProofreadingLoadKind.NO_PROJECT
    assert result.lg_path == "demo/project.lg"


def test_load_snapshot_returns_stale_when_project_path_changed() -> None:
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingLoadKind,
    )
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingSnapshotService,
    )

    data_manager, _meta_store = build_fake_data_manager(
        loaded=True,
        lg_path="demo/other-project.lg",
        items=[],
    )
    service = ProofreadingSnapshotService(data_manager=data_manager)

    result = service.load_snapshot("demo/project.lg")

    assert result.kind == ProofreadingLoadKind.STALE
    assert result.lg_path == "demo/project.lg"


def test_load_snapshot_builds_complete_payload_for_review_items() -> None:
    from module.Data.Proofreading.ProofreadingFilterService import (
        ProofreadingFilterOptions,
    )
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingLoadKind,
    )
    from module.Data.Proofreading.ProofreadingSnapshotService import (
        ProofreadingSnapshotService,
    )

    review_item = build_item(
        item_id=1,
        src="勇者が来た",
        dst="Hero arrived",
        file_path="script/a.txt",
    )
    data_manager, _meta_store = build_fake_data_manager(
        loaded=True,
        lg_path="demo/project.lg",
        items=[review_item],
        revision=7,
    )
    fake_filter_service = SimpleNamespace(
        build_review_items_from_dicts=MagicMock(return_value=[review_item]),
        build_default_filter_options=MagicMock(
            return_value=ProofreadingFilterOptions(
                warning_types={WarningType.GLOSSARY},
                statuses={Base.ProjectStatus.PROCESSED},
                file_paths={"script/a.txt"},
                glossary_terms={("勇者", "Hero")},
                include_without_glossary_miss=True,
            )
        ),
    )
    fake_checker = SimpleNamespace(
        name="fake-checker",
        get_replaced_text=MagicMock(return_value=("勇者が来た", "Hero arrived")),
        get_applied_glossary_terms_from_replaced=MagicMock(
            return_value=[("勇者", "Hero")]
        ),
    )
    fake_recheck_service = SimpleNamespace(
        check_items_with_caches=MagicMock(
            return_value=SimpleNamespace(
                checker=fake_checker,
                warning_map={id(review_item): [WarningType.GLOSSARY]},
                failed_terms_by_item_key={id(review_item): (("勇者", "Hero"),)},
                applied_terms_by_item_key={id(review_item): (("勇者", "Hero"),)},
            )
        ),
        build_failed_glossary_terms_cache=MagicMock(
            return_value={id(review_item): (("勇者", "Hero"),)}
        ),
    )
    service = ProofreadingSnapshotService(
        data_manager=data_manager,
        config_loader=lambda: SimpleNamespace(source_language=TextPreserveMode.SMART),
        filter_service=fake_filter_service,
        recheck_service=fake_recheck_service,
    )

    result = service.load_snapshot("demo/project.lg")

    assert result.kind == ProofreadingLoadKind.OK
    assert result.lg_path == "demo/project.lg"
    assert result.revision == 7
    assert result.items_all == [review_item]
    assert result.items == [review_item]
    assert result.checker is fake_checker
    assert result.warning_map[id(review_item)] == [WarningType.GLOSSARY]
    assert result.failed_terms_by_item_key[id(review_item)] == (("勇者", "Hero"),)
    assert result.applied_terms_by_item_key[id(review_item)] == (("勇者", "Hero"),)
    assert result.filter_options.warning_types == {WarningType.GLOSSARY}
    assert result.filter_options.include_without_glossary_miss is True
    assert result.summary == {
        "total_items": 1,
        "filtered_items": 1,
        "warning_items": 1,
    }
