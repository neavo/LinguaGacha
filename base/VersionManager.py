import os
import platform
import re
import shutil
import signal
import sys
import threading
import time
import zipfile
from enum import StrEnum
from typing import Self

import httpx
from PyQt5.QtCore import QObject
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QUrl
from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import QApplication

from base.Base import Base
from module.Localizer.Localizer import Localizer


class _UrlOpener(QObject):
    """Helper class to open URLs on the main thread via Qt signals."""

    _instance: "_UrlOpener | None" = None
    _lock = threading.Lock()
    _open_signal = pyqtSignal(str)

    def __init__(self) -> None:
        super().__init__()
        # Move to main thread to ensure slot executes there
        app = QApplication.instance()
        if app is not None:
            self.moveToThread(app.thread())
        # Use QueuedConnection to ensure cross-thread signal delivery
        self._open_signal.connect(self._do_open, Qt.QueuedConnection)

    def _do_open(self, url: str) -> None:
        QDesktopServices.openUrl(QUrl(url))

    @classmethod
    def open_url(cls, url: str) -> None:
        """Open URL on main thread. Safe to call from any thread."""
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
        cls._instance._open_signal.emit(url)


def _open_url_on_main_thread(url: str) -> None:
    """Open URL on main thread to avoid Qt threading issues."""
    _UrlOpener.open_url(url)


def get_platform_info() -> tuple[str, str]:
    """Get current platform and architecture info."""
    if sys.platform == "darwin":
        arch = platform.machine()  # arm64 or x86_64
        return ("macos", arch)
    elif sys.platform == "linux":
        arch = platform.machine()  # x86_64 or aarch64
        return ("linux", arch)
    return ("windows", "x86_64")


