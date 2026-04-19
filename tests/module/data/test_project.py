from base.Base import Base
from module.Data.Core.Project import Project


def test_project_from_dict_filters_unknown_fields_and_roundtrips_public_state() -> None:
    project = Project.from_dict(
        {
            "id": "demo",
            "status": Base.ProjectStatus.PROCESSING,
            "extras": {"line": 3},
            "unexpected": "ignored",
        }
    )

    assert project.to_dict() == {
        "id": "demo",
        "status": Base.ProjectStatus.PROCESSING,
        "extras": {"line": 3},
    }


def test_project_setters_update_current_snapshot() -> None:
    project = Project()

    project.set_id("chapter-1")
    project.set_status(Base.ProjectStatus.PROCESSED)
    project.set_extras({"processed_line": 8})

    assert project.get_id() == "chapter-1"
    assert project.get_status() == Base.ProjectStatus.PROCESSED
    assert project.get_extras() == {"processed_line": 8}
