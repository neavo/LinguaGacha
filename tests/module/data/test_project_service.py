from pathlib import Path
from types import SimpleNamespace

import pytest

from base.BasePath import BasePath
from module.Data.Core.Item import Item
from module.Data.Project.ProjectService import ProjectService, ProjectSourceFile


def test_is_supported_file_is_case_insensitive() -> None:
    service = ProjectService()

    assert service.is_supported_file("a.TXT") is True
    assert service.is_supported_file("b.TxT") is True
    assert service.is_supported_file("a.exe") is False


def test_collect_source_files_handles_file_and_directory(fs) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    root_path.mkdir(parents=True, exist_ok=True)

    file_txt = root_path / "single.txt"
    file_txt.write_text("x", encoding="utf-8")
    file_bin = root_path / "single.bin"
    file_bin.write_bytes(b"x")

    src_dir = root_path / "dir"
    src_dir.mkdir()
    (src_dir / "a.txt").write_text("a", encoding="utf-8")
    (src_dir / "b.md").write_text("b", encoding="utf-8")
    (src_dir / "c.bin").write_bytes(b"c")

    assert service.collect_source_files(str(file_txt)) == [str(file_txt)]
    assert service.collect_source_files(str(file_bin)) == []

    collected = service.collect_source_files(str(src_dir))
    assert set(collected) == {str(src_dir / "a.txt"), str(src_dir / "b.md")}


def test_get_relative_path_for_file_and_directory(fs) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    root_path.mkdir(parents=True, exist_ok=True)

    single_file = root_path / "a.txt"
    single_file.write_text("x", encoding="utf-8")
    assert service.get_relative_path(str(single_file), str(single_file)) == "a.txt"

    base_dir = root_path / "base"
    base_dir.mkdir()
    nested = base_dir / "sub" / "b.txt"
    nested.parent.mkdir()
    nested.write_text("x", encoding="utf-8")
    assert service.get_relative_path(str(base_dir), str(nested)) == "sub\\b.txt"


def test_collect_source_files_from_paths_keeps_order_and_removes_duplicates(fs) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    root_path.mkdir(parents=True, exist_ok=True)
    first_file = root_path / "a.txt"
    second_file = root_path / "b.md"
    ignored_file = root_path / "c.bin"
    first_file.write_text("a", encoding="utf-8")
    second_file.write_text("b", encoding="utf-8")
    ignored_file.write_bytes(b"c")

    collected = service.collect_source_files_from_paths(
        [
            str(first_file),
            str(ignored_file),
            str(first_file),
            " ",
            str(second_file),
        ]
    )

    assert collected == [str(first_file), str(second_file)]


def test_collect_source_file_entries_preserves_single_directory_root(fs) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    source_dir = root_path / "source"
    nested_file = source_dir / "chapter" / "script.txt"
    nested_file.parent.mkdir(parents=True, exist_ok=True)
    nested_file.write_text("script", encoding="utf-8")

    entries = service.collect_source_file_entries([str(source_dir)])

    assert entries == [
        ProjectSourceFile(
            source_path=str(nested_file),
            rel_path="chapter\\script.txt",
        )
    ]


def test_collect_source_file_entries_uses_file_names_for_batch_files(fs) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    first_file = root_path / "source" / "script.txt"
    second_file = root_path / "source" / "chapter" / "script.txt"
    first_file.parent.mkdir(parents=True, exist_ok=True)
    second_file.parent.mkdir(parents=True, exist_ok=True)
    first_file.write_text("first", encoding="utf-8")
    second_file.write_text("second", encoding="utf-8")

    entries = service.collect_source_file_entries([str(first_file), str(second_file)])

    assert entries == [
        ProjectSourceFile(
            source_path=str(first_file),
            rel_path="script.txt",
        ),
        ProjectSourceFile(
            source_path=str(second_file),
            rel_path="script_2.txt",
        ),
    ]


