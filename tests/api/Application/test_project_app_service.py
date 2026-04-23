from threading import RLock
from types import SimpleNamespace

from api.Application.ProjectAppService import ProjectAppService


class _FakeProjectManagerForAnalysisGlossaryImport:
    def __init__(self) -> None:
        self.session = type("FakeSession", (), {"state_lock": RLock()})()
        self.quality_rule_service = self
        self.meta_service = self
        self.runtime_section_revisions = {
            "quality": 12,
            "analysis": 3,
        }
        self.saved_glossary_entries: list[dict[str, object]] = []
        self.saved_glossary_expected_revision: int | None = None
        self.meta: dict[str, object] = {}
        self.bumped_sections: list[tuple[str, ...]] = []

    def get_meta(self, key: str, default: object = None) -> object:
        return self.meta.get(key, default)

    def set_meta(self, key: str, value: object) -> None:
        self.meta[key] = value

    def assert_project_runtime_section_revision(
        self,
        section: str,
        expected_revision: int,
    ) -> int:
        current_revision = self.runtime_section_revisions.get(section, 0)
        if current_revision != expected_revision:
            raise ValueError(
                f"运行态 revision 冲突：section={section} 当前={current_revision} 期望={expected_revision}"
            )
        return current_revision

    def save_entries(
        self,
        rule_type: str,
        *,
        expected_revision: int,
        entries: list[dict[str, object]],
    ) -> dict[str, object]:
        assert rule_type == "glossary"
        self.saved_glossary_expected_revision = expected_revision
        self.saved_glossary_entries = [dict(entry) for entry in entries]
        return {
            "entries": self.saved_glossary_entries,
            "revision": expected_revision + 1,
        }

    def get_section_revision(self, stage: str) -> int:
        return int(self.runtime_section_revisions.get(stage, 0))

    def build_project_mutation_ack(
        self,
        updated_sections: tuple[str, ...] | list[str],
    ) -> dict[str, object]:
        return {
            "accepted": True,
            "projectRevision": 12,
            "sectionRevisions": {
                str(section): self.get_section_revision(str(section))
                for section in updated_sections
            },
        }

    def bump_project_runtime_section_revisions(
        self,
        sections: tuple[str, ...] | list[str],
    ) -> dict[str, int]:
        normalized_sections = tuple(str(section) for section in sections)
        self.bumped_sections.append(normalized_sections)
        for section in normalized_sections:
            self.runtime_section_revisions[section] = (
                self.runtime_section_revisions.get(section, 0) + 1
            )
        return {
            section: self.runtime_section_revisions[section]
            for section in normalized_sections
        }


class _FakeProjectManagerForResetMutations:
    def __init__(self) -> None:
        self.loaded = True
        self.project_path = "E:/Project/LinguaGacha/output/demo.lg"
        self.preview_translation_items = [
            {
                "id": 11,
                "src": "原文 A",
                "dst": "",
                "name_src": "Alice",
                "name_dst": None,
                "extra_field": "",
                "tag": "",
                "row": 1,
                "file_type": "TXT",
                "file_path": "script/a.txt",
                "text_type": "NONE",
                "status": "NONE",
                "retry_count": 0,
            }
        ]
        self.preview_analysis_status_summary = {
            "total_line": 5,
            "processed_line": 3,
            "error_line": 0,
            "line": 3,
        }
        self.preview_translation_reset_all_calls: list[object] = []
        self.apply_translation_reset_all_calls: list[dict[str, object]] = []
        self.apply_translation_reset_failed_calls: list[dict[str, object]] = []
        self.preview_analysis_reset_failed_calls: int = 0
        self.apply_analysis_reset_all_calls: list[dict[str, object]] = []
        self.apply_analysis_reset_failed_calls: list[dict[str, object]] = []
        self.runtime_section_revisions = {
            "items": 5,
            "analysis": 7,
        }

    def is_loaded(self) -> bool:
        return self.loaded

    def get_lg_path(self) -> str:
        return self.project_path

    def preview_translation_reset_all(self, config: object) -> list[dict[str, object]]:
        self.preview_translation_reset_all_calls.append(config)
        return [dict(item) for item in self.preview_translation_items]

    def apply_translation_reset_all_payload(
        self, **kwargs: object
    ) -> list[dict[str, object]]:
        self.apply_translation_reset_all_calls.append(dict(kwargs))
        self.runtime_section_revisions["items"] += 1
        self.runtime_section_revisions["analysis"] += 1
        return [dict(item) for item in kwargs["item_payloads"]]

    def apply_translation_reset_failed_payload(
        self, **kwargs: object
    ) -> list[dict[str, object]]:
        self.apply_translation_reset_failed_calls.append(dict(kwargs))
        self.runtime_section_revisions["items"] += 1
        return [dict(item) for item in kwargs["item_payloads"]]

    def preview_analysis_reset_failed(self) -> dict[str, int]:
        self.preview_analysis_reset_failed_calls += 1
        return dict(self.preview_analysis_status_summary)

    def apply_analysis_reset_all_payload(self, **kwargs: object) -> dict[str, object]:
        self.apply_analysis_reset_all_calls.append(dict(kwargs))
        self.runtime_section_revisions["analysis"] += 1
        return dict(kwargs["analysis_extras"])

    def apply_analysis_reset_failed_payload(
        self, **kwargs: object
    ) -> tuple[int, dict[str, object]]:
        self.apply_analysis_reset_failed_calls.append(dict(kwargs))
        self.runtime_section_revisions["analysis"] += 1
        return 2, dict(kwargs["analysis_extras"])

    def build_project_mutation_ack(
        self,
        updated_sections: tuple[str, ...] | list[str],
    ) -> dict[str, object]:
        section_revisions = {
            str(section): self.runtime_section_revisions[str(section)]
            for section in updated_sections
        }
        return {
            "accepted": True,
            "projectRevision": max(section_revisions.values(), default=0),
            "sectionRevisions": section_revisions,
        }


