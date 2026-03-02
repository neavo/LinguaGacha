from pathlib import Path

from base.Base import Base


def test_translation_reset_failed_event_name_is_normalized() -> None:
    assert Base.Event.TRANSLATION_RESET_FAILED.value == "TRANSLATION_RESET_FAILED"


def test_translation_event_names_match_semantics() -> None:
    assert Base.Event.TRANSLATION_TASK.value == "TRANSLATION_TASK"
    assert Base.Event.TRANSLATION_REQUEST_STOP.value == "TRANSLATION_REQUEST_STOP"
    assert Base.Event.TRANSLATION_PROGRESS.value == "TRANSLATION_PROGRESS"


def test_workbench_refresh_events_are_split_from_file_update() -> None:
    assert Base.Event.WORKBENCH_REFRESH.value == "WORKBENCH_REFRESH"
    assert Base.Event.WORKBENCH_SNAPSHOT.value == "WORKBENCH_SNAPSHOT"
    assert Base.Event.WORKBENCH_REFRESH != Base.Event.PROJECT_FILE_UPDATE
    assert Base.Event.WORKBENCH_SNAPSHOT != Base.Event.PROJECT_FILE_UPDATE


def test_event_contract_document_contains_key_events() -> None:
    doc_path = Path("docs/event-contract.md")
    assert doc_path.exists()

    content = doc_path.read_text(encoding="utf-8")
    assert "TRANSLATION_RESET_FAILED" in content
    assert "TRANSLATION_TASK" in content
    assert "TRANSLATION_REQUEST_STOP" in content
    assert "TRANSLATION_PROGRESS" in content
    assert "WORKBENCH_REFRESH" in content
    assert "WORKBENCH_SNAPSHOT" in content
