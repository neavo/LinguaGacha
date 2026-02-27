import glob
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from enum import StrEnum
from typing import Self

import httpx

from base.Base import Base
from base.LogManager import LogManager
from module.Localizer.Localizer import Localizer


class VersionManager(Base):
    class Status(StrEnum):
        NONE = "NONE"
        NEW_VERSION = "NEW_VERSION"
        UPDATING = "UPDATING"
        DOWNLOADED = "DOWNLOADED"
        APPLYING = "APPLYING"
        FAILED = "FAILED"

    # 更新时的临时文件
    TEMP_PATH: str = "./resource/update/app.zip.temp"
    UPDATE_DIR: str = "./resource/update"
    UPDATE_LOG_PATH: str = "./resource/update/update.log"
    UPDATE_LOCK_PATH: str = "./resource/update/.lock"
    UPDATE_RESULT_PATH: str = "./resource/update/result.json"
    UPDATE_STAGE_PATH: str = "./resource/update/stage"
    UPDATE_BACKUP_PATH: str = "./resource/update/backup"
    UPDATER_TEMPLATE_PATH: str = "./resource/update/update.ps1"
    UPDATER_RUNTIME_PATH: str = "./resource/update/update.runtime.ps1"
    TEMP_PACKAGE_EXPIRE_SECONDS: int = 24 * 60 * 60
    STARTUP_PENDING_APPLY_FAILURE_LOG_PATH: str | None = None

    # URL 地址
    API_URL: str = "https://api.github.com/repos/neavo/LinguaGacha/releases/latest"
    RELEASE_URL: str = "https://github.com/neavo/LinguaGacha/releases/latest"

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.status = __class__.Status.NONE
        self.version = "v0.0.0"
        self.extracting = False
        self.expected_sha256 = ""

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

    # 启动期清理更新残留，保证异常中断后不会留下脏状态
    @classmethod
    def cleanup_update_temp_on_startup(cls) -> None:
        try:
            cls.load_pending_apply_result()
            if cls.is_updater_running():
                return

            cls.cleanup_update_path(cls.UPDATE_STAGE_PATH)
            cls.cleanup_update_path(cls.UPDATE_BACKUP_PATH)
            cls.cleanup_runtime_scripts()
            cls.cleanup_expired_temp_package()
        except Exception as e:
            LogManager.get().warning("Failed to cleanup update temp on startup", e)

    # 统一读取更新脚本写出的 JSON，兼容 PowerShell 5.1 生成的 UTF-8 BOM
    @staticmethod
    def read_update_json(path: str) -> dict[str, object]:
        with open(path, "r", encoding="utf-8-sig") as reader:
            loaded_json: object = json.load(reader)

        if not isinstance(loaded_json, dict):
            raise ValueError(f"Invalid update json payload: {path}")

        return loaded_json

    # 读取上次脚本结果，延迟到 UI 就绪后再统一提示
    @classmethod
    def load_pending_apply_result(cls) -> None:
        if not os.path.isfile(cls.UPDATE_RESULT_PATH):
            return

        try:
            result = cls.read_update_json(cls.UPDATE_RESULT_PATH)

            status = str(result.get("status", "")).lower()
            log_path = str(result.get("logPath", cls.UPDATE_LOG_PATH))
            if status == "failed":
                cls.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = os.path.abspath(log_path)
        except Exception as e:
            LogManager.get().warning("Failed to parse update result file", e)
        finally:
            try:
                os.remove(cls.UPDATE_RESULT_PATH)
            except FileNotFoundError:
                pass  # 结果文件可能已经被并发清理
            except OSError as e:
                LogManager.get().warning("Failed to remove update result file", e)

    # 判断更新脚本是否仍在运行；若锁已陈旧则移除
    @classmethod
    def is_updater_running(cls) -> bool:
        if not os.path.isfile(cls.UPDATE_LOCK_PATH):
            return False

        pid = 0
        try:
            lock_data = cls.read_update_json(cls.UPDATE_LOCK_PATH)
            pid = int(lock_data.get("pid", 0))
        except Exception as e:
            LogManager.get().warning("Failed to parse updater lock file", e)

        if pid > 0 and cls.is_process_running(pid):
            LogManager.get().info(
                f"Updater is still running, skip startup cleanup (pid={pid})"
            )
            return True

        try:
            os.remove(cls.UPDATE_LOCK_PATH)
        except FileNotFoundError:
            pass  # 锁可能被其他路径先一步清理
        except OSError as e:
            LogManager.get().warning("Failed to remove stale updater lock file", e)
        return False

    # 统一清理目录/文件，确保失败不会阻塞应用启动
    @classmethod
    def cleanup_update_path(cls, path: str) -> None:
        try:
            if os.path.isdir(path):
                for root, dirs, files in os.walk(path, topdown=False):
                    for file_name in files:
                        os.remove(os.path.join(root, file_name))
                    for dir_name in dirs:
                        os.rmdir(os.path.join(root, dir_name))
                os.rmdir(path)
            elif os.path.isfile(path):
                os.remove(path)
        except FileNotFoundError:
            pass  # 目标可能已经不存在
        except OSError as e:
            LogManager.get().warning(f"Failed to cleanup path: {path}", e)

    # 只清理运行时脚本，保留模板脚本供下一次更新使用
    @classmethod
    def cleanup_runtime_scripts(cls) -> None:
        runtime_scripts = glob.glob(f"{cls.UPDATE_DIR}/update.runtime*.ps1")
        for script_path in runtime_scripts:
            cls.cleanup_update_path(script_path)

    # 仅清理过期下载包，避免误删刚下载完成但尚未应用的文件
    @classmethod
    def cleanup_expired_temp_package(cls) -> None:
        if not os.path.isfile(cls.TEMP_PATH):
            return

        try:
            file_age = time.time() - os.path.getmtime(cls.TEMP_PATH)
            if file_age >= cls.TEMP_PACKAGE_EXPIRE_SECONDS:
                os.remove(cls.TEMP_PATH)
        except OSError as e:
            LogManager.get().warning("Failed to cleanup expired update package", e)

    # 用跨平台方式判断 PID 是否存活，避免误清理进行中的更新
    @staticmethod
    def is_process_running(pid: int) -> bool:
        if pid <= 0:
            return False

        try:
            os.kill(pid, 0)
        except OSError:
            return False
        else:
            return True

    # UI 初始化后调用，用于补发上次更新脚本失败提示
    def emit_pending_apply_failure_if_exists(self) -> None:
        with self.lock:
            pending_log_path = __class__.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH
            __class__.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = None

        if pending_log_path is None:
            return

        self.emit_apply_failure(None, pending_log_path)

    # 应用更新（仅 Windows）
    def app_update_extract(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        # 非 Windows 平台无需解压，直接返回
        if sys.platform != "win32":
            return

        with self.lock:
            if self.extracting:
                return
            self.extracting = True

        threading.Thread(
            target=self.app_update_extract_task,
            args=(Base.Event.APP_UPDATE_EXTRACT, {}),
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

    # 由主进程启动独立脚本执行更新，主进程不再直接覆盖自身文件
    def app_update_extract_task(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        try:
            if self.get_status() != __class__.Status.DOWNLOADED:
                return

            self.set_status(__class__.Status.APPLYING)
            runtime_script_path = self.generate_runtime_updater_script()
            self.start_updater_process(runtime_script_path)

            self.emit(
                Base.Event.PROGRESS_TOAST_UPDATE,
                {
                    "message": Localizer.get().app_new_version_waiting_restart,
                },
            )
            time.sleep(0.2)
            os.kill(os.getpid(), signal.SIGTERM)
        except Exception as e:
            self.emit_apply_failure(e, os.path.abspath(__class__.UPDATE_LOG_PATH))
        finally:
            with self.lock:
                self.extracting = False

    # 按约定从 release 资产中提取 Windows 更新包和哈希文件
    def find_windows_update_assets(
        self, assets: list[dict[str, object]]
    ) -> tuple[str, str]:
        zip_asset_name = ""
        zip_asset_url = ""
        for asset in assets:
            name = str(asset.get("name", ""))
            if name.endswith(".zip"):
                zip_asset_name = name
                zip_asset_url = str(asset.get("browser_download_url", ""))
                if zip_asset_url != "":
                    break

        if zip_asset_url == "":
            raise Exception("no windows zip asset")

        hash_asset_url = ""
        preferred_hash_name = f"{zip_asset_name}.sha256"
        for asset in assets:
            name = str(asset.get("name", ""))
            if name == preferred_hash_name:
                hash_asset_url = str(asset.get("browser_download_url", ""))
                break

        if hash_asset_url == "":
            for asset in assets:
                name = str(asset.get("name", ""))
                if name.endswith(".sha256") and zip_asset_name in name:
                    hash_asset_url = str(asset.get("browser_download_url", ""))
                    break

        if hash_asset_url == "":
            raise Exception("no sha256 asset for windows zip")

        return zip_asset_url, hash_asset_url

    # 解析哈希文件中的 SHA-256，统一转小写便于跨平台比对
    def fetch_expected_sha256(self, hash_asset_url: str) -> str:
        response = httpx.get(hash_asset_url, timeout=60, follow_redirects=True)
        response.raise_for_status()
        match = re.search(r"\b[a-fA-F0-9]{64}\b", response.text)
        if match is None:
            raise Exception("invalid sha256 file content")
        return match.group(0).lower()

    # 运行时生成独立脚本，避免直接修改模板文件
    def generate_runtime_updater_script(self) -> str:
        if not os.path.isfile(__class__.UPDATER_TEMPLATE_PATH):
            raise FileNotFoundError(__class__.UPDATER_TEMPLATE_PATH)

        os.makedirs(__class__.UPDATE_DIR, exist_ok=True)
        with open(__class__.UPDATER_TEMPLATE_PATH, "r", encoding="utf-8") as reader:
            content = reader.read()
        with open(__class__.UPDATER_RUNTIME_PATH, "w", encoding="utf-8") as writer:
            writer.write(content)

        return os.path.abspath(__class__.UPDATER_RUNTIME_PATH)

    # 用显式参数启动脚本，确保安装路径和哈希值来源单一且可追踪
    def start_updater_process(self, runtime_script_path: str) -> None:
        expected_sha256 = self.get_expected_sha256()
        if expected_sha256 == "":
            raise Exception("expected sha256 is empty")

        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            runtime_script_path,
            "-AppPid",
            str(os.getpid()),
            "-InstallDir",
            os.path.abspath("."),
            "-ZipPath",
            os.path.abspath(__class__.TEMP_PATH),
            "-ExpectedSha256",
            expected_sha256,
        ]

        # 需要给用户展示双语简报并等待下一步操作，更新脚本必须可见运行。
        creation_flags = 0
        subprocess.Popen(
            command,
            cwd=os.path.abspath("."),
            creationflags=creation_flags,
        )

    # 统一处理应用阶段失败文案，避免失败路径复用成功提示
    def emit_apply_failure(self, e: Exception | None, log_path: str) -> None:
        if e is not None:
            LogManager.get().error(Localizer.get().task_failed, e)

        self.set_status(__class__.Status.FAILED)
        self.emit(Base.Event.PROGRESS_TOAST_HIDE, {})
        self.emit(
            Base.Event.TOAST,
            {
                "type": Base.ToastType.ERROR,
                "message": Localizer.get().app_new_version_apply_failed_toast.replace(
                    "{LOG_PATH}", log_path
                ),
                "duration": 60 * 1000,
            },
        )
        self.emit(
            Base.Event.APP_UPDATE_APPLY_ERROR,
            {
                "log_path": log_path,
            },
        )

    # 检查
    def app_update_check_start_task(self, event: Base.Event, data: dict) -> None:
        del event
        del data

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

            # 使用元组比较简化版本号判断
            if (int(a), int(b), int(c)) < (int(x), int(y), int(z)):
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
        except Exception as e:
            LogManager.get().warning(Localizer.get().task_failed, e)

    # 下载
    def app_update_download_start_task(self, event: Base.Event, data: dict) -> None:
        del event
        del data

        try:
            # 非 Windows 保持手动更新策略：仅打开发布页，不走自动覆盖
            if sys.platform != "win32":
                webbrowser.open(__class__.RELEASE_URL)
                self.emit(
                    Base.Event.APP_UPDATE_DOWNLOAD_DONE,
                    {
                        "manual": True,
                    },
                )
                return

            # 更新状态
            self.set_status(VersionManager.Status.UPDATING)

            # 获取更新信息
            response = httpx.get(__class__.API_URL, timeout=60)
            response.raise_for_status()

            # 根据平台选择正确的资源文件
            assets = response.json().get("assets", [])
            browser_download_url, hash_asset_url = self.find_windows_update_assets(
                assets
            )
            self.set_expected_sha256(self.fetch_expected_sha256(hash_asset_url))

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
                if os.path.isfile(__class__.TEMP_PATH):
                    os.remove(__class__.TEMP_PATH)

                temp_dir = os.path.dirname(__class__.TEMP_PATH)
                if temp_dir != "":
                    os.makedirs(temp_dir, exist_ok=True)

                with open(__class__.TEMP_PATH, "wb") as writer:
                    for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                        if chunk is None:
                            continue

                        writer.write(chunk)
                        downloaded_size = downloaded_size + len(chunk)
                        self.emit(
                            Base.Event.APP_UPDATE_DOWNLOAD_UPDATE,
                            {
                                "total_size": total_size,
                                "downloaded_size": min(downloaded_size, total_size),
                            },
                        )

                if downloaded_size != total_size:
                    raise Exception("downloaded size mismatch")

                self.set_status(VersionManager.Status.DOWNLOADED)
                self.emit(
                    Base.Event.TOAST,
                    {
                        "type": Base.ToastType.SUCCESS,
                        "message": Localizer.get().app_new_version_success,
                        "duration": 60 * 1000,
                    },
                )
                self.emit(
                    Base.Event.APP_UPDATE_DOWNLOAD_DONE,
                    {
                        "manual": False,
                    },
                )
        except Exception as e:
            LogManager.get().error(Localizer.get().task_failed, e)
            self.set_status(VersionManager.Status.NEW_VERSION)
            self.emit(
                Base.Event.TOAST,
                {
                    "type": Base.ToastType.ERROR,
                    "message": Localizer.get().app_new_version_failure,
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

    def get_expected_sha256(self) -> str:
        with self.lock:
            return self.expected_sha256

    def set_expected_sha256(self, expected_sha256: str) -> None:
        with self.lock:
            self.expected_sha256 = expected_sha256

    def get_version(self) -> str:
        with self.lock:
            return self.version

    def set_version(self, version: str) -> None:
        with self.lock:
            self.version = version
