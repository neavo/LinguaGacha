from __future__ import annotations

from collections.abc import Callable
import os
import time
from pathlib import Path

import pytest

from base.Base import Base
from base.VersionManager import VersionManager


class DummyLocalizer:
    task_failed = "task failed"
    app_new_version_success = "download success"
    app_new_version_failure = "download failure"
    app_new_version_waiting_restart = "waiting restart"
    app_new_version_apply_failed = "apply failed"


class DummyLogger:
    def noop(self, msg: str, e: Exception | None = None) -> None:
        del msg
        del e

    debug = noop
    info = noop
    warning = noop
    error = noop


# 统一收集事件，减少每个用例重复声明 emit mock 的样板。
def attach_emit_collector(version_manager: VersionManager, monkeypatch: pytest.MonkeyPatch) -> list[tuple[Base.Event, dict]]:
    emitted: list[tuple[Base.Event, dict]] = []
    monkeypatch.setattr(
        version_manager,
        "emit",
        lambda event, data: emitted.append((event, data)),
    )
    return emitted


# 用映射模拟 shutil.which，集中维护命令探测分支输入。
def build_which_stub(which_mapping: dict[str, str]) -> Callable[[str], str | None]:
    def fake_which(name: str) -> str | None:
        return which_mapping.get(name)

    return fake_which


@pytest.fixture()
def version_manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> VersionManager:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "resource" / "update").mkdir(parents=True, exist_ok=True)
    (tmp_path / "resource" / "update" / "update.ps1").write_text("Write-Host 'test updater'\n", encoding="utf-8")

    # 通过屏蔽 subscribe 避免测试中的实例污染全局事件中心。
    monkeypatch.setattr(VersionManager, "subscribe", lambda self, event, fn: None)
    monkeypatch.setattr("base.VersionManager.Localizer.get", lambda: DummyLocalizer())
    monkeypatch.setattr("base.VersionManager.LogManager.get", lambda: DummyLogger())

    manager = VersionManager()
    manager.set_version("v1.0.0")
    return manager