class VersionManager(Base):
    class Status(StrEnum):
        NONE = "NONE"
        NEW_VERSION = "NEW_VERSION"
        UPDATING = "UPDATING"
        DOWNLOADED = "DOWNLOADED"

    # 更新时的临时文件
    TEMP_PATH: str = "./resource/update.temp"

    # URL 地址
    API_URL: str = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest"
    RELEASE_URL: str = "https://github.com/neavo/LinguaGacha/releases/latest"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.status = __class__.Status.NONE
        self.version = "v0.0.0"
        self.extracting = False

        # 线程锁
        self.lock: threading.Lock = threading.Lock()

        # 注册事件
        self.subscribe(Base.Event.APP_UPDATE_EXTRACT, self.app_update_extract)
        self.subscribe(Base.Event.APP_UPDATE_CHECK_RUN, self.app_update_check_run)
        self.subscribe(Base.Event.APP_UPDATE_DOWNLOAD_RUN, self.app_update_download_run)

    @classmethod
    def get(cls) -> Self:
        if getattr(cls, "__instance__", None) is None:
            cls.__instance__ = cls()

        return cls.__instance__

    # 解压
    def app_update_extract(self, event: Base.Event, data: dict) -> None:
        with self.lock:
            if self.extracting == False:
                threading.Thread(
                    target=self.app_update_extract_task,
                    args=(event, data),
                ).start()

    # 检查
    def app_update_check_run(self, event: Base.Event, data: dict) -> None:
        threading.Thread(
            target=self.app_update_check_start_task,
            args=(event, data),
        ).start()

    # 下载
    def app_update_download_run(self, event: Base.Event, data: dict) -> None:
        threading.Thread(
            target=self.app_update_download_start_task,
            args=(event, data),
        ).start()

    # 解压
    def app_update_extract_task(self, event: Base.Event, data: dict) -> None:
        plat, _ = get_platform_info()

        # macOS/Linux uses DMG/tar.gz, skip extraction and open release page
        if plat in ("macos", "linux"):
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.SUCCESS,
                    "message": Localizer.get().app_new_version_waiting_restart,
                    "duration": 60 * 1000,
                },
            )
            time.sleep(1)
            _open_url_on_main_thread(__class__.RELEASE_URL)
            with self.lock:
                self.extracting = False
            return

        # Windows extraction logic
        with self.lock:
            self.extracting = True

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
            with zipfile.ZipFile(__class__.TEMP_PATH) as zip_file:
                zip_file.extractall("./")

            # 先复制再删除的方式实现覆盖同名文件
            shutil.copytree("./LinguaGacha/", "./", dirs_exist_ok=True)
            shutil.rmtree("./LinguaGacha/", ignore_errors=True)
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
            os.remove(__class__.TEMP_PATH)
        except Exception:
            pass

        # 显示提示
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.SUCCESS,
                "message": Localizer.get().app_new_version_waiting_restart,
                "duration": 60 * 1000,
            },
        )

        # 延迟3秒后关闭应用并打开更新日志
        time.sleep(3)
        _open_url_on_main_thread(__class__.RELEASE_URL)
        os.kill(os.getpid(), signal.SIGTERM)

    # 检查
    def app_update_check_start_task(self, event: Base.Event, data: dict) -> None:
        try:
            # 获取更新信息
            response = httpx.get(__class__.API_URL, timeout=60)
            response.raise_for_status()

            result: dict = response.json()
            a, b, c = re.findall(
                r"v(\d+)\.(\d+)\.(\d+)$", VersionManager.get().get_version()
            )[-1]
            x, y, z = re.findall(
                r"v(\d+)\.(\d+)\.(\d+)$", result.get("tag_name", "v0.0.0")
            )[-1]

            if (
                int(a) < int(x)
                or (int(a) == int(x) and int(b) < int(y))
                or (int(a) == int(x) and int(b) == int(y) and int(c) < int(z))
            ):
                self.set_status(VersionManager.Status.NEW_VERSION)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().app_new_version_toast.replace(
                            "{VERSION}", f"v{x}.{y}.{z}"
                        ),
                        "duration": 60 * 1000,
                    },
                )
                self.emit(
                    Base.Event.APP_UPDATE_CHECK_DONE,
                    {
                        "new_version": True,
                    },
                )
        except Exception:
            pass

    # 下载
    def app_update_download_start_task(self, event: Base.Event, data: dict) -> None:
        try:
            # 更新状态
            self.set_status(VersionManager.Status.UPDATING)

            plat, _ = get_platform_info()

            # macOS/Linux: skip download, open release page directly
            if plat in ("macos", "linux"):
                self.set_status(VersionManager.Status.DOWNLOADED)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().app_new_version_success,
                        "duration": 60 * 1000,
                    },
                )
                # Open release page directly for manual download
                _open_url_on_main_thread(__class__.RELEASE_URL)
                self.emit(Base.Event.APP_UPDATE_DOWNLOAD_DONE, {})
                return

            # 获取更新信息
            response = httpx.get(__class__.API_URL, timeout=60)
            response.raise_for_status()

            # Select correct asset based on platform
            assets = response.json().get("assets", [])
            browser_download_url = ""

            # Windows: find .zip file
            for asset in assets:
                name = asset.get("name", "")
                if name.endswith(".zip"):
                    browser_download_url = asset.get("browser_download_url", "")
                    break

            if not browser_download_url:
                raise Exception(f"No suitable asset found for {plat}")

            with httpx.stream(
                "GET", browser_download_url, timeout=60, follow_redirects=True
            ) as response:
                response.raise_for_status()

                # 获取文件总大小
                total_size: int = int(response.headers.get("Content-Length", 0))
                downloaded_size: int = 0

                # 有效性检查
                if total_size == 0:
                    raise Exception("Content-Length is 0 ...")

                # 写入文件并更新进度
                os.remove(__class__.TEMP_PATH) if os.path.isfile(
                    __class__.TEMP_PATH
                ) else None
                os.makedirs(os.path.dirname(__class__.TEMP_PATH), exist_ok=True)
                with open(__class__.TEMP_PATH, "wb") as writer:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                        if chunk is not None:
                            writer.write(chunk)
                            downloaded_size = downloaded_size + len(chunk)
                            if total_size > downloaded_size:
                                self.emit(
                                    Base.Event.APP_UPDATE_DOWNLOAD_UPDATE,
                                    {
                                        "total_size": total_size,
                                        "downloaded_size": downloaded_size,
                                    },
                                )
                            else:
                                self.set_status(VersionManager.Status.DOWNLOADED)
                                self.emit(
                                    Base.Event.TOAST,
                                    {
                                        "type": Base.ToastType.SUCCESS,
                                        "message": Localizer.get().app_new_version_success,
                                        "duration": 60 * 1000,
                                    },
                                )
                                self.emit(Base.Event.APP_UPDATE_DOWNLOAD_DONE, {})
        except Exception as e:
            self.set_status(VersionManager.Status.NONE)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().app_new_version_failure + str(e),
                    "duration": 60 * 1000,
                },
            )
            self.emit(Base.Event.APP_UPDATE_DOWNLOAD_ERROR, {})

    def get_status(self) -> Status:
        with self.lock:
            return self.status

    def set_status(self, status: Status) -> None:
        with self.lock:
            self.status = status

    def get_version(self) -> str:
        with self.lock:
            return self.version

    def set_version(self, version: str) -> None:
        with self.lock:
            self.version = version
