from __future__ import annotations

from typing import Any


class V2ProjectMutationService:
    """解释 V2 mutation envelope，并返回 ack / reject 结果。"""

    ITEM_UPDATE_TEXT_TYPE: str = "item.update_text"
    ITEMS_SECTION: str = "items"
    STALE_BASE_REVISION_CODE: str = "stale_base_revision"

    def __init__(self, data_manager: Any, revision_service) -> None:
        self.data_manager = data_manager
        self.revision_service = revision_service

    def apply_mutations(self, envelope: dict[str, object]) -> dict[str, object]:
        """执行 mutation envelope，返回稳定 ack。"""

        client_mutation_id = str(envelope.get("clientMutationId", ""))
        base_revision = int(envelope.get("baseRevision", 0) or 0)
        raw_mutations = envelope.get("mutations", [])
        mutations = raw_mutations if isinstance(raw_mutations, list) else []

        current_revision, section_revisions = self.revision_service.snapshot()
        if base_revision != current_revision:
            return {
                "clientMutationId": client_mutation_id,
                "accepted": False,
                "newRevision": current_revision,
                "updatedSections": [],
                "sectionRevisions": section_revisions,
                "appliedMutations": [self.build_stale_rejection()],
            }

        updated_sections: list[str] = []
        applied_mutations: list[dict[str, object]] = []
        for mutation_index, mutation in enumerate(mutations):
            if not isinstance(mutation, dict):
                applied_mutations.append(
                    {
                        "index": mutation_index,
                        "status": "rejected",
                        "error": {
                            "code": "invalid_mutation",
                            "message": "mutation 必须是对象。",
                        },
                    }
                )
                continue

            mutation_type = str(mutation.get("type", ""))
            if mutation_type == self.ITEM_UPDATE_TEXT_TYPE:
                self.apply_item_update_text(mutation)
                if self.ITEMS_SECTION not in updated_sections:
                    updated_sections.append(self.ITEMS_SECTION)
                applied_mutations.append(
                    {
                        "index": mutation_index,
                        "status": "applied",
                    }
                )
                continue

            applied_mutations.append(
                {
                    "index": mutation_index,
                    "status": "rejected",
                    "error": {
                        "code": "unsupported_mutation",
                        "message": f"不支持的 mutation 类型：{mutation_type}",
                    },
                }
            )

        if updated_sections:
            new_revision, section_revisions = self.revision_service.bump(
                *updated_sections
            )
        else:
            new_revision, section_revisions = self.revision_service.snapshot()

        return {
            "clientMutationId": client_mutation_id,
            "accepted": True,
            "newRevision": new_revision,
            "updatedSections": updated_sections,
            "sectionRevisions": section_revisions,
            "appliedMutations": applied_mutations,
        }

    def apply_item_update_text(self, mutation: dict[str, object]) -> None:
        """执行最小 item 文本更新 mutation。"""

        fields = mutation.get("fields", {})
        normalized_fields = fields if isinstance(fields, dict) else {}
        item_id = int(mutation.get("itemId", 0) or 0)
        dst = str(normalized_fields.get("dst", ""))
        self.data_manager.update_item_text(item_id, dst)

    def build_stale_rejection(self) -> dict[str, object]:
        """统一构建 base revision 过期时的 reject 结果。"""

        return {
            "index": 0,
            "status": "rejected",
            "error": {
                "code": self.STALE_BASE_REVISION_CODE,
                "message": "baseRevision 已过期，请先同步最新 patch。",
            },
        }
