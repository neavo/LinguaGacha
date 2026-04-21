from module.Data.Project.V2.RevisionService import V2ProjectRevisionService


def test_revision_service_snapshot_starts_with_zeroed_project_and_sections() -> None:
    # Arrange
    service = V2ProjectRevisionService()

    # Act
    project_revision, section_revisions = service.snapshot()

    # Assert
    assert project_revision == 0
    assert section_revisions == {
        "project": 0,
        "files": 0,
        "items": 0,
        "quality": 0,
        "prompts": 0,
        "analysis": 0,
        "task": 0,
    }


def test_revision_service_bump_advances_project_revision_and_selected_sections() -> None:
    # Arrange
    service = V2ProjectRevisionService()

    # Act
    project_revision, section_revisions = service.bump("items", "task")

    # Assert
    assert project_revision == 1
    assert section_revisions["items"] == 1
    assert section_revisions["task"] == 1
    assert section_revisions["project"] == 0
    assert section_revisions["files"] == 0
    assert section_revisions["quality"] == 0
    assert section_revisions["prompts"] == 0
    assert section_revisions["analysis"] == 0
