from api.Client.WorkbenchApiClient import WorkbenchApiClient
from api.Models.ProjectRuntime import ProjectMutationAck
import pytest


@pytest.mark.parametrize(
    ("method_name", "kwargs", "expected_request", "expected_response"),
    [
        (
            "add_file",
            {
                "files": [
                    {
                        "source_path": "C:/next/c.txt",
                        "target_rel_path": "script/c.txt",
                        "file_record": {
                            "rel_path": "script/c.txt",
                            "file_type": "TXT",
                            "sort_index": 2,
                        },
                        "parsed_items": [{"id": 101, "src": "line-1"}],
                    }
                ],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                WorkbenchApiClient.WORKBENCH_ADD_FILE_PATH,
                {
                    "files": [
                        {
                            "source_path": "C:/next/c.txt",
                            "target_rel_path": "script/c.txt",
                            "file_record": {
                                "rel_path": "script/c.txt",
                                "file_type": "TXT",
                                "sort_index": 2,
                            },
                            "parsed_items": [{"id": 101, "src": "line-1"}],
                        }
                    ],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "prefilter_config": {
                            "source_language": "JA",
                            "mtool_optimizer_enable": True,
                        },
                    },
                    "expected_section_revisions": {
                        "files": 1,
                        "items": 2,
                        "analysis": 3,
                    },
                },
            ),
            {"accepted": True, "projectRevision": 9, "sectionRevisions": {"files": 4}},
        ),
        (
            "reset_file",
            {
                "rel_paths": ["script/a.txt"],
                "items": [{"id": 1, "src": "line-1"}],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"items": 2, "analysis": 3},
            },
            (
                WorkbenchApiClient.WORKBENCH_RESET_FILE_PATH,
                {
                    "rel_paths": ["script/a.txt"],
                    "items": [{"id": 1, "src": "line-1"}],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "prefilter_config": {
                            "source_language": "JA",
                            "mtool_optimizer_enable": True,
                        },
                    },
                    "expected_section_revisions": {"items": 2, "analysis": 3},
                },
            ),
            {"accepted": True, "projectRevision": 9, "sectionRevisions": {"items": 4}},
        ),
        (
            "delete_file",
            {
                "rel_paths": ["script/a.txt"],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                WorkbenchApiClient.WORKBENCH_DELETE_FILE_PATH,
                {
                    "rel_paths": ["script/a.txt"],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "prefilter_config": {
                            "source_language": "JA",
                            "mtool_optimizer_enable": True,
                        },
                    },
                    "expected_section_revisions": {
                        "files": 1,
                        "items": 2,
                        "analysis": 3,
                    },
                },
            ),
            {"accepted": True, "projectRevision": 9, "sectionRevisions": {"files": 4}},
        ),
        (
            "reorder_files",
            {
                "ordered_rel_paths": ["script/a.txt"],
                "expected_section_revisions": {"files": 1},
            },
            (
                WorkbenchApiClient.WORKBENCH_REORDER_FILES_PATH,
                {
                    "ordered_rel_paths": ["script/a.txt"],
                    "expected_section_revisions": {"files": 1},
                },
            ),
            {"accepted": True, "projectRevision": 9, "sectionRevisions": {"files": 4}},
        ),
    ],
)
def test_workbench_api_client_forwards_mutation_payloads(
    recording_api_client,
    method_name: str,
    kwargs: dict[str, object],
    expected_request: tuple[str, dict[str, object]],
    expected_response: dict[str, object],
) -> None:
    workbench_client = WorkbenchApiClient(recording_api_client)
    recording_api_client.queue_post_response(expected_request[0], expected_response)

    result = getattr(workbench_client, method_name)(**kwargs)

    assert recording_api_client.post_requests[-1] == expected_request
    assert isinstance(result, ProjectMutationAck)
    assert result.to_dict() == expected_response


def test_workbench_api_client_parse_file_forwards_payload(recording_api_client) -> None:
    workbench_client = WorkbenchApiClient(recording_api_client)
    recording_api_client.queue_post_response(
        WorkbenchApiClient.WORKBENCH_PARSE_FILE_PATH,
        {
            "files": [
                {
                    "source_path": "C:/next/b.txt",
                    "target_rel_path": "script/b.txt",
                    "file_type": "TXT",
                    "parsed_items": [{"src": "line-1"}],
                }
            ],
        },
    )

    result = workbench_client.parse_file(["C:/next/b.txt"])

    assert recording_api_client.post_requests[-1] == (
        WorkbenchApiClient.WORKBENCH_PARSE_FILE_PATH,
        {
            "source_paths": ["C:/next/b.txt"],
        },
    )
    assert result["files"][0]["target_rel_path"] == "script/b.txt"
