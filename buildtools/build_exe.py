import os
import sys

import PyInstaller.__main__

# 检测平台
is_macos = sys.platform == "darwin"
is_linux = sys.platform == "linux"
is_windows = sys.platform == "win32" or os.name == "nt"

# 公共配置
common_args = [
    "--collect-all=rich",
]

# 添加资源文件
sep = ";" if is_windows else ":"
common_args.append(f"--add-data=version.txt{sep}.")
common_args.append(f"--add-data=resource{sep}resource")

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
        "--name=LinguaGacha",
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
