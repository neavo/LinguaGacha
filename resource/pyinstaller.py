import os
import PyInstaller.__main__

cmd = [
    "./app.py",
    "--clean", # Clean PyInstaller cache and remove temporary files before building
    # "--onedir", # Create a one-folder bundle containing an executable (default)
    "--onefile", # Create a one-file bundled executable
    "--noconfirm", # Replace output directory (default: SPECPATH/dist/SPECNAME) without asking for confirmation
    "--distpath=./dist/LinguaGacha", # Where to put the bundled app (default: ./dist)
]

if os.path.exists("./requirements.txt"):
    with open("./requirements.txt", "r", encoding = "utf-8") as reader:
        for line in reader:
            if "#" not in line:
                cmd.append("--hidden-import=" + line.strip())

    PyInstaller.__main__.run(cmd)