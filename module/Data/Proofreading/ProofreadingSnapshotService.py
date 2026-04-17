from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from enum import StrEnum
from typing import Any
from typing import Callable

from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterService
from module.Data.Proofreading.ProofreadingRecheckService import (
    ProofreadingRecheckService,
)
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService,
)
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType


class ProofreadingLoadKind(StrEnum):
    """校对加载状态。"""

    OK = "ok"
    NO_PROJECT = "no_project"
    STALE = "stale"
    ERROR = "error"


@dataclass
class ProofreadingLoadResult:
    """校对加载快照。"""

    kind: ProofreadingLoadKind
    lg_path: str
    revision: int = 0
    config: Any | None = None
    items_all: list[Item] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    warning_map: dict[int, list[WarningType]] = field(default_factory=dict)
    checker: ResultChecker | None = None
    failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] = field(
        default_factory=dict
    )
    filter_options: ProofreadingFilterOptions = field(
        default_factory=ProofreadingFilterOptions
    )
    summary: dict[str, int] = field(default_factory=dict)


class ProofreadingSnapshotService:
    """校对快照服务。

    这个服务把原来 `ProofreadingLoadService` 的加载流程收口到 core，
    让前端 helper 只保留一层薄包装。
    """

    def __init__(
        self,
        data_manager: Any | None = None,
        *,
        config_loader: Callable[[], Any] | None = None,
        filter_service: ProofreadingFilterService | None = None,
        recheck_service: ProofreadingRecheckService | None = None,
        revision_service: ProofreadingRevisionService | None = None,
    ) -> None:
        if data_manager is None:
            self.data_manager = DataManager.get()
        else:
            self.data_manager = data_manager

        if config_loader is None:
            self.config_loader = lambda: Config().load()
        else:
            self.config_loader = config_loader

        if filter_service is None:
            self.filter_service = ProofreadingFilterService()
        else:
            self.filter_service = filter_service

        if recheck_service is None:
            self.recheck_service = ProofreadingRecheckService()
        else:
            self.recheck_service = recheck_service

        if revision_service is None:
            self.revision_service = ProofreadingRevisionService(self.data_manager)
        else:
            self.revision_service = revision_service

    @staticmethod
    def build_summary(
        *,
        items_all: list[Item],
        items: list[Item],
        warning_map: dict[int, list[WarningType]],
    ) -> dict[str, int]:
        """构造最小摘要，避免调用方重复统计。"""

        warning_items = 0
        for item in items:
            if warning_map.get(id(item)):
                warning_items += 1

        return {
            "total_items": len(items_all),
            "filtered_items": len(items),
            "warning_items": warning_items,
        }

    def load_snapshot(self, expected_lg_path: str) -> ProofreadingLoadResult:
        """加载校对页所需的完整快照。"""

        if not self.data_manager.is_loaded():
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.NO_PROJECT,
                lg_path=expected_lg_path,
            )

        if self.data_manager.get_lg_path() != expected_lg_path:
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.STALE,
                lg_path=expected_lg_path,
            )

        revision = self.revision_service.get_revision("proofreading")
        config = self.config_loader()
        items_all = self.data_manager.get_all_items()
        if not items_all:
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.OK,
                lg_path=expected_lg_path,
                revision=revision,
                config=config,
                summary=self.build_summary(
                    items_all=[],
                    items=[],
                    warning_map={},
                ),
            )

        items = self.filter_service.build_review_items(items_all)
        if not items:
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.OK,
                lg_path=expected_lg_path,
                revision=revision,
                config=config,
                items_all=items_all,
                summary=self.build_summary(
                    items_all=items_all,
                    items=[],
                    warning_map={},
                ),
            )

        checker, warning_map = self.recheck_service.check_items(config, items)
        failed_terms_by_item_key = (
            self.recheck_service.build_failed_glossary_terms_cache(
                items,
                warning_map,
                checker,
            )
        )
        filter_options = self.filter_service.build_default_filter_options(
            items,
            warning_map,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
        )
        summary = self.build_summary(
            items_all=items_all,
            items=items,
            warning_map=warning_map,
        )

        return ProofreadingLoadResult(
            kind=ProofreadingLoadKind.OK,
            lg_path=expected_lg_path,
            revision=revision,
            config=config,
            items_all=items_all,
            items=items,
            warning_map=warning_map,
            checker=checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
            filter_options=filter_options,
            summary=summary,
        )
