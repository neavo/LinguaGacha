from module.Data.Core.Project import Project


def test_project_from_dict_filters_unknown_fields_and_roundtrips_public_state() -> None:
    project = Project.from_dict(
        {
            "id": "demo",
            "unexpected": "ignored",
        }
    )

    assert project.to_dict() == {
        "id": "demo",
    }


def test_project_setter_updates_current_snapshot() -> None:
    project = Project()

    project.set_id("chapter-1")

    assert project.get_id() == "chapter-1"
