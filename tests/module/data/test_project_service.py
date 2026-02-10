from pathlib import Path
from types import SimpleNamespace

import pytest

from model.Item import Item
from module.Data.ProjectService import ProjectService


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
    monkeypatch.setattr("module.Data.ProjectService.LGDatabase", lambda path: fake_db)

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
    data_processing = "processing"
    engine_task_rule_filter = "rule {COUNT}"
    engine_task_language_filter = "lang {COUNT}"
    translator_mtool_optimizer_pre_log = "mtool {COUNT}"


class FakeDB:
    def __init__(self) -> None:
        self.assets: list[tuple[str, bytes, int]] = []
        self.items: list[dict] | None = None
        self.meta: dict[str, object] = {}

    def add_asset(self, rel_path: str, compressed: bytes, original_size: int) -> None:
        self.assets.append((rel_path, compressed, original_size))

    def set_items(self, items_dicts: list[dict]) -> None:
        self.items = items_dicts

    def set_meta(self, key: str, value: object) -> None:
        self.meta[key] = value


def test_create_ingests_assets_parses_items_and_writes_meta(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    monkeypatch.delenv("LINGUAGACHA_DATA_DIR", raising=False)
    monkeypatch.setenv("LINGUAGACHA_APP_DIR", "/workspace/app")

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
        "module.Data.ProjectService.LGDatabase.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr("module.Data.ProjectService.LogManager.get", lambda: logger)
    monkeypatch.setattr(
        "module.Data.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    compressed_inputs: list[bytes] = []

    def fake_compress(data: bytes) -> bytes:
        compressed_inputs.append(data)
        return b"z" + data

    monkeypatch.setattr("module.Data.ProjectService.ZstdCodec.compress", fake_compress)

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

    monkeypatch.setattr("module.Data.ProjectService.FileManager", FakeFileManager)

    prefilter_calls: list[dict[str, object]] = []

    def fake_apply(**kwargs):
        prefilter_calls.append(kwargs)
        progress_cb = kwargs.get("progress_cb")
        assert callable(progress_cb)
        progress_cb(1, 1)
        return SimpleNamespace(
            stats=SimpleNamespace(rule_skipped=0, language_skipped=0, mtool_skipped=0),
            prefilter_config={"demo": True},
        )

    monkeypatch.setattr("module.Data.ProjectService.ProjectPrefilter.apply", fake_apply)

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

    assert compressed_inputs == [b"hello"]
    assert fake_db.assets == [("a.txt", b"zhello", 5)]
    assert fake_db.items is not None
    assert fake_db.meta["prefilter_config"] == {"demo": True}
    assert fake_db.meta["source_language"] != ""
    assert fake_db.meta["target_language"] != ""
    extras = fake_db.meta["translation_extras"]
    assert isinstance(extras, dict)
    assert extras["total_line"] == 0
    assert prefilter_calls != []
    assert progress != []


def test_create_skips_read_failures_and_continues(
    fs, monkeypatch: pytest.MonkeyPatch
) -> None:
    del fs
    monkeypatch.setenv("LINGUAGACHA_APP_DIR", "/workspace/app")

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
        "module.Data.ProjectService.LGDatabase.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr("module.Data.ProjectService.LogManager.get", lambda: logger)
    monkeypatch.setattr(
        "module.Data.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )
    monkeypatch.setattr(
        "module.Data.ProjectService.ProjectPrefilter.apply", lambda **kwargs: None
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            return []

    monkeypatch.setattr("module.Data.ProjectService.FileManager", FakeFileManager)
    monkeypatch.setattr("module.Data.ProjectService.ZstdCodec.compress", lambda b: b"z")

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
    monkeypatch.setenv("LINGUAGACHA_APP_DIR", "/workspace/app")

    service = ProjectService()
    src_dir = Path("/workspace/project_service/src")
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "a.txt").write_bytes(b"hello")

    out_path = Path("/workspace/project_service/out/demo.lg")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fake_db = FakeDB()
    logger = DummyLogger()

    monkeypatch.setattr(
        "module.Data.ProjectService.LGDatabase.create",
        lambda output_path, project_name: fake_db,
    )
    monkeypatch.setattr("module.Data.ProjectService.LogManager.get", lambda: logger)
    monkeypatch.setattr(
        "module.Data.ProjectService.Localizer.get", lambda: DummyLocalizer()
    )

    class FakeFileManager:
        def __init__(self, config) -> None:
            del config

        def parse_asset(self, rel_path: str, original_data: bytes) -> list[Item]:
            del rel_path
            del original_data
            raise ValueError("parse failed")

    monkeypatch.setattr("module.Data.ProjectService.FileManager", FakeFileManager)
    monkeypatch.setattr("module.Data.ProjectService.ZstdCodec.compress", lambda b: b"z")

    service.create(source_path=str(src_dir), output_path=str(out_path))

    assert fake_db.assets != []
    assert fake_db.items is None
    assert any("Failed to parse asset" in msg for msg in logger.errors)
