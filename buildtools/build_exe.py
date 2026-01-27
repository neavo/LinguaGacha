import importlib.util
import os
import shutil
import sys
from pathlib import Path

import PyInstaller.__main__

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


def stage_runtime_files(output_dir: Path) -> None:
    # Why: 运行时依赖 resource/ 与 version.txt，必须与可执行文件同目录，否则 .app/便携包会启动即崩溃。
    output_dir.mkdir(parents=True, exist_ok=True)

    shutil.copy2("./version.txt", output_dir / "version.txt")
    shutil.copytree("./resource", output_dir / "resource", dirs_exist_ok=True)


backup = patch_opencc_init()

# 公共配置
common_args = [
    "--collect-all=rich",
    "--collect-all=opencc_pyo3",
]

if is_macos:
    # macOS：创建 .app 应用包
    cmd = [
        "./app.py",
        "--name=LinguaGacha",
        "--icon=./resource/icon.icns",
        "--clean",
        "--onedir",  # macOS 应用为目录包格式
        "--windowed",  # 创建无控制台窗口的 .app 包
        "--noconfirm",
        "--distpath=./dist",
        "--osx-bundle-identifier=me.neavo.linguagacha",
    ] + common_args
elif is_linux:
    # Linux：创建用于 AppImage 的目录包
    cmd = [
        "./app.py",
        "--name=LinguaGacha",
        "--clean",
        "--onedir",
        "--noconfirm",
        "--distpath=./dist",
    ] + common_args
else:
    # Windows：创建单文件可执行程序
    cmd = [
        "./app.py",
        "--icon=./resource/icon.ico",
        "--clean",
        "--onefile",
        "--noconfirm",
        "--distpath=./dist/LinguaGacha",
    ] + common_args

# 从 requirements.txt 添加隐式依赖
if os.path.exists("./requirements.txt"):
    with open("./requirements.txt", "r", encoding="utf-8") as reader:
        for line in reader:
            line = line.strip()
            if line and "#" not in line:
                cmd.append("--hidden-import=" + line)

PyInstaller.__main__.run(cmd)

restore_opencc_init(backup)

if is_macos:
    stage_runtime_files(Path("./dist/LinguaGacha.app/Contents/MacOS"))
elif is_linux:
    stage_runtime_files(Path("./dist/LinguaGacha"))
else:
    stage_runtime_files(Path("./dist/LinguaGacha"))