def test_build_unique_relative_path_uses_stable_suffix_for_conflicts() -> None:
    service = ProjectService()
    used_rel_paths: set[str] = set()

    first_path = service.build_unique_relative_path(
        rel_path="script.txt",
        used_rel_paths=used_rel_paths,
        source_index=0,
    )
    second_path = service.build_unique_relative_path(
        rel_path="script.txt",
        used_rel_paths=used_rel_paths,
        source_index=1,
    )

    assert first_path == "script.txt"
    assert second_path == "script_2.txt"


def test_build_unique_relative_path_is_case_insensitive_for_conflicts() -> None:
    service = ProjectService()
    used_rel_paths: set[str] = set()

    first_path = service.build_unique_relative_path(
        rel_path="Script.txt",
        used_rel_paths=used_rel_paths,
        source_index=0,
    )
    second_path = service.build_unique_relative_path(
        rel_path="script.txt",
        used_rel_paths=used_rel_paths,
        source_index=1,
    )

    assert first_path == "Script.txt"
    assert second_path == "script_2.txt"


def test_create_preview_and_commit_use_same_batch_file_set(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    service = ProjectService()
    root_path = Path("/workspace/project_service")
    source_dir = root_path / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    first_file = source_dir / "a.txt"
    second_file = source_dir / "nested" / "b.md"
    second_file.parent.mkdir()
    first_file.write_bytes(b"a")
    second_file.write_bytes(b"b")
    output_path = root_path / "out" / "demo.lg"
    fake_db_assets: list[tuple[str, int]] = []

    class FakeConnection:
        def commit(self) -> None:
            return

    class FakeConnectionContext:
        def __enter__(self) -> FakeConnection:
            return FakeConnection()

        def __exit__(self, exc_type, exc_value, traceback) -> None:
            del exc_type
            del exc_value
            del traceback

    class FakeCommitDB:
        def connection(self) -> FakeConnectionContext:
            return FakeConnectionContext()

        def add_asset_from_source(
            self,
            rel_path: str,
            source_path: str,
            *,
            sort_order: int | None = None,
            conn: FakeConnection | None = None,
        ) -> None:
            del source_path
            del conn
            fake_db_assets.append((rel_path, int(sort_order or 0)))

        def set_items(
            self,
            items_dicts: list[dict],
            conn: FakeConnection | None = None,
        ) -> None:
            del items_dicts
            del conn

        def upsert_meta_entries(
            self,
            entries: dict[str, object],
            conn: FakeConnection | None = None,
        ) -> None:
            del entries
            del conn

    class FakeConfig:
        source_language = "JA"
        target_language = "ZH"
        mtool_optimizer_enable = True
        skip_duplicate_source_text_enable = True

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            return []

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Config.load",
        lambda self: FakeConfig(),
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.FileManager",
        FakeFileManager,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway.create",
        lambda output_path, project_name: FakeCommitDB(),
    )

    preview = service.build_create_preview([str(first_file), str(second_file)])
    files = list(preview["files"])

    service.commit_create_preview(
        source_paths=[str(first_file), str(second_file)],
        output_path=str(output_path),
        files=files,
        items=[],
        project_settings={
            "source_language": "JA",
            "target_language": "ZH",
            "mtool_optimizer_enable": True,
            "skip_duplicate_source_text_enable": True,
        },
        translation_extras={},
        prefilter_config={},
    )

    assert files == [
        {
            "rel_path": "a.txt",
            "file_type": "NONE",
            "sort_index": 0,
            "source_path": str(first_file),
        },
        {
            "rel_path": "b.md",
            "file_type": "NONE",
            "sort_index": 1,
            "source_path": str(second_file),
        },
    ]
    assert fake_db_assets == [("a.txt", 0), ("b.md", 1)]


def test_get_project_preview_raises_when_file_not_exists(fs) -> None:
    del fs
    service = ProjectService()

    with pytest.raises(FileNotFoundError):
        service.get_project_preview("/workspace/project_service/missing.lg")


