from dataclasses import dataclass
from dataclasses import field
from enum import StrEnum

from frontend.Proofreading.ProofreadingDomain import ProofreadingDomain
from frontend.Proofreading.ProofreadingDomain import ProofreadingFilterOptions
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.ResultChecker import ResultChecker
from module.ResultChecker import WarningType


class ProofreadingLoadKind(StrEnum):
    OK = "ok"
    NO_PROJECT = "no_project"
    STALE = "stale"
    ERROR = "error"


@dataclass
class ProofreadingLoadResult:
    kind: ProofreadingLoadKind
    lg_path: str
    config: Config | None = None
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


class ProofreadingLoadService:
    """Proofreading 的加载编排服务。

    该服务只负责“如何加载出一份稳定快照”，不触碰 Qt/信号/线程，
    以便 ProofreadingPage 在后台线程复用，并减少 UI 文件的流程噪音。
    """

    @staticmethod
    def load_snapshot(expected_lg_path: str) -> ProofreadingLoadResult:
        """加载校对页所需数据快照（同步逻辑）。

        为什么要传 expected_lg_path：用于在后台线程中识别“工程已切换/卸载”的竞态，
        避免旧线程结果覆盖新工程 UI。
        """

        if not DataManager.get().is_loaded():
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.NO_PROJECT,
                lg_path=expected_lg_path,
            )

        if DataManager.get().get_lg_path() != expected_lg_path:
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.STALE,
                lg_path=expected_lg_path,
            )

        config = Config().load()
        items_all = DataManager.get().get_all_items()
        if not items_all:
            # 工程创建/加载后可能仍没有任何条目（例如：空目录、无支持文件、解析失败等）。
            # 这里不再区分“无缓存/无可校对项”等状态，统一回落为 OK + 空列表。
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.OK,
                lg_path=expected_lg_path,
                config=config,
            )

        items = ProofreadingDomain.build_review_items(items_all)
        if not items:
            return ProofreadingLoadResult(
                kind=ProofreadingLoadKind.OK,
                lg_path=expected_lg_path,
                config=config,
                items_all=items_all,
            )

        checker = ResultChecker(config)
        warning_map = checker.check_items(items)
        failed_terms_by_item_key = ProofreadingDomain.build_failed_glossary_terms_cache(
            items, warning_map, checker
        )
        filter_options = ProofreadingDomain.build_default_filter_options(
            items,
            warning_map,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
        )

        return ProofreadingLoadResult(
            kind=ProofreadingLoadKind.OK,
            lg_path=expected_lg_path,
            config=config,
            items_all=items_all,
            items=items,
            warning_map=warning_map,
            checker=checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
            filter_options=filter_options,
        )