def test_load_project_returns_loaded_snapshot(
    project_app_service,
    fake_project_manager,
    lg_path: str,
) -> None:
    result = project_app_service.load_project({"path": lg_path})

    assert fake_project_manager.load_calls == [lg_path]
    assert result["project"]["path"] == lg_path
    assert result["project"]["loaded"] is True


def test_create_project_loads_output_path_and_returns_loaded_snapshot(
    project_app_service,
    fake_project_manager,
) -> None:
    result = project_app_service.create_project(
        {
            "source_path": "E:/Project/LinguaGacha/source",
            "path": "E:/Project/LinguaGacha/output/demo.lg",
        }
    )

    assert fake_project_manager.create_calls == [
        (
            "E:/Project/LinguaGacha/source",
            "E:/Project/LinguaGacha/output/demo.lg",
        )
    ]
    assert fake_project_manager.load_calls == ["E:/Project/LinguaGacha/output/demo.lg"]
    assert result["project"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "loaded": True,
    }


def test_get_project_snapshot_uses_current_loaded_project_path(
    project_app_service,
    fake_project_manager,
) -> None:
    fake_project_manager.load_project("E:/Project/LinguaGacha/output/demo.lg")

    result = project_app_service.get_project_snapshot({})

    assert result["project"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "loaded": True,
    }


def test_unload_project_returns_cleared_snapshot(
    project_app_service,
    fake_project_manager,
) -> None:
    fake_project_manager.load_project("E:/Project/LinguaGacha/output/demo.lg")

    result = project_app_service.unload_project({})

    assert result["project"] == {
        "path": "",
        "loaded": False,
    }


def test_collect_source_files_returns_serializable_paths(
    project_app_service,
) -> None:
    result = project_app_service.collect_source_files(
        {"path": "E:/Project/LinguaGacha/source"}
    )

    assert result == {
        "source_files": ["E:/Project/LinguaGacha/source"],
    }


def test_get_project_preview_returns_preview_payload(
    project_app_service,
) -> None:
    result = project_app_service.get_project_preview(
        {"path": "E:/Project/LinguaGacha/output/demo.lg"}
    )

    assert result["preview"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "name": "demo",
        "source_language": "JA",
        "target_language": "ZH",
        "file_count": 1,
        "created_at": "",
        "updated_at": "",
        "total_items": 8,
        "translated_items": 3,
        "progress": 0.375,
    }


def test_import_analysis_glossary_uses_glossary_revision_and_quality_section_revision() -> (
    None
):
    fake_project_manager = _FakeProjectManagerForAnalysisGlossaryImport()
    project_app_service = ProjectAppService(fake_project_manager)
    project_app_service.quality_rule_facade = fake_project_manager
    project_app_service.runtime_service = fake_project_manager

    result = project_app_service.import_analysis_glossary(
        {
            "entries": [
                {
                    "src": "艾琳",
                    "dst": "Erin",
                    "info": "角色名",
                    "case_sensitive": True,
                }
            ],
            "analysis_candidate_count": 0,
            "expected_glossary_revision": 7,
            "expected_section_revisions": {
                "quality": 12,
                "analysis": 3,
            },
        }
    )

    assert fake_project_manager.saved_glossary_expected_revision == 7
    assert fake_project_manager.saved_glossary_entries == [
        {
            "src": "艾琳",
            "dst": "Erin",
            "info": "角色名",
            "case_sensitive": True,
        }
    ]
    assert fake_project_manager.meta["analysis_candidate_count"] == 0
    assert fake_project_manager.bumped_sections == [("analysis",)]
    assert result == {
        "accepted": True,
        "projectRevision": 12,
        "sectionRevisions": {
            "quality": 12,
            "analysis": 4,
        },
    }


def test_preview_translation_reset_returns_full_preview_items() -> None:
    fake_project_manager = _FakeProjectManagerForResetMutations()
    fake_config = object()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
        config_loader=lambda: fake_config,
    )

    result = project_app_service.preview_translation_reset({"mode": "all"})

    assert fake_project_manager.preview_translation_reset_all_calls == [fake_config]
    assert result == {"items": fake_project_manager.preview_translation_items}


