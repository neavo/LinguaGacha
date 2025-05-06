import os
import PyInstaller.__main__

cmd = [
    "./app.py",
    "--icon=./resource/icon.ico",
    "--clean", # Clean PyInstaller cache and remove temporary files before building
    "--onedir", # Create a one-folder bundle containing an executable (default)
    # "--onefile", # Create a one-file bundled executable
    "--noconfirm", # Replace output directory (default: SPECPATH/dist/SPECNAME) without asking for confirmation
    "--distpath=./dist", # Where to put the bundled app (default: ./dist)
    "--name=LinguaGacha"
]

if os.path.exists("./requirements.txt"):
    with open("./requirements.txt", "r", encoding = "utf-8") as reader:
        for line in reader:
            if "#" not in line:
                cmd.append("--hidden-import=" + line.strip())

    # 执行打包
    PyInstaller.__main__.run(cmd)

    # 更名
    if os.path.isfile("./dist/LinguaGacha/LinguaGacha.exe"):
        os.rename("./dist/LinguaGacha/LinguaGacha.exe", "./dist/LinguaGacha/app.exe")