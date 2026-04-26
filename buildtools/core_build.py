import sys
from pathlib import Path

import PyInstaller.__main__

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def build_command() -> list[str]:
    """统一生成 Python Core helper 的打包参数，避免和 Electron 应用命名混用。"""

    return [
        "./app.py",
        "--name=core",
        "--clean",
        "--onedir",
        "--noconfirm",
        "--distpath=./dist",
    ]


def main() -> int:
    PyInstaller.__main__.run(build_command())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
