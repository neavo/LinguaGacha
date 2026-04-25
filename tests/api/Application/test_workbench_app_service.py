import pytest


def test_add_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.add_file(
        {
            "source_path": "C:/next/b.txt",
            "target_rel_path": "script/b.txt",
            "file_record": {
                "rel_path": "script/b.txt",
                "file_type": "TXT",
                "sort_index": 2,
            },
            "parsed_items": [
                {
                    "id": 101,
                    "src": "line-1",
                    "dst": "",
                    "row": 1,
                    "file_type": "TXT",
                    "file_path": "script/b.txt",
                    "text_type": "NONE",
                    "status": "NONE",
                    "retry_count": 0,
                }
            ],
            "derived_meta": {
                "translation_extras": {"line": 1},
                "project_status": "PROCESSING",
                "prefilter_config": {
                    "source_language": "JA",
                    "mtool_optimizer_enable": True,
                },
            },
            "expected_section_revisions": {
                "files": 3,
                "items": 5,
                "analysis": 2,
            },
        }
    )

    assert result["accepted"] is True
    assert result["sectionRevisions"] == {
        "files": 1,
        "items": 2,
        "analysis": 3,
    }
    assert fake_workbench_manager.add_calls == ["C:/next/b.txt"]
    assert fake_workbench_manager.add_payloads[0]["target_rel_path"] == "script/b.txt"


def test_parse_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.parse_file({"source_path": "C:/next/b.txt"})

    assert result["target_rel_path"] == "script/b.txt"
    assert result["file_type"] == "TXT"
    assert fake_workbench_manager.parse_calls == [("C:/next/b.txt", None)]


def test_reorder_files_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.reorder_files(
        {"ordered_rel_paths": ["script/b.txt", "script/a.txt"]}
    )

    assert result["accepted"] is True
    assert fake_workbench_manager.reorder_calls == [["script/b.txt", "script/a.txt"]]


def test_reset_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.reset_file({"rel_path": "script/a.txt"})

    assert result["accepted"] is True
    assert fake_workbench_manager.reset_calls == ["script/a.txt"]


def test_delete_file_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.delete_file({"rel_path": "script/a.txt"})

    assert result["accepted"] is True
    assert fake_workbench_manager.delete_calls == ["script/a.txt"]


def test_delete_file_batch_routes_through_workbench_manager(
    workbench_app_service,
    fake_workbench_manager,
) -> None:
    result = workbench_app_service.delete_file_batch(
        {"rel_paths": ["script/a.txt", "script/b.txt"]}
    )

    assert result["accepted"] is True
    assert fake_workbench_manager.delete_batch_calls == [
        ["script/a.txt", "script/b.txt"]
    ]


def test_add_file_propagates_manager_value_error(workbench_app_service) -> None:
    class FailingWorkbenchManager:
        def persist_add_file_payload(
            self,
            source_path: str,
            target_rel_path: str,
            *,
            file_record: dict[str, object],
            parsed_items: list[dict[str, object]],
            translation_extras: dict[str, object],
            project_status: str,
            prefilter_config: dict[str, object],
            expected_section_revisions: dict[str, int] | None = None,
        ) -> None:
            del target_rel_path, file_record, parsed_items
            del translation_extras, project_status, prefilter_config
            del expected_section_revisions
            raise ValueError(f"duplicate: {source_path}")

    service = type(workbench_app_service)(FailingWorkbenchManager())

    with pytest.raises(ValueError, match="duplicate: C:/next/b.txt"):
        service.add_file(
            {
                "source_path": "C:/next/b.txt",
                "target_rel_path": "script/b.txt",
                "file_record": {"rel_path": "script/b.txt", "file_type": "TXT"},
                "parsed_items": [],
                "derived_meta": {
                    "translation_extras": {},
                    "project_status": "NONE",
                    "prefilter_config": {},
                },
            }
        )
