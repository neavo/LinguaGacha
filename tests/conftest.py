from __future__ import annotations

import importlib
import linecache
import os
import sys
from pathlib import Path

import pytest

from base.BasePath import BasePath
from base.LogManager import LogManager


REPO_ROOT = Path(__file__).resolve().parent.parent
LINECACHE_PRIME_DIRS: tuple[str, ...] = ("tests", "base", "module", "model")


def prime_linecache_for_path(file_path: Path) -> None:
    """先把源码行缓存进 linecache，避免 pyfakefs 在 traceback 阶段递归读文件。"""
    normalized_path = str(file_path.resolve())
    if not normalized_path.endswith(".py"):
        return
    if not file_path.is_file():
        return

    linecache.getlines(normalized_path)


def prime_linecache_for_loaded_modules() -> None:
    """已导入模块的源码也要预热，避免 pyfakefs 追栈时第一次读标准库/三方源码。"""
    for loaded_module in tuple(sys.modules.values()):
        module_file = getattr(loaded_module, "__file__", None)
        if not isinstance(module_file, str):
            continue
        if not module_file.endswith(".py"):
            continue

        prime_linecache_for_path(Path(module_file))


def prime_linecache_for_repo_sources() -> None:
    """仓库源码与测试文件统一预热，避免不同测试文件第一次触发 fs 操作时失稳。"""
    for directory_name in LINECACHE_PRIME_DIRS:
        source_dir = REPO_ROOT / directory_name
        if not source_dir.is_dir():
            continue

        for python_file in source_dir.rglob("*.py"):
            prime_linecache_for_path(python_file)


def import_rich_windows_support() -> None:
    """Windows 下预先导入 rich 的控制台特性模块，避免在 fs 激活后再走 open_code。"""
    if os.name != "nt":
        return

    importlib.import_module("rich._windows")


def shutdown_log_manager_singleton() -> None:
    """每个测试前后都清理日志单例，避免缓存路径和线程把下个用例带脏。"""
    instance = getattr(LogManager, "__instance__", None)
    if instance is None:
        return

    try:
        instance.shutdown()
    except Exception:
        # 测试收尾以恢复环境为主，日志线程已经异常时不该反过来打断用例清理。
        pass

    setattr(LogManager, "__instance__", None)


@pytest.fixture(autouse=True)
def stabilize_runtime_state(request: pytest.FixtureRequest) -> None:
    """统一重置路径与日志状态，避免 pyfakefs 用例之间通过单例和目录缓存串味。"""
    BasePath.reset_for_test()
    shutdown_log_manager_singleton()

    if "fs" in request.fixturenames:
        fs = request.getfixturevalue("fs")
        fs.create_dir(BasePath.get_log_dir())

    yield

    shutdown_log_manager_singleton()
    BasePath.reset_for_test()


prime_linecache_for_loaded_modules()
prime_linecache_for_repo_sources()
import_rich_windows_support()
