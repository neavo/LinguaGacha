from threading import RLock
from types import SimpleNamespace

import pytest

from module.Data.Project.ProjectRuntimeRevisionService import (
    ProjectRuntimeRevisionConflictError,
)
from module.Data.Project.ProjectRuntimeRevisionService import (
    ProjectRuntimeRevisionService,
)


class FakeMetaService:
    def __init__(self) -> None:
        self.meta: dict[str, object] = {}
        self.session = SimpleNamespace(state_lock=RLock())

    def get_meta(self, key: str, default: object = None) -> object:
        return self.meta.get(key, default)

    def set_meta(self, key: str, value: object) -> None:
        self.meta[key] = value


def test_build_revision_meta_key_uses_supported_section_name() -> None:
    assert (
        ProjectRuntimeRevisionService.build_revision_meta_key("files")
        == "project_runtime_revision.files"
    )


def test_get_revision_normalizes_invalid_and_negative_values() -> None:
    meta_service = FakeMetaService()
    meta_service.meta["project_runtime_revision.items"] = "-3"
    service = ProjectRuntimeRevisionService(meta_service)

    assert service.get_revision("items") == 0
    assert service.get_revision("analysis", default=5) == 5


def test_assert_revision_raises_when_expected_revision_mismatches() -> None:
    meta_service = FakeMetaService()
    meta_service.meta["project_runtime_revision.files"] = 2
    service = ProjectRuntimeRevisionService(meta_service)

    with pytest.raises(ProjectRuntimeRevisionConflictError, match="section=files"):
        service.assert_revision("files", 1)


def test_bump_revisions_deduplicates_sections_and_persists_results() -> None:
    meta_service = FakeMetaService()
    meta_service.meta["project_runtime_revision.files"] = 2
    service = ProjectRuntimeRevisionService(meta_service)

    result = service.bump_revisions(["files", "items", "files"])

    assert result == {
        "files": 3,
        "items": 1,
    }
    assert meta_service.meta["project_runtime_revision.files"] == 3
    assert meta_service.meta["project_runtime_revision.items"] == 1
