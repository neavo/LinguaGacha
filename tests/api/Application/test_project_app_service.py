from contextlib import contextmanager
from threading import RLock
from types import SimpleNamespace

import pytest

from api.Application.ProjectAppService import ProjectAppService
from base.Base import Base
from module.Data.Core.Item import Item


class _FakeProjectManagerForAnalysisGlossaryImport:
    """提供分析术语导入测试替身，避免测试依赖真实工程管理器。"""

    def __init__(self) -> None:
        """初始化 _FakeProjectManagerForAnalysisGlossaryImport 依赖和状态，保持对象写入口明确。"""

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
        """读取测试 meta，模拟项目管理器 revision 来源。"""

        return self.meta.get(key, default)

    def set_meta(self, key: str, value: object) -> None:
        """写入测试 meta，帮助测试断言 revision 变化。"""

        self.meta[key] = value

    def assert_project_runtime_section_revision(
        self,
        section: str,
        expected_revision: int,
    ) -> int:
        """记录 section revision 断言，模拟真实项目并发保护。"""

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
        """记录保存的规则条目，模拟术语导入写入口。"""

        assert rule_type == "glossary"
        self.saved_glossary_expected_revision = expected_revision
        self.saved_glossary_entries = [dict(entry) for entry in entries]
        return {
            "entries": self.saved_glossary_entries,
            "revision": expected_revision + 1,
        }

    def get_section_revision(self, stage: str) -> int:
        """返回测试 section revision，保持 ack 构造可预测。"""

        return int(self.runtime_section_revisions.get(stage, 0))

    def build_project_mutation_ack(
        self,
        updated_sections: tuple[str, ...] | list[str],
    ) -> dict[str, object]:
        """构建测试 mutation ack，避免测试依赖真实 DataManager。"""

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
        """推进测试 revision，模拟项目运行态版本递增。"""

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
    """提供重置 mutation 测试替身，集中记录调用载荷和 revision 回执。"""

    def __init__(self) -> None:
        """初始化 _FakeProjectManagerForResetMutations 依赖和状态，保持对象写入口明确。"""

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
        self.preview_analysis_reset_failed_calls: int = 0
        self.runtime_section_revisions = {
            "items": 5,
            "analysis": 7,
        }

    def is_loaded(self) -> bool:
        """返回测试加载态，驱动服务分支判断。"""

        return self.loaded

    def get_lg_path(self) -> str:
        """返回测试工程路径，避免测试触碰真实文件。"""

        return self.project_path

    def preview_translation_reset_all(self, config: object) -> list[dict[str, object]]:
        """返回翻译重置预览，模拟项目层预演结果。"""

        self.preview_translation_reset_all_calls.append(config)
        return [dict(item) for item in self.preview_translation_items]

    def preview_analysis_reset_failed(self) -> dict[str, int]:
        """返回失败项分析重置预览，模拟项目层筛选结果。"""

        self.preview_analysis_reset_failed_calls += 1
        return dict(self.preview_analysis_status_summary)

    def build_project_mutation_ack(
        self,
        updated_sections: tuple[str, ...] | list[str],
    ) -> dict[str, object]:
        """构建测试 mutation ack，避免测试依赖真实 DataManager。"""

        section_revisions = {
            str(section): self.runtime_section_revisions[str(section)]
            for section in updated_sections
        }
        return {
            "accepted": True,
            "projectRevision": max(section_revisions.values(), default=0),
            "sectionRevisions": section_revisions,
        }


class _FakeProjectManagerForConvertedExport:
    """提供简繁转换导出测试替身，隔离导出逻辑与真实项目状态。"""

    def __init__(self) -> None:
        """初始化 _FakeProjectManagerForConvertedExport 依赖和状态，保持对象写入口明确。"""

        self.loaded = True
        self.custom_suffixes: list[str] = []
        self.items = [
            Item(
                id=1,
                src="源文",
                dst="旧译文",
                name_dst="旧姓名",
                row=7,
                file_type=Item.FileType.TXT,
                file_path="script.txt",
                text_type=Item.TextType.NONE,
                status=Base.ItemStatus.PROCESSED,
            ),
            Item(
                id=2,
                src="第二行",
                dst="保持原样",
                name_dst=["甲", "乙"],
                row=8,
                file_type=Item.FileType.TXT,
                file_path="script.txt",
                text_type=Item.TextType.NONE,
                status=Base.ItemStatus.PROCESSED,
            ),
            Item(
                id=3,
                src="源文",
                row=9,
                file_type=Item.FileType.TXT,
                file_path="script.txt",
                text_type=Item.TextType.NONE,
                status=Base.ItemStatus.DUPLICATED,
            ),
        ]

    def is_loaded(self) -> bool:
        """返回测试加载态，驱动服务分支判断。"""

        return self.loaded

    def get_items_all(self) -> list[Item]:
        """返回测试条目集合，供转换导出构建快照。"""

        return self.items

    @contextmanager
    def export_custom_suffix_context(self, suffix: str):
        """提供测试后缀上下文，避免导出测试依赖真实命名规则。"""

        self.custom_suffixes.append(suffix)
        yield


class _FakeConvertedExportFileManager:
    """提供转换导出文件写入替身，帮助测试断言写出载荷。"""

    def __init__(self) -> None:
        """初始化 _FakeConvertedExportFileManager 依赖和状态，保持对象写入口明确。"""

        self.items: list[Item] = []

    def write_to_path(self, items: list[Item]) -> str:
        """记录写出参数，帮助测试断言转换导出结果。"""

        self.items = items
        return "E:/Project/LinguaGacha/output/demo_译文_S2T"