def test_apply_translation_reset_all_forwards_payload_and_returns_items_analysis_ack() -> (
    None
):
    fake_project_manager = _FakeProjectManagerForResetMutations()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
    )
    project_app_service.runtime_service = fake_project_manager

    result = project_app_service.apply_translation_reset(
        {
            "mode": "all",
            "items": fake_project_manager.preview_translation_items,
            "translation_extras": {"line": 0},
            "project_status": "NONE",
            "prefilter_config": {"source_language": "JA"},
            "expected_section_revisions": {
                "items": 5,
                "analysis": 7,
            },
        }
    )

    assert fake_project_manager.apply_translation_reset_all_calls == [
        {
            "item_payloads": fake_project_manager.preview_translation_items,
            "translation_extras": {"line": 0},
            "project_status": "NONE",
            "prefilter_config": {"source_language": "JA"},
            "expected_section_revisions": {"items": 5, "analysis": 7},
        }
    ]
    assert result == {
        "accepted": True,
        "projectRevision": 8,
        "sectionRevisions": {
            "items": 6,
            "analysis": 8,
        },
    }


def test_apply_translation_reset_failed_forwards_payload_and_returns_items_ack() -> (
    None
):
    fake_project_manager = _FakeProjectManagerForResetMutations()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
    )
    project_app_service.runtime_service = fake_project_manager

    result = project_app_service.apply_translation_reset(
        {
            "mode": "failed",
            "items": [
                {
                    "id": 11,
                    "dst": "",
                    "status": "NONE",
                    "retry_count": 0,
                }
            ],
            "translation_extras": {"line": 3, "error_line": 0},
            "project_status": "PROCESSING",
            "expected_section_revisions": {
                "items": 5,
            },
        }
    )

    assert fake_project_manager.apply_translation_reset_failed_calls == [
        {
            "item_payloads": [
                {
                    "id": 11,
                    "dst": "",
                    "status": "NONE",
                    "retry_count": 0,
                }
            ],
            "translation_extras": {"line": 3, "error_line": 0},
            "project_status": "PROCESSING",
            "expected_section_revisions": {"items": 5},
        }
    ]
    assert result == {
        "accepted": True,
        "projectRevision": 6,
        "sectionRevisions": {
            "items": 6,
        },
    }


def test_preview_analysis_reset_returns_status_summary() -> None:
    fake_project_manager = _FakeProjectManagerForResetMutations()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
    )

    result = project_app_service.preview_analysis_reset({"mode": "failed"})

    assert fake_project_manager.preview_analysis_reset_failed_calls == 1
    assert result == {
        "status_summary": fake_project_manager.preview_analysis_status_summary
    }


def test_apply_analysis_reset_all_returns_analysis_ack() -> None:
    fake_project_manager = _FakeProjectManagerForResetMutations()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
    )
    project_app_service.runtime_service = fake_project_manager

    result = project_app_service.apply_analysis_reset(
        {
            "mode": "all",
            "analysis_extras": {
                "start_time": 0.0,
                "time": 0.0,
                "total_line": 5,
                "line": 0,
                "processed_line": 0,
                "error_line": 0,
            },
            "expected_section_revisions": {"analysis": 7},
        }
    )

    assert fake_project_manager.apply_analysis_reset_all_calls == [
        {
            "analysis_extras": {
                "start_time": 0.0,
                "time": 0.0,
                "total_line": 5,
                "line": 0,
                "processed_line": 0,
                "error_line": 0,
            },
            "expected_section_revisions": {"analysis": 7},
        }
    ]
    assert result == {
        "accepted": True,
        "projectRevision": 8,
        "sectionRevisions": {
            "analysis": 8,
        },
    }


def test_apply_analysis_reset_failed_returns_analysis_ack() -> None:
    fake_project_manager = _FakeProjectManagerForResetMutations()
    project_app_service = ProjectAppService(
        fake_project_manager,
        engine=SimpleNamespace(is_busy=lambda: False),
    )
    project_app_service.runtime_service = fake_project_manager

    result = project_app_service.apply_analysis_reset(
        {
            "mode": "failed",
            "analysis_extras": {
                "start_time": 12.0,
                "time": 3.0,
                "total_line": 5,
                "line": 3,
                "processed_line": 3,
                "error_line": 0,
            },
            "expected_section_revisions": {"analysis": 7},
        }
    )

    assert fake_project_manager.apply_analysis_reset_failed_calls == [
        {
            "analysis_extras": {
                "start_time": 12.0,
                "time": 3.0,
                "total_line": 5,
                "line": 3,
                "processed_line": 3,
                "error_line": 0,
            },
            "expected_section_revisions": {"analysis": 7},
        }
    ]
    assert result == {
        "accepted": True,
        "projectRevision": 8,
        "sectionRevisions": {
            "analysis": 8,
        },
    }
