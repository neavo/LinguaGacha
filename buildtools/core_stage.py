import os
import shutil
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_CORE_DIR = ROOT_DIR / "dist" / "core"
CORE_EXECUTABLE_NAME = "core.exe" if os.name == "nt" else "core"
STAGED_CORE_EXECUTABLE = ROOT_DIR / CORE_EXECUTABLE_NAME
STAGED_INTERNAL_DIR = ROOT_DIR / "_internal"


def remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def copy_core_executable() -> None:
    source_executable = DIST_CORE_DIR / CORE_EXECUTABLE_NAME
    if not source_executable.is_file():
        raise FileNotFoundError(f"缺少 PyInstaller Core 入口：{source_executable}")

    remove_path(STAGED_CORE_EXECUTABLE)
    shutil.copy2(source_executable, STAGED_CORE_EXECUTABLE)


def copy_internal_directory() -> None:
    source_internal_dir = DIST_CORE_DIR / "_internal"
    if not source_internal_dir.is_dir():
        raise FileNotFoundError(f"缺少 PyInstaller 依赖目录：{source_internal_dir}")

    remove_path(STAGED_INTERNAL_DIR)
    shutil.copytree(source_internal_dir, STAGED_INTERNAL_DIR)


def main() -> int:
    copy_core_executable()
    copy_internal_directory()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