def test_get_project_preview_reads_summary(monkeypatch: pytest.MonkeyPatch, fs) -> None:
    del fs
    service = ProjectService()
    lg_path = Path("/workspace/project_service/demo.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")

    fake_db = SimpleNamespace(get_project_summary=lambda: {"name": "demo"})
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway", lambda path: fake_db
    )

    summary = service.get_project_preview(str(lg_path))
    assert summary == {"name": "demo"}


def test_set_progress_callback_and_report_progress() -> None:
    service = ProjectService()

    called: list[tuple[int, int, str]] = []
    service.report_progress(1, 2, "no-op")
    assert called == []

    service.set_progress_callback(lambda c, t, m: called.append((c, t, m)))
    service.report_progress(1, 2, "ok")
    assert called == [(1, 2, "ok")]

    service.set_progress_callback(None)
    service.report_progress(2, 2, "still no")
    assert called == [(1, 2, "ok")]


class DummyLogger:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.infos: list[str] = []
        self.prints: list[str] = []

    def error(self, msg: str, e: Exception) -> None:
        del e
        self.errors.append(msg)

    def info(self, msg: str) -> None:
        self.infos.append(msg)

    def print(self, msg: str) -> None:
        self.prints.append(msg)


class DummyLocalizer:
    project_store_ingesting_assets = "ingesting assets"
    project_store_ingesting_file = "ingesting {NAME}"
    project_store_parsing_items = "parsing items"
    project_store_created = "created"
    task_processing = "processing"
    engine_task_rule_filter = "rule {COUNT}"
    engine_task_language_filter = "lang {COUNT}"
    translation_mtool_optimizer_pre_log = "mtool {COUNT}"


class FakeDB:
    def __init__(self) -> None:
        self.assets: list[tuple[str, str]] = []
        self.items: list[dict] | None = None
        self.meta: dict[str, object] = {}

    def add_asset_from_source(self, rel_path: str, source_path: str) -> None:
        self.assets.append((rel_path, source_path))

    def set_items(self, items_dicts: list[dict]) -> None:
        self.items = items_dicts

    def set_meta(self, key: str, value: object) -> None:
        self.meta[key] = value


def test_create_ingests_assets_parses_items_and_writes_meta(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    BasePath.reset_for_test()
    BasePath.initialize("/workspace/app", False)

    service = ProjectService()
    progress: list[tuple[int, int, str]] = []
    service.set_progress_callback(lambda c, t, m: progress.append((c, t, m)))

    src_dir = Path("/workspace/project_service/src")
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "a.txt").write_bytes(b"hello")

    out_path = Path("/workspace/project_service/out/demo.lg")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(b"old")

    fake_db = FakeDB()
    logger = DummyLogger()

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.LogManager.get", lambda: logger
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            return [
                Item.from_dict(
                    {
                        "src": "s",
                        "dst": "s",
                        "row": 1,
                        "file_path": "a.txt",
                    }
                )
            ]

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.FileManager", FakeFileManager
    )

    def init_rules(db) -> list[str]:
        assert db is fake_db
        return ["default"]

    presets = service.create(
        source_path=str(src_dir),
        output_path=str(out_path),
        init_rules=init_rules,
    )

    assert presets == ["default"]
    assert out_path.exists() is False

    assert fake_db.assets == [("a.txt", str(src_dir / "a.txt"))]
    assert fake_db.items is not None
    assert fake_db.meta["source_language"] != ""
    assert fake_db.meta["target_language"] != ""
    assert fake_db.meta["skip_duplicate_source_text_enable"] is True
    extras = fake_db.meta["translation_extras"]
    assert isinstance(extras, dict)
    assert extras["total_line"] == 0
    assert progress != []


