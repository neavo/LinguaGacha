import importlib.util
import os
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

WINDOWS_BUILD_ICON_PATH: str = "./resource/icon.ico"
MACOS_BUILD_ICON_PATH: str = "./resource/icon.icns"
WINDOWS_EXECUTABLE_NAME: str = "app"
DIST_DIR_NAME: str = "LinguaGacha"
BUNDLE_IDENTIFIER: str = "me.neavo.linguagacha"

# 检测平台
is_macos = sys.platform == "darwin"
is_linux = sys.platform == "linux"
is_windows = sys.platform == "win32" or os.name == "nt"


def patch_opencc_init() -> tuple[Path, str] | None:
    """打包前临时修补 opencc_pyo3，避免缺少 pdfium 时导入失败。"""

    spec = importlib.util.find_spec("opencc_pyo3")
    if spec is None or spec.origin is None:
        return None
    init_path = Path(spec.origin)
    if not init_path.exists():
        return None
    original = init_path.read_text(encoding="utf-8")
    old_import = "from .pdfium_helper import extract_pdf_pages_with_callback_pdfium"
    new_import = "extract_pdf_pages_with_callback_pdfium = None  # pdfium not needed"
    if old_import in original:
        init_path.write_text(original.replace(old_import, new_import), encoding="utf-8")
        return (init_path, original)
    return None


def restore_opencc_init(backup: tuple[Path, str] | None) -> None:
    """打包结束后恢复 opencc_pyo3 原始文件，避免污染环境。"""

    if backup:
        backup[0].write_text(backup[1], encoding="utf-8")


def build_command() -> list[str]:
    """统一生成 LinguaGacha 的打包参数，避免保留未使用的多品牌分支。"""

    from base.Base import Base

    common_args = [
        "--collect-all=rich",
        "--collect-all=opencc_pyo3",
    ]

    if is_macos:
        cmd = [
            "./app.py",
            f"--name={Base.APP_NAME}",
            f"--icon={MACOS_BUILD_ICON_PATH}",
            "--clean",
            "--onedir",
            "--windowed",
            "--noconfirm",
            "--distpath=./dist",
            f"--osx-bundle-identifier={BUNDLE_IDENTIFIER}",
        ] + common_args
    elif is_linux:
        cmd = [
            "./app.py",
            f"--name={Base.APP_NAME}",
            "--clean",
            "--onedir",
            "--noconfirm",
            "--distpath=./dist",
        ] + common_args
    else:
        cmd = [
            "./app.py",
            f"--name={WINDOWS_EXECUTABLE_NAME}",
            f"--icon={WINDOWS_BUILD_ICON_PATH}",
            "--clean",
            "--onefile",
            "--noconfirm",
            f"--distpath=./dist/{DIST_DIR_NAME}",
        ] + common_args

    return cmd


def main() -> int:
    backup = patch_opencc_init()
    try:
        PyInstaller.__main__.run(build_command())
    finally:
        restore_opencc_init(backup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
