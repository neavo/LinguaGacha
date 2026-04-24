from api.Contract.BootstrapPayloads import BootstrapCompletedPayload
from api.Contract.BootstrapPayloads import BootstrapStageCompleted
from api.Contract.BootstrapPayloads import BootstrapStagePayload
from api.Contract.BootstrapPayloads import BootstrapStageStarted


def test_bootstrap_payloads_encode_stage_lifecycle_and_completion() -> None:
    events = [
        BootstrapStageStarted(stage="items", message="正在加载项目条目").to_dict(),
        BootstrapStagePayload(stage="items", payload={"fields": ["item_id"]}).to_dict(),
        BootstrapStageCompleted(stage="items").to_dict(),
        BootstrapCompletedPayload(
            project_revision=7,
            section_revisions={"items": 7, "task": 3},
        ).to_dict(),
    ]

    assert events == [
        {
            "type": "stage_started",
            "stage": "items",
            "message": "正在加载项目条目",
        },
        {
            "type": "stage_payload",
            "stage": "items",
            "payload": {"fields": ["item_id"]},
        },
        {
            "type": "stage_completed",
            "stage": "items",
        },
        {
            "type": "completed",
            "projectRevision": 7,
            "sectionRevisions": {"items": 7, "task": 3},
        },
    ]
