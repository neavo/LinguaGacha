from module.Data.Project.V2.MutationService import V2ProjectMutationService
from module.Data.Project.V2.RevisionService import V2ProjectRevisionService


class StubDataManager:
    def __init__(self) -> None:
        self.last_update: tuple[int, str] | None = None

    def update_item_text(self, item_id: int, dst: str) -> None:
        self.last_update = (item_id, dst)


def test_apply_mutations_returns_ack_with_new_revision():
    data_manager = StubDataManager()
    service = V2ProjectMutationService(data_manager, V2ProjectRevisionService())

    result = service.apply_mutations(
        {
            "clientMutationId": "m-001",
            "baseRevision": 0,
            "mutations": [
                {
                    "type": "item.update_text",
                    "itemId": 1,
                    "fields": {"dst": "新译文"},
                }
            ],
        }
    )

    assert data_manager.last_update == (1, "新译文")
    assert result["clientMutationId"] == "m-001"
    assert result["accepted"] is True
    assert result["newRevision"] == 1
    assert result["updatedSections"] == ["items"]


def test_apply_mutations_returns_rejected_for_stale_base_revision():
    service = V2ProjectMutationService(StubDataManager(), V2ProjectRevisionService())
    service.revision_service.project_revision = 9

    result = service.apply_mutations(
        {
            "clientMutationId": "m-002",
            "baseRevision": 3,
            "mutations": [],
        }
    )

    assert result["accepted"] is False
    assert result["appliedMutations"][0]["status"] == "rejected"
    assert result["appliedMutations"][0]["error"]["code"] == "stale_base_revision"
