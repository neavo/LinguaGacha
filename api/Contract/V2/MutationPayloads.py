from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class MutationAckPayload:
    """统一描述 V2 mutation 的 ack / reject 返回结构。"""

    client_mutation_id: str
    accepted: bool
    new_revision: int
    updated_sections: tuple[str, ...]
    section_revisions: dict[str, int]
    applied_mutations: tuple[dict[str, Any], ...]
    correction_patch: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MutationAckPayload":
        """把服务层原始字典规整为稳定 payload 对象。"""

        raw_applied_mutations = data.get("appliedMutations", [])
        applied_mutations = tuple(
            dict(entry) for entry in raw_applied_mutations if isinstance(entry, dict)
        )
        raw_updated_sections = data.get("updatedSections", [])
        updated_sections = tuple(
            str(section) for section in raw_updated_sections if isinstance(section, str)
        )
        raw_section_revisions = data.get("sectionRevisions", {})
        section_revisions = (
            {
                str(section): int(revision)
                for section, revision in raw_section_revisions.items()
            }
            if isinstance(raw_section_revisions, dict)
            else {}
        )
        correction_patch = data.get("correctionPatch")
        normalized_correction_patch = (
            dict(correction_patch) if isinstance(correction_patch, dict) else None
        )

        return cls(
            client_mutation_id=str(data.get("clientMutationId", "")),
            accepted=bool(data.get("accepted")),
            new_revision=int(data.get("newRevision", 0) or 0),
            updated_sections=updated_sections,
            section_revisions=section_revisions,
            applied_mutations=applied_mutations,
            correction_patch=normalized_correction_patch,
        )

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 HTTP 响应输出。"""

        payload: dict[str, Any] = {
            "clientMutationId": self.client_mutation_id,
            "accepted": self.accepted,
            "newRevision": self.new_revision,
            "updatedSections": list(self.updated_sections),
            "sectionRevisions": dict(self.section_revisions),
            "appliedMutations": [dict(entry) for entry in self.applied_mutations],
        }
        if self.correction_patch is not None:
            payload["correctionPatch"] = dict(self.correction_patch)
        return payload