def test_windows_download_moves_status_to_downloaded(
    version_manager: VersionManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_sha256 = "a" * 64
    release_assets = [
        {
            "name": "LinguaGacha_v2.0.0.zip",
            "browser_download_url": "https://example.com/update.zip",
        },
        {
            "name": "LinguaGacha_v2.0.0.zip.sha256",
            "browser_download_url": "https://example.com/update.zip.sha256",
        },
    ]

    class FakeResponse:
        def __init__(self, data: dict | None = None, text: str = "") -> None:
            self.data = data if data is not None else {}
            self.text = text

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.data

    class FakeStreamResponse:
        def __init__(self) -> None:
            self.headers = {"Content-Length": "10"}

        def __enter__(self) -> FakeStreamResponse:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            del exc_type
            del exc
            del tb

        def raise_for_status(self) -> None:
            return None

        def iter_bytes(self, chunk_size: int):
            del chunk_size
            for chunk in (b"hello", b"world"):
                yield chunk

    def fake_get(url: str, timeout: int = 60, follow_redirects: bool = False):
        del timeout
        del follow_redirects
        if url == VersionManager.API_URL:
            return FakeResponse({"assets": release_assets})
        return FakeResponse(text=f"{expected_sha256}  LinguaGacha_v2.0.0.zip")

    emitted = attach_emit_collector(version_manager, monkeypatch)

    monkeypatch.setattr("base.VersionManager.sys.platform", "win32", raising=False)
    monkeypatch.setattr("base.VersionManager.httpx.get", fake_get)
    monkeypatch.setattr("base.VersionManager.httpx.stream", lambda *args, **kwargs: FakeStreamResponse())

    version_manager.app_update_download_start_task(Base.Event.APP_UPDATE_DOWNLOAD, {})

    assert version_manager.get_status() == VersionManager.Status.DOWNLOADED
    assert version_manager.get_expected_sha256() == expected_sha256
    assert Path(VersionManager.TEMP_PATH).read_bytes() == b"helloworld"
    assert (
        Base.Event.APP_UPDATE_DOWNLOAD,
        {"sub_event": Base.SubEvent.DONE, "manual": False},
    ) in emitted


def test_non_windows_branch_keeps_manual_update_mode(
    version_manager: VersionManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opened_urls: list[str] = []
    emitted = attach_emit_collector(version_manager, monkeypatch)

    monkeypatch.setattr("base.VersionManager.sys.platform", "darwin", raising=False)
    monkeypatch.setattr("base.VersionManager.webbrowser.open", lambda url: opened_urls.append(url))

    version_manager.set_status(VersionManager.Status.NEW_VERSION)
    version_manager.app_update_download_start_task(Base.Event.APP_UPDATE_DOWNLOAD, {})

    assert version_manager.get_status() == VersionManager.Status.NEW_VERSION
    assert opened_urls == [VersionManager.RELEASE_URL]
    assert (
        Base.Event.APP_UPDATE_DOWNLOAD,
        {"sub_event": Base.SubEvent.DONE, "manual": True},
    ) in emitted


def test_check_start_task_emits_done_with_no_new_version(version_manager: VersionManager, monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"tag_name": "v1.0.0"}

    emitted = attach_emit_collector(version_manager, monkeypatch)
    monkeypatch.setattr("base.VersionManager.httpx.get", lambda *args, **kwargs: FakeResponse())
    monkeypatch.setattr(VersionManager, "get", staticmethod(lambda: version_manager))

    version_manager.app_update_check_start_task(Base.Event.APP_UPDATE_CHECK, {})

    assert (
        Base.Event.APP_UPDATE_CHECK,
        {"sub_event": Base.SubEvent.DONE, "new_version": False},
    ) in emitted


def test_emit_apply_failure_emits_apply_error_event(version_manager: VersionManager, monkeypatch: pytest.MonkeyPatch) -> None:
    emitted = attach_emit_collector(version_manager, monkeypatch)
    log_path = "C:/tmp/update.log"

    version_manager.emit_apply_failure(None, log_path)

    assert (
        Base.Event.APP_UPDATE_APPLY,
        {"sub_event": Base.SubEvent.ERROR, "log_path": log_path},
    ) in emitted


def test_find_windows_update_assets_is_case_insensitive(
    version_manager: VersionManager,
) -> None:
    assets = [
        {
            "name": "LinguaGacha_v2.0.0.ZIP",
            "browser_download_url": "https://example.com/LinguaGacha_v2.0.0.ZIP",
        },
        {
            "name": "LinguaGacha_v2.0.0.ZIP.SHA256",
            "browser_download_url": "https://example.com/LinguaGacha_v2.0.0.ZIP.SHA256",
        },
    ]

    zip_url, hash_url = version_manager.find_windows_update_assets(assets)

    assert zip_url.endswith(".ZIP")
    assert hash_url.endswith(".SHA256")


def test_windows_apply_starts_updater_with_required_arguments(
    version_manager: VersionManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    emitted = attach_emit_collector(version_manager, monkeypatch)
    popen_args: list[list[str]] = []
    killed: list[tuple[int, int]] = []
    sleep_calls: list[float] = []

    expected_sha256 = "b" * 64
    Path(VersionManager.TEMP_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(VersionManager.TEMP_PATH).write_bytes(b"zip-bytes")

    class FakePopen:
        def __init__(self, command: list[str], cwd: str, creationflags: int) -> None:
            del cwd
            del creationflags
            popen_args.append(command)

    monkeypatch.setattr("base.VersionManager.sys.platform", "win32", raising=False)
    monkeypatch.setattr("base.VersionManager.subprocess.Popen", FakePopen)
    monkeypatch.setattr(
        "base.VersionManager.shutil.which",
        build_which_stub(
            {
                "pwsh": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
                "pwsh.exe": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
                "powershell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                "powershell.exe": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            }
        ),
    )
    monkeypatch.setattr("base.VersionManager.time.sleep", lambda sec: sleep_calls.append(sec))
    monkeypatch.setattr("base.VersionManager.os.kill", lambda pid, sig: killed.append((pid, sig)))
    version_manager.set_expected_sha256(expected_sha256)
    version_manager.set_status(VersionManager.Status.DOWNLOADED)
    version_manager.app_update_extract_task(Base.Event.APP_UPDATE_APPLY, {})

    assert version_manager.get_status() == VersionManager.Status.APPLYING
    assert len(popen_args) == 1
    command = popen_args[0]
    assert command[0].lower().endswith("pwsh.exe")
    assert "-AppPid" in command
    assert "-InstallDir" in command
    assert "-ZipPath" in command
    assert "-ExpectedSha256" in command
    assert expected_sha256 in command
    assert sleep_calls[0] == 3
    assert 0.2 in sleep_calls
    assert killed and killed[0][0] == os.getpid()
    assert killed[0][1] != 0
    assert any(event == Base.Event.PROGRESS_TOAST and payload.get("sub_event") == Base.SubEvent.UPDATE for event, payload in emitted)


@pytest.mark.parametrize(
    ("which_mapping", "expected_executable"),
    [
        (
            {
                "pwsh": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
                "pwsh.exe": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
                "powershell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                "powershell.exe": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            },
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        ),
        (
            {
                "powershell": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                "powershell.exe": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            },
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        ),
        ({}, "powershell.exe"),
    ],
)
def test_find_powershell_executable_selects_expected_command(
    version_manager: VersionManager,
    monkeypatch: pytest.MonkeyPatch,
    which_mapping: dict[str, str],
    expected_executable: str,
) -> None:
    monkeypatch.setattr(
        "base.VersionManager.shutil.which",
        build_which_stub(which_mapping),
    )

    executable = version_manager.find_powershell_executable()

    assert executable == expected_executable


def test_cleanup_update_temp_on_startup_cleans_stale_lock_and_temp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    update_dir = tmp_path / "resource" / "update"
    stage_dir = update_dir / "stage"
    backup_dir = update_dir / "backup"
    runtime_script = update_dir / "update.runtime.ps1"
    lock_path = update_dir / ".lock"
    log_path = update_dir / "update.log"
    result_path = update_dir / "result.json"
    temp_zip = tmp_path / "resource" / "update" / "app.zip.temp"

    stage_dir.mkdir(parents=True, exist_ok=True)
    backup_dir.mkdir(parents=True, exist_ok=True)
    runtime_script.write_text("runtime", encoding="utf-8")
    lock_path.write_text('{"pid": 9999999}', encoding="utf-8")
    log_path.write_text("log", encoding="utf-8")
    result_path.write_text(
        f'{{"status":"failed","logPath":"{log_path.as_posix()}"}}',
        encoding="utf-8",
    )
    temp_zip.parent.mkdir(parents=True, exist_ok=True)
    temp_zip.write_bytes(b"old-zip")
    old_timestamp = time.time() - VersionManager.TEMP_PACKAGE_EXPIRE_SECONDS - 10
    os.utime(temp_zip, (old_timestamp, old_timestamp))

    monkeypatch.setattr("base.VersionManager.LogManager.get", lambda: DummyLogger())
    VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH = None

    VersionManager.cleanup_update_temp_on_startup()

    assert VersionManager.STARTUP_PENDING_APPLY_FAILURE_LOG_PATH == str(log_path.resolve())
    assert not stage_dir.exists()
    assert not backup_dir.exists()
    assert not runtime_script.exists()
    assert not lock_path.exists()
    assert not result_path.exists()
    assert not temp_zip.exists()


def test_updater_script_supports_temp_package_extension() -> None:
    # 防回归：更新包下载后是 .zip.temp，脚本必须按 ZIP 内容解压而不是依赖扩展名。
    project_root = Path(__file__).resolve().parents[2]
    updater_script_path = project_root / "resource" / "update" / "update.ps1"
    script_content = updater_script_path.read_text(encoding="utf-8")

    assert "function Expand-PackageToStage" in script_content
    assert "[System.IO.Compression.ZipFile]::ExtractToDirectory" in script_content
    assert "Expand-Archive -Path $ZipPath" not in script_content
