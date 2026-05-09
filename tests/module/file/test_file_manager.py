from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path

import pytest

from module.Config import Config
from module.Data.Core.Item import Item
from module.File.FileManager import FileManager


def test_read_from_path_returns_empty_when_input_path_is_none(config: Config) -> None:
    """没有输入路径时仍返回可用 Project 和空条目列表。"""
    project, items = FileManager(config).read_from_path(None)

    assert project.get_id() != ""
    assert items == []


# 目录读取只把 EPUB 文件分发给 Python FileManager。
def test_read_from_path_dispatches_only_epub(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """目录读取只把 EPUB 文件分发给 Python FileManager。"""
    del fs
    root_path = Path("/workspace/input")
    root_path.mkdir(parents=True, exist_ok=True)
    for name in ("a.txt", "b.epub", "c.json"):
        (root_path / name).write_bytes(b"dummy")

    calls: list[tuple[list[str], str]] = []

    class EpubReader:
        """记录目录读取分发参数的 EPUB 假处理器。"""

        def __init__(self, _: Config) -> None:
            """测试桩不需要配置，但签名保持与真实 EPUB 一致。"""
            pass

        def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
            """保存 FileManager 传入的路径列表，供断言只包含 EPUB。"""
            calls.append((list(abs_paths), input_path))
            return [
                Item.from_dict(
                    {
                        "src": "epub",
                        "file_type": Item.FileType.EPUB,
                        "file_path": "b.epub",
                    }
                )
            ]

    monkeypatch.setattr("module.File.FileManager.EPUB", EpubReader)

    _, items = FileManager(config).read_from_path(str(root_path))

    assert [item.get_src() for item in items] == ["epub"]
    assert len(calls) == 1
    assert calls[0][1] == str(root_path)
    assert calls[0][0][0].endswith("/b.epub")


# 单个 EPUB 文件读取时 base_path 应为其父目录。
def test_read_from_path_accepts_single_epub_file(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单个 EPUB 文件读取时 base_path 应为其父目录。"""
    del fs
    root_path = Path("/workspace/input")
    root_path.mkdir(parents=True, exist_ok=True)
    file_path = root_path / "a.epub"
    file_path.write_bytes(b"dummy")

    calls: list[tuple[list[str], str]] = []

    class EpubReader:
        """记录单文件读取分发参数的 EPUB 假处理器。"""

        def __init__(self, _: Config) -> None:
            """测试桩不需要配置，但签名保持与真实 EPUB 一致。"""
            pass

        def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
            """保存 FileManager 传入的路径列表，供断言 base_path。"""
            calls.append((list(abs_paths), input_path))
            return [Item.from_dict({"src": "epub"})]

    monkeypatch.setattr("module.File.FileManager.EPUB", EpubReader)

    _, items = FileManager(config).read_from_path(str(file_path))

    assert [item.get_src() for item in items] == ["epub"]
    assert calls[0][1] == str(root_path)
    assert calls[0][0][0].replace("\\", "/").endswith("/a.epub")


# parse_asset 只保留 EPUB 流式解析，其它扩展名返回空列表。
def test_parse_asset_dispatches_only_epub(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """parse_asset 只保留 EPUB 流式解析，其它扩展名返回空列表。"""

    class EpubReader:
        """验证 parse_asset 只把 EPUB 内容送入流式解析。"""

        def __init__(self, _: Config) -> None:
            """测试桩不需要配置，但签名保持与真实 EPUB 一致。"""
            pass

        def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
            """断言透传的 bytes 和相对路径没有被 FileManager 改写。"""
            assert content == b"bytes"
            assert rel_path == "a.epub"
            return [Item.from_dict({"src": "epub"})]

    monkeypatch.setattr("module.File.FileManager.EPUB", EpubReader)

    assert [
        item.get_src() for item in FileManager(config).parse_asset("a.epub", b"bytes")
    ] == ["epub"]
    assert FileManager(config).parse_asset("a.txt", b"bytes") == []
    assert FileManager(config).parse_asset("a.json", b"bytes") == []


# 写回阶段只调用 EPUB writer，并返回 DataManager 提供的输出路径。
def test_write_to_path_calls_only_epub_writer_and_returns_output(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """写回阶段只调用 EPUB writer，并返回 DataManager 提供的输出路径。"""
    del fs
    output_root = Path("/workspace/translated")
    called: list[str] = []

    class DummyDataManager:
        """提供最小导出路径上下文，隔离真实 DataManager 单例。"""

        def timestamp_suffix_context(self):
            """测试中不需要时间戳副作用，返回空上下文。"""
            return nullcontext()

        def get_translated_path(self) -> str:
            """返回固定输出路径，供 write_to_path 结果断言。"""
            return str(output_root)

    class EpubWriter:
        """验证写回阶段只调用 EPUB writer。"""

        def __init__(self, _: Config) -> None:
            """测试桩不需要配置，但签名保持与真实 EPUB 一致。"""
            pass

        def write_to_path(self, items: list[Item]) -> None:
            """保存调用标记并断言传入条目未被过滤。"""
            assert [item.get_src() for item in items] == ["x"]
            called.append("epub")

    monkeypatch.setattr(
        "module.File.FileManager.DataManager.get",
        lambda: DummyDataManager(),
    )
    monkeypatch.setattr("module.File.FileManager.EPUB", EpubWriter)

    output = FileManager(config).write_to_path([Item.from_dict({"src": "x"})])

    assert output == str(output_root)
    assert called == ["epub"]


# 目录遍历异常应被记录日志并返回空条目。
def test_read_from_path_logs_error_when_walk_raises(
    config: Config,
    fs,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """目录遍历异常应被记录日志并返回空条目。"""
    del fs
    root = Path("/workspace/input")
    root.mkdir(parents=True, exist_ok=True)

    class DummyLocalizer:
        """提供读取失败日志文案，避免依赖全局本地化状态。"""

        log_read_file_fail = "read failed"

    errors: list[tuple[str, Exception]] = []

    class DummyLogger:
        """捕获 FileManager 记录的异常日志。"""

        def error(self, msg: str, e: Exception) -> None:
            """保存日志消息和异常对象供断言。"""
            errors.append((msg, e))

    monkeypatch.setattr(
        "module.File.FileManager.Localizer.get", lambda: DummyLocalizer()
    )
    monkeypatch.setattr("module.File.FileManager.LogManager.get", lambda: DummyLogger())

    def boom(*args, **kwargs):
        """模拟 os.walk 抛错，覆盖读取异常日志路径。"""
        del args
        del kwargs
        raise RuntimeError("boom")

    monkeypatch.setattr("module.File.FileManager.os.walk", boom)

    _, items = FileManager(config).read_from_path(str(root))

    assert items == []
    assert errors and errors[0][0] == "read failed"


# 写入依赖获取失败应被记录日志并返回空输出路径。
def test_write_to_path_logs_error_when_data_manager_get_raises(
    config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """写入依赖获取失败应被记录日志并返回空输出路径。"""

    class DummyLocalizer:
        """提供写入失败日志文案，避免依赖全局本地化状态。"""

        log_write_file_fail = "write failed"

    errors: list[tuple[str, Exception]] = []

    class DummyLogger:
        """捕获 FileManager 记录的异常日志。"""

        def error(self, msg: str, e: Exception) -> None:
            """保存日志消息和异常对象供断言。"""
            errors.append((msg, e))

    monkeypatch.setattr(
        "module.File.FileManager.Localizer.get", lambda: DummyLocalizer()
    )
    monkeypatch.setattr("module.File.FileManager.LogManager.get", lambda: DummyLogger())

    def boom():
        """模拟 DataManager 单例不可用，覆盖写入异常日志路径。"""
        raise RuntimeError("boom")

    monkeypatch.setattr("module.File.FileManager.DataManager.get", boom)

    assert FileManager(config).write_to_path([]) == ""
    assert errors and errors[0][0] == "write failed"


def test_read_from_path_returns_empty_when_path_not_exists(config: Config) -> None:
    """不存在的输入路径不抛错，返回空条目。"""
    _, items = FileManager(config).read_from_path("/workspace/not-exists")

    assert items == []


def test_parse_asset_returns_empty_for_unknown_extension(config: Config) -> None:
    """未知扩展名不由 Python FileManager 解析。"""
    assert FileManager(config).parse_asset("a.bin", b"bytes") == []
