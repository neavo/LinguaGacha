from typing import Any

from base.Base import Base
from model.Item import Item
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterOptions
from module.Data.Proofreading.ProofreadingFilterService import ProofreadingFilterService


class ProofreadingDomain:
    """Proofreading 的纯业务 Domain 层（不依赖 Qt）。

    这个壳只保留旧方法名，核心筛选逻辑已经下沉到 `ProofreadingFilterService`。
    """

    _SERVICE: ProofreadingFilterService = ProofreadingFilterService()

    @staticmethod
    def resolve_status_after_manual_edit(
        old_status: Base.ProjectStatus, new_dst: str
    ) -> Base.ProjectStatus:
        """计算校对人工改动后的目标状态。"""

        return ProofreadingDomain._SERVICE.resolve_status_after_manual_edit(
            old_status,
            new_dst,
        )

    @classmethod
    def normalize_filter_options(
        cls,
        options: ProofreadingFilterOptions | dict[str, Any] | None,
        items: list[Item],
    ) -> ProofreadingFilterOptions:
        return cls._SERVICE.normalize_filter_options(options, items)

    @staticmethod
    def get_warning_key(item: Item) -> int:
        """把 warning_map key 固定为 `id(item)`。"""

        return ProofreadingDomain._SERVICE.get_warning_key(item)

    @classmethod
    def get_item_warnings(
        cls,
        item: Item,
        warning_map: dict[int, list[Any]],
    ) -> list[Any]:
        return cls._SERVICE.get_item_warnings(item, warning_map)

    @staticmethod
    def build_review_items(items_all: list[Item]) -> list[Item]:
        """构建可校对条目列表，避免结构行进入 UI。"""

        return ProofreadingDomain._SERVICE.build_review_items(items_all)

    @classmethod
    def build_default_filter_options(
        cls,
        items: list[Item],
        warning_map: dict[int, list[Any]],
        checker: Any | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> ProofreadingFilterOptions:
        return cls._SERVICE.build_default_filter_options(
            items,
            warning_map,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
        )

    @classmethod
    def build_lookup_filter_options(
        cls,
        items: list[Item],
        warning_map: dict[int, list[Any]],
        checker: Any | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
    ) -> ProofreadingFilterOptions:
        """为“规则反查”构建全开筛选，避免旧筛选把真实命中藏起来。"""

        return cls._SERVICE.build_lookup_filter_options(
            items,
            warning_map,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
        )

    @classmethod
    def filter_items(
        cls,
        items: list[Item],
        warning_map: dict[int, list[Any]],
        options: ProofreadingFilterOptions | dict[str, Any] | None,
        checker: Any | None,
        *,
        failed_terms_by_item_key: dict[int, tuple[tuple[str, str], ...]] | None = None,
        search_keyword: str = "",
        search_is_regex: bool = False,
        search_dst_only: bool = False,
        enable_search_filter: bool = False,
        enable_glossary_term_filter: bool = True,
    ) -> list[Item]:
        return cls._SERVICE.filter_items(
            items,
            warning_map,
            options,
            checker,
            failed_terms_by_item_key=failed_terms_by_item_key,
            search_keyword=search_keyword,
            search_is_regex=search_is_regex,
            search_dst_only=search_dst_only,
            enable_search_filter=enable_search_filter,
            enable_glossary_term_filter=enable_glossary_term_filter,
        )

    @classmethod
    def build_failed_glossary_terms_cache(
        cls,
        items: list[Item],
        warning_map: dict[int, list[Any]],
        checker: Any | None,
    ) -> dict[int, tuple[tuple[str, str], ...]]:
        """构建 item_key -> failed_terms 缓存。"""

        return cls._SERVICE.build_failed_glossary_terms_cache(
            items,
            warning_map,
            checker,
        )
