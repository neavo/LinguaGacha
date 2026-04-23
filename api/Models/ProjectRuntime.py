from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RowBlock:
    """统一描述 bootstrap 的行块载荷，避免事件层重复拼装结构。"""

    fields: tuple[str, ...]
    rows: tuple[tuple[object, ...], ...]

    def to_dict(self) -> dict[str, Any]:
        """转换为稳定 JSON 结构，供 bootstrap 和 patch 复用。"""

        return {
            "fields": list(self.fields),
            "rows": [list(row) for row in self.rows],
        }


@dataclass(frozen=True)
class ProjectMutationAck:
    """同步项目 mutation 的统一回执。"""

    accepted: bool = True
    project_revision: int = 0
    section_revisions: dict[str, int] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ProjectMutationAck":
        normalized = data if isinstance(data, dict) else {}
        section_revisions_raw = normalized.get("sectionRevisions", {})
        section_revisions: dict[str, int] = {}
        if isinstance(section_revisions_raw, dict):
            for section, revision in section_revisions_raw.items():
                if not isinstance(section, str):
                    continue
                try:
                    section_revisions[section] = int(revision)
                except TypeError:
                    continue
                except ValueError:
                    continue
        return cls(
            accepted=bool(normalized.get("accepted", True)),
            project_revision=int(normalized.get("projectRevision", 0) or 0),
            section_revisions=section_revisions,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "projectRevision": self.project_revision,
            "sectionRevisions": dict(self.section_revisions or {}),
        }
