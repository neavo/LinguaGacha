from collections.abc import Callable

from api.v2.Application.WorkbenchAppService import WorkbenchAppService
from api.v2.Client.ApiClient import ApiClient
from api.v2.Client.WorkbenchApiClient import WorkbenchApiClient
from api.v2.Models.ProjectRuntime import ProjectMutationAck
from api.v2.Server.Routes.ProjectRoutes import ProjectRoutes
from tests.api.support.application_fakes import FakeWorkbenchManager
import pytest


def test_workbench_api_client_reorder_files_forwards_payload(
    fake_workbench_manager: FakeWorkbenchManager,
    start_api_server: Callable[..., str],
) -> None:
    base_url = start_api_server(
        workbench_app_service=WorkbenchAppService(fake_workbench_manager)
    )
    workbench_client = WorkbenchApiClient(ApiClient(base_url))

    result = workbench_client.reorder_files(
        ["script/b.txt", "script/a.txt"],
        {"files": 4},
    )

    assert isinstance(result, ProjectMutationAck)
    assert result.accepted is True
    assert fake_workbench_manager.reorder_calls == [["script/b.txt", "script/a.txt"]]


@pytest.mark.parametrize(
    ("method_name", "kwargs", "expected_request", "expected_response"),
    [
        (
            "add_file",
            {
                "source_path": "C:/next/c.txt",
                "target_rel_path": "script/c.txt",
                "file_record": {
                    "rel_path": "script/c.txt",
                    "file_type": "TXT",
                    "sort_index": 2,
                },
                "parsed_items": [{"id": 101, "src": "line-1"}],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "project_status": "PROCESSING",
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                ProjectRoutes.WORKBENCH_ADD_FILE_PATH,
                {
                    "source_path": "C:/next/c.txt",
                    "target_rel_path": "script/c.txt",
                    "file_record": {
                        "rel_path": "script/c.txt",
                        "file_type": "TXT",
                        "sort_index": 2,
                    },
                    "parsed_items": [{"id": 101, "src": "line-1"}],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "project_status": "PROCESSING",
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
            "replace_file",
            {
                "source_path": "C:/next/a.txt",
                "rel_path": "script/a.txt",
                "target_rel_path": "script/a.txt",
                "file_record": {
                    "rel_path": "script/a.txt",
                    "file_type": "TXT",
                    "sort_index": 0,
                },
                "parsed_items": [{"id": 201, "src": "line-1"}],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "project_status": "PROCESSING",
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                ProjectRoutes.WORKBENCH_REPLACE_FILE_PATH,
                {
                    "source_path": "C:/next/a.txt",
                    "rel_path": "script/a.txt",
                    "target_rel_path": "script/a.txt",
                    "file_record": {
                        "rel_path": "script/a.txt",
                        "file_type": "TXT",
                        "sort_index": 0,
                    },
                    "parsed_items": [{"id": 201, "src": "line-1"}],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "project_status": "PROCESSING",
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
                "rel_path": "script/a.txt",
                "items": [{"id": 1, "src": "line-1"}],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "project_status": "PROCESSING",
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"items": 2, "analysis": 3},
            },
            (
                ProjectRoutes.WORKBENCH_RESET_FILE_PATH,
                {
                    "rel_path": "script/a.txt",
                    "items": [{"id": 1, "src": "line-1"}],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "project_status": "PROCESSING",
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
                "rel_path": "script/a.txt",
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "project_status": "PROCESSING",
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                ProjectRoutes.WORKBENCH_DELETE_FILE_PATH,
                {
                    "rel_path": "script/a.txt",
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "project_status": "PROCESSING",
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
            "delete_file_batch",
            {
                "rel_paths": ["script/a.txt"],
                "derived_meta": {
                    "translation_extras": {"line": 1},
                    "project_status": "PROCESSING",
                    "prefilter_config": {
                        "source_language": "JA",
                        "mtool_optimizer_enable": True,
                    },
                },
                "expected_section_revisions": {"files": 1, "items": 2, "analysis": 3},
            },
            (
                ProjectRoutes.WORKBENCH_DELETE_FILE_BATCH_PATH,
                {
                    "rel_paths": ["script/a.txt"],
                    "derived_meta": {
                        "translation_extras": {"line": 1},
                        "project_status": "PROCESSING",
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
                ProjectRoutes.WORKBENCH_REORDER_FILES_PATH,
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
        ProjectRoutes.WORKBENCH_PARSE_FILE_PATH,
        {
            "target_rel_path": "script/b.txt",
            "file_type": "TXT",
            "parsed_items": [{"src": "line-1"}],
        },
    )

    result = workbench_client.parse_file("C:/next/b.txt", "script/a.txt")

    assert recording_api_client.post_requests[-1] == (
        ProjectRoutes.WORKBENCH_PARSE_FILE_PATH,
        {
            "source_path": "C:/next/b.txt",
            "rel_path": "script/a.txt",
        },
    )
    assert result["target_rel_path"] == "script/b.txt"
