from __future__ import annotations

from typing import Any

from base.Base import Base


class V2EventBridge:
    """把内部任务终态裁成 V2 ProjectStore 可直接消费的 patch 事件。"""

    PROJECT_PATCH_TOPIC: str = "project.patch"

    def map_event(
        self,
        event: Base.Event | str,
        data: dict[str, Any],
    ) -> tuple[str | None, dict[str, Any]]:
        """仅暴露 V2 运行态真正需要的 patch 事件。"""

        if self.is_translation_done_event(event, data):
            return (
                self.PROJECT_PATCH_TOPIC,
                {
                    "source": "task",
                    "projectRevision": int(data.get("revision", 0) or 0),
                    "updatedSections": ["items", "task"],
                    "patch": [
                        {
                            "op": "merge_items",
                            "item_ids": self.normalize_item_ids(
                                data.get("item_ids", [])
                            ),
                        }
                    ],
                },
            )
        return None, {}

    def is_translation_done_event(
        self,
        event: Base.Event | str,
        data: dict[str, Any],
    ) -> bool:
        """兼容测试里的语义事件名，以及真实运行时的任务终态事件。"""

        if event == "translation_done":
            return True
        return (
            event == Base.Event.TRANSLATION_TASK
            and data.get("sub_event") == Base.SubEvent.DONE
        )

    def normalize_item_ids(self, raw_item_ids: Any) -> list[int]:
        """把 patch 里的条目 id 收口成稳定整数列表。"""

        if not isinstance(raw_item_ids, list):
            return []

        item_ids: list[int] = []
        for raw_item_id in raw_item_ids:
            try:
                item_ids.append(int(raw_item_id))
            except TypeError, ValueError:
                continue
        return item_ids
