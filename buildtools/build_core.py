import os
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# 检测平台
is_macos = sys.platform == "darwin"
is_linux = sys.platform == "linux"
is_windows = sys.platform == "win32" or os.name == "nt"


def build_command() -> list[str]:
    """统一生成 LinguaGacha 的打包参数，避免保留未使用的多品牌分支。"""

    common_args = [
        "--collect-all=rich",
    ]

    if is_macos:
        cmd = [
            "./app.py",
            "--name=LinguaGacha",
            "--osx-bundle-identifier=me.neavo.linguagacha",
            "--clean",
            "--onedir",
            "--windowed",
            "--noconfirm",
            "--distpath=./dist",
        ] + common_args
    elif is_linux:
        cmd = [
            "./app.py",
            "--name=LinguaGacha",
            "--clean",
            "--onedir",
            "--noconfirm",
            "--distpath=./dist",
        ] + common_args
    else:
        cmd = [
            "./app.py",
            "--name=core",
            "--clean",
            "--onedir",
            "--noconfirm",
            "--distpath=./dist",
        ] + common_args

    return cmd


def main() -> int:
    PyInstaller.__main__.run(build_command())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
