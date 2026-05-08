from base.Base import Base

from api.Client.ProofreadingApiClient import ProofreadingApiClient
from api.Contract.ApiPaths import ProofreadingApiPaths
from api.Models.ProjectRuntime import ProjectMutationAck


def test_proofreading_api_client_save_item_returns_project_mutation_ack(
    recording_api_client,
) -> None:
    proofreading_client = ProofreadingApiClient(recording_api_client)
    request = {
        "items": [
            {
                "id": 1,
                "dst": "Hero arrived again",
                "status": Base.ItemStatus.PROCESSED,
            }
        ],
        "expected_section_revisions": {"items": 7, "proofreading": 6},
    }
    recording_api_client.queue_post_response(
        ProofreadingApiPaths.SAVE_ITEM_PATH,
        {
            "accepted": True,
            "projectRevision": 11,
            "sectionRevisions": {"items": 8, "proofreading": 9},
        },
    )

    result = proofreading_client.save_item(request)

    assert isinstance(result, ProjectMutationAck)
    assert result.to_dict() == {
        "accepted": True,
        "projectRevision": 11,
        "sectionRevisions": {"items": 8, "proofreading": 9},
    }
    assert recording_api_client.post_requests == [
        (ProofreadingApiPaths.SAVE_ITEM_PATH, request)
    ]


def test_proofreading_api_client_replace_all_returns_project_mutation_ack(
    recording_api_client,
) -> None:
    proofreading_client = ProofreadingApiClient(recording_api_client)
    request = {
        "items": [
            {
                "id": 1,
                "dst": "Hero arrived",
                "status": Base.ItemStatus.PROCESSED,
            }
        ],
        "search_text": "Hero",
        "replace_text": "Heroine",
        "expected_section_revisions": {"items": 7, "proofreading": 6},
    }
    recording_api_client.queue_post_response(
        ProofreadingApiPaths.REPLACE_ALL_PATH,
        {
            "accepted": True,
            "projectRevision": 11,
            "sectionRevisions": {"items": 8, "proofreading": 9},
        },
    )

    result = proofreading_client.replace_all(request)

    assert isinstance(result, ProjectMutationAck)
    assert result.project_revision == 11
    assert result.section_revisions == {"items": 8, "proofreading": 9}
    assert recording_api_client.post_requests == [
        (ProofreadingApiPaths.REPLACE_ALL_PATH, request)
    ]


def test_proofreading_api_client_save_all_returns_project_mutation_ack(
    recording_api_client,
) -> None:
    proofreading_client = ProofreadingApiClient(recording_api_client)
    request = {
        "items": [
            {"id": 1, "dst": "", "status": Base.ItemStatus.NONE},
            {"id": 2, "dst": "", "status": Base.ItemStatus.NONE},
        ],
        "expected_section_revisions": {"items": 7, "proofreading": 6},
    }
    recording_api_client.queue_post_response(
        ProofreadingApiPaths.SAVE_ALL_PATH,
        {
            "accepted": True,
            "projectRevision": 11,
            "sectionRevisions": {"items": 8, "proofreading": 9},
        },
    )

    result = proofreading_client.save_all(request)

    assert isinstance(result, ProjectMutationAck)
    assert result.accepted is True
    assert result.section_revisions == {"items": 8, "proofreading": 9}
    assert recording_api_client.post_requests == [
        (ProofreadingApiPaths.SAVE_ALL_PATH, request)
    ]