def test_load_project_returns_loaded_snapshot(
    project_app_service,
    fake_project_manager,
) -> None:
    project_path = "E:/Project/LinguaGacha/output/demo.lg"

    result = project_app_service.load_project({"path": project_path})

    assert fake_project_manager.load_calls == [project_path]
    assert result["project"]["path"] == project_path
    assert result["project"]["loaded"] is True


def test_create_project_preview_returns_unpersisted_draft(
    project_app_service,
    fake_project_manager,
) -> None:
    result = project_app_service.create_project_preview(
        {
            "source_paths": [
                "E:/Project/LinguaGacha/source/a.txt",
                "E:/Project/LinguaGacha/source/b.md",
            ]
        }
    )

    assert fake_project_manager.create_preview_calls == [
        {
            "source_paths": [
                "E:/Project/LinguaGacha/source/a.txt",
                "E:/Project/LinguaGacha/source/b.md",
            ],
        }
    ]
    assert result["draft"]["source_paths"] == [
        "E:/Project/LinguaGacha/source/a.txt",
        "E:/Project/LinguaGacha/source/b.md",
    ]
    assert fake_project_manager.load_calls == []


def test_create_project_commit_persists_frontend_prefiltered_draft_and_loads(
    project_app_service,
    fake_project_manager,
) -> None:
    result = project_app_service.create_project_commit(
        {
            "source_paths": ["E:/Project/LinguaGacha/source/script.txt"],
            "path": "E:/Project/LinguaGacha/output/demo.lg",
            "draft": {
                "files": [
                    {
                        "rel_path": "script.txt",
                        "source_path": "E:/Project/LinguaGacha/source/script.txt",
                    }
                ],
                "items": [{"id": 1, "status": "RULE_SKIPPED"}],
            },
            "project_settings": {
                "source_language": "JA",
                "target_language": "ZH",
                "mtool_optimizer_enable": True,
                "skip_duplicate_source_text_enable": True,
            },
            "translation_extras": {"line": 0},
            "prefilter_config": {
                "source_language": "JA",
                "mtool_optimizer_enable": True,
                "skip_duplicate_source_text_enable": True,
            },
        }
    )

    assert fake_project_manager.create_commit_calls == [
        {
            "source_paths": ["E:/Project/LinguaGacha/source/script.txt"],
            "output_path": "E:/Project/LinguaGacha/output/demo.lg",
            "files": [
                {
                    "rel_path": "script.txt",
                    "source_path": "E:/Project/LinguaGacha/source/script.txt",
                }
            ],
            "items": [{"id": 1, "status": "RULE_SKIPPED"}],
            "project_settings": {
                "source_language": "JA",
                "target_language": "ZH",
                "mtool_optimizer_enable": True,
                "skip_duplicate_source_text_enable": True,
            },
            "translation_extras": {"line": 0},
            "prefilter_config": {
                "source_language": "JA",
                "mtool_optimizer_enable": True,
                "skip_duplicate_source_text_enable": True,
            },
        }
    ]
    assert fake_project_manager.load_calls == ["E:/Project/LinguaGacha/output/demo.lg"]
    assert result["project"] == {
        "path": "E:/Project/LinguaGacha/output/demo.lg",
        "loaded": True,
    }


def test_open_project_alignment_preview_does_not_load_project(
    project_app_service,
    fake_project_manager,
) -> None:
    result = project_app_service.get_open_project_alignment_preview(
        {"path": "E:/Project/LinguaGacha/output/demo.lg"}
    )

    assert fake_project_manager.open_alignment_preview_calls == [
        "E:/Project/LinguaGacha/output/demo.lg"
    ]
    assert result["preview"]["action"] == "settings_only"
    assert fake_project_manager.load_calls == []


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


def test_export_converted_translation_uses_converted_snapshot_without_mutating_project() -> (
    None
):
    fake_project_manager = _FakeProjectManagerForConvertedExport()
    fake_file_manager = _FakeConvertedExportFileManager()
    project_app_service = ProjectAppService(
        fake_project_manager,
        config_loader=lambda: object(),
        file_manager_factory=lambda config: fake_file_manager,
    )

    result = project_app_service.export_converted_translation(
        {
            "suffix": "_S2T",
            "items": [
                {"item_id": 1, "dst": "新譯文", "name_dst": "新姓名"},
                {"item_id": 2, "dst": "保持原樣", "name_dst": ["甲", "乙"]},
            ],
        }
    )

    assert result == {
        "accepted": True,
        "output_path": "E:/Project/LinguaGacha/output/demo_译文_S2T",
    }
    assert fake_project_manager.custom_suffixes == ["_S2T"]
    assert [item.get_dst() for item in fake_file_manager.items] == [
        "新譯文",
        "保持原樣",
        "新譯文",
    ]
    assert fake_file_manager.items[0].get_name_dst() == "新姓名"
    assert fake_file_manager.items[1].get_name_dst() == ["甲", "乙"]
    assert fake_file_manager.items[2].get_status() == Base.ItemStatus.PROCESSED
    assert fake_project_manager.items[0].get_dst() == "旧译文"
    assert fake_project_manager.items[0].get_name_dst() == "旧姓名"
    assert fake_project_manager.items[2].get_dst() == ""
    assert fake_project_manager.items[2].get_status() == Base.ItemStatus.DUPLICATED


def test_export_converted_translation_rejects_invalid_suffix() -> None:
    project_app_service = ProjectAppService(_FakeProjectManagerForConvertedExport())

    with pytest.raises(ValueError):
        project_app_service.export_converted_translation(
            {
                "suffix": "_BAD",
                "items": [{"item_id": 1, "dst": "新譯文"}],
            }
        )
