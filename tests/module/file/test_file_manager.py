from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path

import pytest

from model.Item import Item
from module.Config import Config
from module.File.FileManager import FileManager


def test_read_from_path_returns_empty_when_input_path_is_none(config: Config) -> None:
    project, items = FileManager(config).read_from_path(None)

    assert project.get_id() != ""
    assert items == []


def test_read_from_path_dispatches_all_supported_extensions(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    root_path = Path("/workspace/input")
    root_path.mkdir(parents=True, exist_ok=True)
    files = [
        "a.MD",
        "b.txt",
        "c.ass",
        "d.srt",
        "e.epub",
        "f.xlsx",
        "g.rpy",
        "h.trans",
        "i.json",
    ]
    for name in files:
        (root_path / name).write_bytes(b"dummy")

    calls: dict[str, tuple[list[str], str]] = {}

    def build_reader(name: str):
        class Reader:
            def __init__(self, _: Config) -> None:
                pass

            def read_from_path(
                self, abs_paths: list[str], input_path: str
            ) -> list[Item]:
                calls[name] = (list(abs_paths), input_path)
                if not abs_paths:
                    return []
                return [
                    Item.from_dict(
                        {
                            "src": name,
                            "dst": name,
                            "file_type": Item.FileType.TXT,
                            "file_path": f"{name}.txt",
                        }
                    )
                ]

        return Reader

    monkeypatch.setattr("module.File.FileManager.MD", build_reader("md"))
    monkeypatch.setattr("module.File.FileManager.TXT", build_reader("txt"))
    monkeypatch.setattr("module.File.FileManager.ASS", build_reader("ass"))
    monkeypatch.setattr("module.File.FileManager.SRT", build_reader("srt"))
    monkeypatch.setattr("module.File.FileManager.EPUB", build_reader("epub"))
    monkeypatch.setattr("module.File.FileManager.XLSX", build_reader("xlsx"))
    monkeypatch.setattr("module.File.FileManager.WOLFXLSX", build_reader("wolfxlsx"))
    monkeypatch.setattr("module.File.FileManager.RenPy", build_reader("renpy"))
    monkeypatch.setattr("module.File.FileManager.TRANS", build_reader("trans"))
    monkeypatch.setattr("module.File.FileManager.KVJSON", build_reader("kvjson"))
    monkeypatch.setattr(
        "module.File.FileManager.MESSAGEJSON", build_reader("messagejson")
    )

    _, items = FileManager(config).read_from_path(str(root_path))

    assert len(items) == 11
    assert calls["md"][1] == str(root_path)
    assert calls["md"][0][0].endswith("/a.MD")
    assert calls["txt"][0][0].endswith("/b.txt")
    assert calls["ass"][0][0].endswith("/c.ass")
    assert calls["srt"][0][0].endswith("/d.srt")
    assert calls["epub"][0][0].endswith("/e.epub")
    assert calls["xlsx"][0][0].endswith("/f.xlsx")
    assert calls["wolfxlsx"][0][0].endswith("/f.xlsx")
    assert calls["renpy"][0][0].endswith("/g.rpy")
    assert calls["trans"][0][0].endswith("/h.trans")
    assert calls["kvjson"][0][0].endswith("/i.json")
    assert calls["messagejson"][0][0].endswith("/i.json")


def test_read_from_path_accepts_single_file_path(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    root_path = Path("/workspace/input")
    root_path.mkdir(parents=True, exist_ok=True)
    file_path = root_path / "a.MD"
    file_path.write_bytes(b"dummy")

    calls: dict[str, tuple[list[str], str]] = {}

    def build_reader(name: str):
        class Reader:
            def __init__(self, _: Config) -> None:
                pass

            def read_from_path(
                self, abs_paths: list[str], input_path: str
            ) -> list[Item]:
                calls[name] = (list(abs_paths), input_path)
                if not abs_paths:
                    return []
                return [Item.from_dict({"src": name})]

        return Reader

    monkeypatch.setattr("module.File.FileManager.MD", build_reader("md"))
    monkeypatch.setattr("module.File.FileManager.TXT", build_reader("txt"))
    monkeypatch.setattr("module.File.FileManager.ASS", build_reader("ass"))
    monkeypatch.setattr("module.File.FileManager.SRT", build_reader("srt"))
    monkeypatch.setattr("module.File.FileManager.EPUB", build_reader("epub"))
    monkeypatch.setattr("module.File.FileManager.XLSX", build_reader("xlsx"))
    monkeypatch.setattr("module.File.FileManager.WOLFXLSX", build_reader("wolfxlsx"))
    monkeypatch.setattr("module.File.FileManager.RenPy", build_reader("renpy"))
    monkeypatch.setattr("module.File.FileManager.TRANS", build_reader("trans"))
    monkeypatch.setattr("module.File.FileManager.KVJSON", build_reader("kvjson"))
    monkeypatch.setattr(
        "module.File.FileManager.MESSAGEJSON", build_reader("messagejson")
    )

    _, items = FileManager(config).read_from_path(str(file_path))

    assert [i.get_src() for i in items] == ["md"]
    assert calls["md"][1] == str(root_path)
    assert calls["md"][0][0].replace("\\", "/").endswith("/a.MD")


def test_parse_asset_falls_back_between_wolf_xlsx_and_xlsx(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: dict[str, int] = {"wolf": 0, "xlsx": 0}

    class WolfEmpty:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["wolf"] += 1
            return []

    class XlsxReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["xlsx"] += 1
            return [Item.from_dict({"src": "xlsx"})]

    monkeypatch.setattr("module.File.FileManager.WOLFXLSX", WolfEmpty)
    monkeypatch.setattr("module.File.FileManager.XLSX", XlsxReader)

    items = FileManager(config).parse_asset("a.xlsx", b"bytes")

    assert [item.get_src() for item in items] == ["xlsx"]
    assert called == {"wolf": 1, "xlsx": 1}


def test_parse_asset_uses_wolf_xlsx_when_it_returns_items(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: dict[str, int] = {"wolf": 0, "xlsx": 0}

    class WolfReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["wolf"] += 1
            return [Item.from_dict({"src": "wolf"})]

    class XlsxReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["xlsx"] += 1
            return [Item.from_dict({"src": "xlsx"})]

    monkeypatch.setattr("module.File.FileManager.WOLFXLSX", WolfReader)
    monkeypatch.setattr("module.File.FileManager.XLSX", XlsxReader)

    items = FileManager(config).parse_asset("a.xlsx", b"bytes")

    assert [item.get_src() for item in items] == ["wolf"]
    assert called == {"wolf": 1, "xlsx": 0}


def test_parse_asset_falls_back_between_kv_and_message_json(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: dict[str, int] = {"kv": 0, "message": 0}

    class KvEmpty:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["kv"] += 1
            return []

    class MessageReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["message"] += 1
            return [Item.from_dict({"src": "message"})]

    monkeypatch.setattr("module.File.FileManager.KVJSON", KvEmpty)
    monkeypatch.setattr("module.File.FileManager.MESSAGEJSON", MessageReader)

    items = FileManager(config).parse_asset("a.json", b"bytes")

    assert [item.get_src() for item in items] == ["message"]
    assert called == {"kv": 1, "message": 1}


def test_parse_asset_uses_kvjson_when_it_returns_items(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: dict[str, int] = {"kv": 0, "message": 0}

    class KvReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["kv"] += 1
            return [Item.from_dict({"src": "kv"})]

    class MessageReader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            called["message"] += 1
            return [Item.from_dict({"src": "message"})]

    monkeypatch.setattr("module.File.FileManager.KVJSON", KvReader)
    monkeypatch.setattr("module.File.FileManager.MESSAGEJSON", MessageReader)

    items = FileManager(config).parse_asset("a.json", b"bytes")

    assert [item.get_src() for item in items] == ["kv"]
    assert called == {"kv": 1, "message": 0}


@pytest.mark.parametrize(
    "rel_path,expected",
    [
        ("a.md", "md"),
        ("a.txt", "txt"),
        ("a.ass", "ass"),
        ("a.srt", "srt"),
        ("a.epub", "epub"),
        ("a.rpy", "renpy"),
        ("a.trans", "trans"),
    ],
)
def test_parse_asset_dispatches_simple_extensions(
    rel_path: str,
    expected: str,
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Reader:
        def __init__(self, _: Config) -> None:
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            del content
            del rel_path
            return [Item.from_dict({"src": expected})]

    monkeypatch.setattr("module.File.FileManager.MD", Reader)
    monkeypatch.setattr("module.File.FileManager.TXT", Reader)
    monkeypatch.setattr("module.File.FileManager.ASS", Reader)
    monkeypatch.setattr("module.File.FileManager.SRT", Reader)
    monkeypatch.setattr("module.File.FileManager.EPUB", Reader)
    monkeypatch.setattr("module.File.FileManager.RenPy", Reader)
    monkeypatch.setattr("module.File.FileManager.TRANS", Reader)

    items = FileManager(config).parse_asset(rel_path, b"bytes")

    assert [item.get_src() for item in items] == [expected]


def test_read_from_assets_combines_results(config: Config) -> None:
    manager = FileManager(config)

    def fake_parse_asset(rel_path: str, content: bytes) -> list[Item]:
        del content
        return [Item.from_dict({"src": rel_path})]

    manager.parse_asset = fake_parse_asset
    items = manager.read_from_assets({"a.txt": b"1", "b.txt": b"2"})

    assert {item.get_src() for item in items} == {"a.txt", "b.txt"}


def test_write_to_path_calls_all_writers_and_returns_output(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    called: dict[str, int] = {}
    output_root = Path("/workspace/translated")

    class DummyDataManager:
        def __init__(self, out_path: Path) -> None:
            self.out_path = out_path

        def timestamp_suffix_context(self):
            return nullcontext()

        def get_translated_path(self) -> str:
            return str(self.out_path)

    class Writer:
        def __init__(self, _: Config, name: str) -> None:
            self.name = name

        def write_to_path(self, items: list[Item]) -> None:
            del items
            called[self.name] = called.get(self.name, 0) + 1

    def build_writer(name: str):
        class ConcreteWriter(Writer):
            def __init__(self, cfg: Config) -> None:
                super().__init__(cfg, name)

        return ConcreteWriter

    monkeypatch.setattr(
        "module.File.FileManager.DataManager.get",
        lambda: DummyDataManager(output_root),
    )
    monkeypatch.setattr("module.File.FileManager.MD", build_writer("md"))
    monkeypatch.setattr("module.File.FileManager.TXT", build_writer("txt"))
    monkeypatch.setattr("module.File.FileManager.ASS", build_writer("ass"))
    monkeypatch.setattr("module.File.FileManager.SRT", build_writer("srt"))
    monkeypatch.setattr("module.File.FileManager.EPUB", build_writer("epub"))
    monkeypatch.setattr("module.File.FileManager.XLSX", build_writer("xlsx"))
    monkeypatch.setattr("module.File.FileManager.WOLFXLSX", build_writer("wolfxlsx"))
    monkeypatch.setattr("module.File.FileManager.RenPy", build_writer("renpy"))
    monkeypatch.setattr("module.File.FileManager.TRANS", build_writer("trans"))
    monkeypatch.setattr("module.File.FileManager.KVJSON", build_writer("kvjson"))
    monkeypatch.setattr(
        "module.File.FileManager.MESSAGEJSON", build_writer("messagejson")
    )

    output = FileManager(config).write_to_path([Item.from_dict({"src": "x"})])

    assert output == str(output_root)
    assert called == {
        "md": 1,
        "txt": 1,
        "ass": 1,
        "srt": 1,
        "epub": 1,
        "xlsx": 1,
        "wolfxlsx": 1,
        "renpy": 1,
        "trans": 1,
        "kvjson": 1,
        "messagejson": 1,
    }


def test_read_from_path_logs_error_when_walk_raises(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del fs
    root = Path("/workspace/input")
    root.mkdir(parents=True, exist_ok=True)

    class DummyLocalizer:
        log_read_file_fail = "read failed"

    errors: list[tuple[str, Exception]] = []

    class DummyLogger:
        def error(self, msg: str, e: Exception) -> None:
            errors.append((msg, e))

    monkeypatch.setattr(
        "module.File.FileManager.Localizer.get", lambda: DummyLocalizer()
    )
    monkeypatch.setattr("module.File.FileManager.LogManager.get", lambda: DummyLogger())

    def boom(*args, **kwargs):
        del args
        del kwargs
        raise RuntimeError("boom")

    monkeypatch.setattr("module.File.FileManager.os.walk", boom)

    _, items = FileManager(config).read_from_path(str(root))

    assert items == []
    assert errors and errors[0][0] == "read failed"


def test_write_to_path_logs_error_when_data_manager_get_raises(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyLocalizer:
        log_write_file_fail = "write failed"

    errors: list[tuple[str, Exception]] = []

    class DummyLogger:
        def error(self, msg: str, e: Exception) -> None:
            errors.append((msg, e))

    monkeypatch.setattr(
        "module.File.FileManager.Localizer.get", lambda: DummyLocalizer()
    )
    monkeypatch.setattr("module.File.FileManager.LogManager.get", lambda: DummyLogger())

    def boom():
        raise RuntimeError("boom")

    monkeypatch.setattr("module.File.FileManager.DataManager.get", boom)

    assert FileManager(config).write_to_path([]) == ""
    assert errors and errors[0][0] == "write failed"
