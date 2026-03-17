import argparse
import importlib.util
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


# Patch opencc_pyo3 before PyInstaller packages it (must modify source before build)
# The library unconditionally imports pdfium_helper which fails if pdfium is missing
def patch_opencc_init() -> tuple[Path, str] | None:
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
    if backup:
        backup[0].write_text(backup[1], encoding="utf-8")


def build_command(brand_id: str) -> list[str]:
    """构建参数统一从品牌档案读取，避免脚本里散落品牌字面量。"""

    from base.BaseBrand import BaseBrand

    brand = BaseBrand.get(brand_id)
    build_names = brand.build_names

    common_args = [
        "--collect-all=rich",
        "--collect-all=opencc_pyo3",
        f"--name={build_names.app_name}",
    ]

    if is_macos:
        cmd = [
            "./app.py",
            f"--icon={brand.icon_paths.macos_icon_path}",
            "--clean",
            "--onedir",
            "--windowed",
            "--noconfirm",
            "--distpath=./dist",
            f"--osx-bundle-identifier={build_names.bundle_identifier}",
        ] + common_args
    elif is_linux:
        cmd = [
            "./app.py",
            "--clean",
            "--onedir",
            "--noconfirm",
            "--distpath=./dist",
        ] + common_args
    else:
        cmd = [
            "./app.py",
            f"--icon={brand.icon_paths.windows_icon_path}",
            "--clean",
            "--onefile",
            "--noconfirm",
            f"--distpath=./dist/{build_names.dist_dir_name}",
        ] + common_args

    if os.path.exists("./requirements.txt"):
        with open("./requirements.txt", "r", encoding="utf-8") as reader:
            for line in reader:
                line = line.strip()
                if line and "#" not in line:
                    cmd.append("--hidden-import=" + line)

    return cmd


def main() -> int:
    from base.BaseBrand import BaseBrand

    parser = argparse.ArgumentParser()
    parser.add_argument("--brand", type=str, default="lg", choices=["lg", "kg"])
    args = parser.parse_args()

    os.environ[BaseBrand.BRAND_ENV_KEY] = args.brand
    backup = patch_opencc_init()
    try:
        PyInstaller.__main__.run(build_command(args.brand))
    finally:
        restore_opencc_init(backup)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