def test_create_skips_read_failures_and_continues(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    BasePath.reset_for_test()
    BasePath.initialize("/workspace/app", False)

    service = ProjectService()
    src_dir = Path("/workspace/project_service/src")
    src_dir.mkdir(parents=True, exist_ok=True)
    good = src_dir / "a.txt"
    bad = src_dir / "b.md"
    good.write_bytes(b"good")
    bad.write_bytes(b"bad")

    out_path = Path("/workspace/project_service/out/demo.lg")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fake_db = FakeDB()
    logger = DummyLogger()

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.LogManager.get", lambda: logger
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            return []

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.FileManager", FakeFileManager
    )
    real_open = open

    def fake_open(file, mode="r", *args, **kwargs):
        if file == str(bad) and "rb" in mode:
            raise OSError("read failed")
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr("builtins.open", fake_open)

    service.create(source_path=str(src_dir), output_path=str(out_path))

    assert len(fake_db.assets) == 1
    assert fake_db.assets[0][0] == "a.txt"
    assert len(logger.errors) == 1


def test_create_logs_parse_errors_but_keeps_asset(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    BasePath.reset_for_test()
    BasePath.initialize("/workspace/app", False)

    service = ProjectService()
    src_dir = Path("/workspace/project_service/src")
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "a.txt").write_bytes(b"hello")

    out_path = Path("/workspace/project_service/out/demo.lg")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fake_db = FakeDB()
    logger = DummyLogger()

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.LogManager.get", lambda: logger
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            raise ValueError("parse failed")

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.FileManager", FakeFileManager
    )
    service.create(source_path=str(src_dir), output_path=str(out_path))

    assert fake_db.assets != []
    assert fake_db.items is None
    assert any("Failed to parse asset" in msg for msg in logger.errors)


def test_create_records_mtool_setting_without_marking_prefilter_done(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    BasePath.reset_for_test()
    BasePath.initialize("/workspace/app", False)

    service = ProjectService()
    src_dir = Path("/workspace/project_service/src")
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "a.txt").write_bytes(b"hello")

    out_path = Path("/workspace/project_service/out/demo.lg")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fake_db = FakeDB()
    logger = DummyLogger()

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.LogManager.get", lambda: logger
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    class FakeConfig:
        source_language = "JA"
        target_language = "ZH"
        mtool_optimizer_enable = True
        skip_duplicate_source_text_enable = True

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.Config.load",
        lambda self: FakeConfig(),
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            return [Item.from_dict({"src": "s", "dst": "d", "row": 1})]

    monkeypatch.setattr(
        "module.Data.Project.ProjectService.FileManager", FakeFileManager
    )
    service.create(source_path=str(src_dir), output_path=str(out_path))

    assert fake_db.meta["mtool_optimizer_enable"] is True
    assert fake_db.meta["skip_duplicate_source_text_enable"] is True
    assert "prefilter_config" not in fake_db.meta
    assert logger.infos == []


def test_open_alignment_preview_requires_prefilter_when_src_dedup_missing(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    service = ProjectService()
    lg_path = Path("/workspace/project_service/demo.lg")
    lg_path.parent.mkdir(parents=True, exist_ok=True)
    lg_path.write_bytes(b"db")
    fake_db = SimpleNamespace(
        get_all_meta=lambda: {
            "source_language": "JA",
            "target_language": "ZH",
            "mtool_optimizer_enable": True,
        }
    )
    config = SimpleNamespace(
        source_language="JA",
        target_language="ZH",
        mtool_optimizer_enable=True,
        skip_duplicate_source_text_enable=True,
    )
    monkeypatch.setattr(
        "module.Data.Project.ProjectService.DatabaseGateway", lambda path: fake_db
    )
    monkeypatch.setattr(
        service,
        "build_project_draft_from_db",
        lambda db: {"items": [], "translation_extras": {}},
    )

    preview = service.build_open_alignment_preview(str(lg_path), config)

    assert preview["action"] == "prefiltered_items"
    assert preview["changed"] == {
        "source_language": False,
        "target_language": False,
        "mtool_optimizer_enable": False,
        "skip_duplicate_source_text_enable": True,
    }
