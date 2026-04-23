from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BootstrapStageStarted:
    """描述某个 bootstrap stage 开始执行时的稳定事件结构。"""

    stage: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "stage_started",
            "stage": self.stage,
            "message": self.message,
        }


@dataclass(frozen=True)
class BootstrapStagePayload:
    """描述某个 bootstrap stage 的分段有效载荷。"""

    stage: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "stage_payload",
            "stage": self.stage,
            "payload": self.payload,
        }


@dataclass(frozen=True)
class BootstrapStageCompleted:
    """描述某个 bootstrap stage 完成时的稳定事件结构。"""

    stage: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "stage_completed",
            "stage": self.stage,
        }


@dataclass(frozen=True)
class BootstrapCompletedPayload:
    """描述整条 bootstrap 流完成时的 revision 对账结果。"""

    project_revision: int
    section_revisions: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "completed",
            "projectRevision": self.project_revision,
            "sectionRevisions": self.section_revisions,
        }
