import os
import time
import signal
import shutil
import zipfile
import threading
from enum import StrEnum

import httpx
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtCore import QUrl

from base.Base import Base
from module.Localizer.Localizer import Localizer

class VersionManager(Base):

    class Status(StrEnum):

        NONE = "NONE"
        NEW_VERSION = "NEW_VERSION"
        UPDATING = "UPDATING"
        DOWNLOADED = "DOWNLOADED"

    # 版本号
    VERSION: str = "v0.0.0"

    # 更新状态
    STATUS: Status = Status.NONE

    # 更新时的临时文件
    TEMP_FILE_PATH: str = "./resource/update.temp"

    # URL 地址
    API_URL: str = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest"
    RELEASE_URL: str = "https://github.com/neavo/LinguaGacha/releases/latest"

    # 类变量
    IN_EXTRACTING = False
    LOCK = threading.Lock()

    def __init__(self, version: str) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APP_UPDATE_CHECK, self.app_update_check)
        self.subscribe(Base.Event.APP_UPDATE_EXTRACT, self.app_update_extract)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD, self.app_update_download)

        # 初始化
        VersionManager.VERSION = version

    # 检查更新
    def app_update_check(self, event: str, data: dict) -> None:
        threading.Thread(
            target = self.app_update_check_task,
            args = (event, data),
        ).start()

    # 检查更新 - 下载
    def app_update_download(self, event: str, data: dict) -> None:
        threading.Thread(
            target = self.app_update_download_task,
            args = (event, data),
        ).start()

    # 检查更新 - 解压
    def app_update_extract(self, event: str, data: dict) -> None:
        with VersionManager.LOCK:
            if VersionManager.IN_EXTRACTING == False:
                threading.Thread(
                    target = self.app_update_extract_task,
                    args = (event, data),
                ).start()

    # 检查更新
    def app_update_check_task(self, event: str, data: dict) -> None:
        try:
            # 获取更新信息
            response = httpx.get(VersionManager.API_URL, timeout = 60)
            response.raise_for_status()

            # 发送完成事件
            self.emit(Base.Event.APP_UPDATE_CHECK_DONE, {
                "result": response.json()
            })
        except Exception:
            pass

    # 检查更新 - 下载
    def app_update_download_task(self, event: str, data: dict) -> None:
        try:
            # 获取更新信息
            response = httpx.get(VersionManager.API_URL, timeout = 60)
            response.raise_for_status()

            # 开始下载
            browser_download_url = response.json().get("assets", [])[0].get("browser_download_url", "")
            with httpx.stream("GET", browser_download_url, timeout = 60, follow_redirects = True) as response:
                response.raise_for_status()

                # 获取文件总大小
                total_size: int = int(response.headers.get("Content-Length", 0))
                downloaded_size: int = 0

                # 有效性检查
                if total_size == 0:
                    raise Exception("Content-Length is 0 ...")

                # 写入文件并更新进度
                os.remove(VersionManager.TEMP_FILE_PATH) if os.path.isfile(VersionManager.TEMP_FILE_PATH) else None
                os.makedirs(os.path.dirname(VersionManager.TEMP_FILE_PATH), exist_ok = True)
                with open(VersionManager.TEMP_FILE_PATH, "wb") as writer:
                    for chunk in response.iter_bytes(chunk_size = 1024 * 1024):
                        if chunk is not None:
                            writer.write(chunk)
                            downloaded_size = downloaded_size + len(chunk)

                            self.emit(Base.Event.APP_UPDATE_DOWNLOAD_UPDATE, {
                                "error": None,
                                "total_size": total_size,
                                "downloaded_size": downloaded_size,
                            })
        except Exception as e:
            self.emit(Base.Event.APP_UPDATE_DOWNLOAD_UPDATE, {
                "error": e,
                "total_size": 0,
                "downloaded_size": 0,
            })

    # 检查更新 - 解压
    def app_update_extract_task(self, event: str, data: dict) -> None:
        # 更新状态
        with VersionManager.LOCK:
            VersionManager.IN_EXTRACTING = True

        # 删除临时文件
        try:
            os.remove("./app.exe.bak")
        except Exception:
            pass
        try:
            os.remove("./version.txt.bak")
        except Exception:
            pass

        # 备份文件
        try:
            os.rename("./app.exe", "./app.exe.bak")
        except Exception:
            pass
        try:
            os.rename("./version.txt", "./version.txt.bak")
        except Exception:
            pass

        # 开始更新
        error = None
        try:
            with zipfile.ZipFile(VersionManager.TEMP_FILE_PATH) as zip_file:
                zip_file.extractall("./")

            # 先复制再删除的方式实现覆盖同名文件
            shutil.copytree("./LinguaGacha/", "./", dirs_exist_ok = True)
            shutil.rmtree("./LinguaGacha/", ignore_errors = True)
        except Exception as e:
            error = e
            self.error("", e)

        # 更新失败则还原备份文件
        if error is not None:
            try:
                os.remove("./app.exe")
            except Exception:
                pass
            try:
                os.remove("./version.txt")
            except Exception:
                pass
            try:
                os.rename("./app.exe.bak", "./app.exe")
            except Exception:
                pass
            try:
                os.rename("./version.txt.bak", "./version.txt")
            except Exception:
                pass

        # 删除临时文件
        try:
            os.remove(VersionManager.TEMP_FILE_PATH)
        except Exception:
            pass

        # 显示提示
        self.emit(Base.Event.APP_TOAST_SHOW,{
            "type": Base.ToastType.SUCCESS,
            "message": Localizer.get().app_new_version_waiting_restart,
            "duration": 60 * 1000,
        })

        # 延迟3秒后关闭应用并打开更新日志
        time.sleep(3)
        QDesktopServices.openUrl(QUrl(VersionManager.RELEASE_URL))
        os.kill(os.getpid(), signal.SIGTERM)