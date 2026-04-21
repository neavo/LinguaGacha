from api.Application.V2.ProjectMutationAppService import V2ProjectMutationAppService


class StubMutationService:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.last_envelope: dict[str, object] | None = None

    def apply_mutations(self, envelope: dict[str, object]) -> dict[str, object]:
        self.last_envelope = envelope
        return dict(self.result)


def test_apply_mutations_wraps_ack_payload():
    mutation_service = StubMutationService(
        {
            "clientMutationId": "m-001",
            "accepted": True,
            "newRevision": 1,
            "updatedSections": ["items"],
            "sectionRevisions": {"items": 1},
            "appliedMutations": [{"index": 0, "status": "applied"}],
        }
    )
    app_service = V2ProjectMutationAppService(mutation_service)

    result = app_service.apply_mutations({"clientMutationId": "m-001"})

    assert mutation_service.last_envelope == {"clientMutationId": "m-001"}
    assert result["ack"]["clientMutationId"] == "m-001"
    assert result["ack"]["accepted"] is True


def test_apply_mutations_keeps_rejected_ack_payload():
    app_service = V2ProjectMutationAppService(
        StubMutationService(
            {
                "clientMutationId": "m-002",
                "accepted": False,
                "newRevision": 9,
                "updatedSections": [],
                "sectionRevisions": {"items": 4},
                "appliedMutations": [
                    {
                        "index": 0,
                        "status": "rejected",
                        "error": {"code": "stale_base_revision"},
                    }
                ],
            }
        )
    )

    result = app_service.apply_mutations({"clientMutationId": "m-002"})

    assert result["ack"]["accepted"] is False
    assert (
        result["ack"]["appliedMutations"][0]["error"]["code"] == "stale_base_revision"
    )
