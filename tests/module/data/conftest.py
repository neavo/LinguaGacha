from __future__ import annotations

import contextlib
import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from module.Data.Core.BatchService import BatchService
from module.Data.Core.ItemService import ItemService
from module.Data.Core.ProjectSession import ProjectSession


def build_fake_session(*, loaded: bool = True) -> Any:
    """构造最小可用的会话假对象。"""

    db = None
    if loaded:
        conn = SimpleNamespace(commit=MagicMock())
        db = SimpleNamespace(
            open=MagicMock(),
            close=MagicMock(),
            connection=MagicMock(return_value=contextlib.nullcontext(conn)),
            get_analysis_item_checkpoints=MagicMock(return_value=[]),
            upsert_analysis_item_checkpoints=MagicMock(),
            delete_analysis_item_checkpoints=MagicMock(return_value=0),
            get_analysis_task_observations=MagicMock(return_value=[]),
            insert_analysis_task_observations=MagicMock(return_value=0),
            clear_analysis_task_observations=MagicMock(),
            get_analysis_candidate_aggregates=MagicMock(return_value=[]),
            get_analysis_candidate_aggregates_by_srcs=MagicMock(return_value=[]),
            upsert_analysis_candidate_aggregates=MagicMock(),
            upsert_meta_entries=MagicMock(),
            clear_analysis_candidate_aggregates=MagicMock(),
            add_asset=MagicMock(return_value=1),
            get_items_by_file_path=MagicMock(return_value=[]),
            delete_items_by_file_path=MagicMock(return_value=0),
            delete_asset=MagicMock(),
            update_asset=MagicMock(),
            update_asset_path=MagicMock(return_value=1),
            insert_items=MagicMock(return_value=[]),
            asset_path_exists=MagicMock(return_value=False),
            get_all_asset_paths=MagicMock(return_value=[]),
            update_batch=MagicMock(),
            set_meta=MagicMock(),
            get_rule_text=MagicMock(return_value=""),
            get_rule_text_by_name=MagicMock(return_value=""),
            set_rule_text=MagicMock(),
        )

    return SimpleNamespace(
        db=db,
        lg_path="demo/project.lg" if loaded else None,
        state_lock=threading.RLock(),
        meta_cache={},
        rule_cache={},
        rule_text_cache={},
        item_cache=None,
        item_cache_index={},
        asset_decompress_cache={},
        clear_all_caches=MagicMock(),
    )


@pytest.fixture
def project_session() -> ProjectSession:
    """提供一个真实的 ProjectSession，方便新服务直接使用。"""

    return ProjectSession()


@pytest.fixture
def batch_service(project_session: ProjectSession) -> BatchService:
    """提供真实 BatchService，局部用例可按需替换 db。"""

    return BatchService(project_session)


@pytest.fixture
def item_service(project_session: ProjectSession) -> ItemService:
    """提供真实 ItemService。"""

    return ItemService(project_session)
