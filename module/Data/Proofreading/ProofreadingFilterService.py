from __future__ import annotations

from base.Base import Base
from module.Data.Core.Item import Item


class ProofreadingFilterService:
    """校对页条目范围与人工编辑状态推导服务。"""

    def resolve_status_after_manual_edit(
        self,
        old_status: Base.ProjectStatus,
        new_dst: str,
    ) -> Base.ProjectStatus:
        """计算人工编辑后的目标状态。"""

        if old_status == Base.ProjectStatus.PROCESSED_IN_PAST:
            return Base.ProjectStatus.PROCESSED

        if not new_dst:
            return old_status

        if old_status == Base.ProjectStatus.PROCESSED:
            return old_status

        return Base.ProjectStatus.PROCESSED

    def build_review_items(self, items_all: list[Item]) -> list[Item]:
        """构建可进入校对页的条目列表。"""

        review_items: list[Item] = []
        for item in items_all:
            if not item.get_src().strip():
                continue
            if item.get_status() in (
                Base.ProjectStatus.DUPLICATED,
                Base.ProjectStatus.RULE_SKIPPED,
            ):
                continue
            review_items.append(item)
        return review_items
