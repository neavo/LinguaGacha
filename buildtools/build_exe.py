import os
import sys

import PyInstaller.__main__

# Detect platform
is_macos = sys.platform == "darwin"
is_linux = sys.platform == "linux"
is_windows = sys.platform == "win32" or os.name == "nt"

if is_macos:
    # macOS: Create .app bundle
    cmd = [
        "./app.py",
        "--name=LinguaGacha",
        "--icon=./resource/icon.icns",
        "--clean",
        "--onedir",  # macOS apps are directory bundles
        "--windowed",  # Creates .app bundle without console window
        "--noconfirm",
        "--distpath=./dist",
        "--osx-bundle-identifier=me.neavo.linguagacha",
    ]
elif is_linux:
    # Linux: Create directory bundle for AppImage
    cmd = [
        "./app.py",
        "--name=LinguaGacha",
        "--clean",
        "--onedir",
        "--noconfirm",
        "--distpath=./dist",
    ]
else:
    # Windows: Create single executable
    cmd = [
        "./app.py",
        "--icon=./resource/icon.ico",
        "--clean",
        "--onefile",
        "--noconfirm",
        "--distpath=./dist/LinguaGacha",
    ]

# Add hidden imports from requirements.txt
if os.path.exists("./requirements.txt"):
    with open("./requirements.txt", "r", encoding="utf-8") as reader:
        for line in reader:
            line = line.strip()
            if line and "#" not in line:
                cmd.append("--hidden-import=" + line)

PyInstaller.__main__.run(cmd)
