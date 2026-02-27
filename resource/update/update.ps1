param (
    [Parameter(Mandatory = $true)]
    [int]$AppPid,
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedSha256
)

$ErrorActionPreference = "Stop"

$UpdateDir = Join-Path $InstallDir "resource\update"
$StageDir = Join-Path $UpdateDir "stage"
$BackupDir = Join-Path $UpdateDir "backup"
$LockPath = Join-Path $UpdateDir ".lock"
$LogPath = Join-Path $UpdateDir "update.log"
$ResultPath = Join-Path $UpdateDir "result.json"
$AppExePath = Join-Path $InstallDir "app.exe"
$VersionPath = Join-Path $InstallDir "version.txt"
$ResourcePath = Join-Path $InstallDir "resource"
$RuntimeScriptPath = Join-Path $UpdateDir "update.runtime.ps1"

New-Item -ItemType Directory -Path $UpdateDir -Force | Out-Null

function Write-Log {
    param ([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    "$timestamp $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

function Write-Result {
    param (
        [string]$Status,
        [string]$Message
    )

    $result = @{
        status = $Status
        message = $Message
        logPath = $LogPath
        timestamp = (Get-Date).ToString("o")
    }
    $result | ConvertTo-Json -Compress | Out-File -FilePath $ResultPath -Encoding UTF8
}

function Remove-IfExists {
    param ([string]$Path)

    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Start-App {
    if (Test-Path $AppExePath) {
        Start-Process -FilePath $AppExePath -WorkingDirectory $InstallDir | Out-Null
    }
}

function Ensure-MutexLock {
    if (Test-Path $LockPath) {
        $lockPid = 0
        try {
            $lockInfo = Get-Content -Path $LockPath -Raw | ConvertFrom-Json
            $lockPid = [int]$lockInfo.pid
        } catch {
            $lockPid = 0
        }

        if ($lockPid -gt 0) {
            $runningProcess = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
            if ($null -ne $runningProcess) {
                Write-Log "Another updater is running (pid=$lockPid)."
                throw "Updater lock already held."
            }
        }

        Write-Log "Remove stale lock file."
        Remove-IfExists $LockPath
    }

    $lockPayload = @{
        pid = $PID
        appPid = $AppPid
        createdAt = (Get-Date).ToString("o")
    }
    $lockPayload | ConvertTo-Json -Compress | Out-File -FilePath $LockPath -Encoding UTF8
}

function Write-Summary {
    param (
        [int]$Code,
        [string]$Status,
        [string]$Message
    )

    $isSuccess = $Status -eq "success"
    $statusZh = if ($isSuccess) { "成功" } else { "失败" }
    $statusEn = if ($isSuccess) { "SUCCESS" } else { "FAILED" }
    $nextStepZh = if ($isSuccess) {
        "请确认应用已正常启动；若没有自动启动，请手动运行 app.exe。"
    } else {
        "请先查看日志定位问题，确认后手动重启应用。"
    }
    $nextStepEn = if ($isSuccess) {
        "Confirm the app starts correctly; if not, launch app.exe manually."
    } else {
        "Check the log first, then restart the app manually after fixing the issue."
    }

    Write-Host ""
    Write-Host "========== 更新简报 / Update Summary =========="
    Write-Host "状态 / Status : $statusZh / $statusEn"
    Write-Host "退出码 / Exit Code : $Code"
    Write-Host "信息 / Message : $Message"
    Write-Host "日志 / Log : $LogPath"
    Write-Host "下一步 / Next Step:"
    Write-Host "  - $nextStepZh"
    Write-Host "  - $nextStepEn"
    Write-Host "==============================================="
}

function Wait-ForUserConfirm {
    try {
        [void](Read-Host "按回车关闭窗口 / Press Enter to close")
    } catch {
        Write-Host "无法等待用户输入，脚本结束。 / Unable to wait for input, script finished."
    }
}

function Wait-AppExit {
    $timeoutSeconds = 180
    $elapsedSeconds = 0

    while ($true) {
        $targetProcess = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
        if ($null -eq $targetProcess) {
            break
        }

        Start-Sleep -Milliseconds 500
        $elapsedSeconds = $elapsedSeconds + 0.5
        if ($elapsedSeconds -ge $timeoutSeconds) {
            throw "Main process still running after timeout (pid=$AppPid)."
        }
    }
}

function Validate-PackageSha256 {
    if (!(Test-Path $ZipPath)) {
        throw "Update package not found: $ZipPath"
    }

    $actualSha = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedSha = $ExpectedSha256.ToLowerInvariant()
    if ($actualSha -ne $expectedSha) {
        throw "SHA-256 mismatch. expected=$expectedSha actual=$actualSha"
    }
}

function Backup-Targets {
    Remove-IfExists $BackupDir
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

    $backupAppPath = Join-Path $BackupDir "app.exe"
    $backupVersionPath = Join-Path $BackupDir "version.txt"
    $backupResourcePath = Join-Path $BackupDir "resource"

    if (Test-Path $AppExePath) {
        Copy-Item -Path $AppExePath -Destination $backupAppPath -Force
    }
    if (Test-Path $VersionPath) {
        Copy-Item -Path $VersionPath -Destination $backupVersionPath -Force
    }

    New-Item -ItemType Directory -Path $backupResourcePath -Force | Out-Null
    if (Test-Path $ResourcePath) {
        $resourceItems = Get-ChildItem -Path $ResourcePath -Force
        foreach ($item in $resourceItems) {
            if ($item.Name -eq "update") {
                continue
            }
            Copy-Item -Path $item.FullName -Destination $backupResourcePath -Recurse -Force
        }
    }
}

function Restore-Targets {
    $backupAppPath = Join-Path $BackupDir "app.exe"
    $backupVersionPath = Join-Path $BackupDir "version.txt"
    $backupResourcePath = Join-Path $BackupDir "resource"

    if (Test-Path $backupAppPath) {
        Copy-Item -Path $backupAppPath -Destination $AppExePath -Force
    }
    if (Test-Path $backupVersionPath) {
        Copy-Item -Path $backupVersionPath -Destination $VersionPath -Force
    }

    if (!(Test-Path $ResourcePath)) {
        New-Item -ItemType Directory -Path $ResourcePath -Force | Out-Null
    }

    $resourceItems = Get-ChildItem -Path $ResourcePath -Force
    foreach ($item in $resourceItems) {
        if ($item.Name -eq "update") {
            continue
        }
        Remove-IfExists $item.FullName
    }

    if (Test-Path $backupResourcePath) {
        $backupItems = Get-ChildItem -Path $backupResourcePath -Force
        foreach ($item in $backupItems) {
            Copy-Item -Path $item.FullName -Destination $ResourcePath -Recurse -Force
        }
    }
}

$exitCode = 0
$needRollback = $false
$summaryStatus = "success"
$summaryMessage = "Update applied."

try {
    Remove-IfExists $LogPath
    Remove-IfExists $ResultPath
    Write-Log "Updater start. pid=$PID appPid=$AppPid"

    Ensure-MutexLock
    Write-Log "Mutex lock acquired."

    Write-Log "Wait main process exit."
    Wait-AppExit
    Write-Log "Main process exited."

    Write-Log "Validate package SHA-256."
    Validate-PackageSha256
    Write-Log "SHA-256 validated."

    Remove-IfExists $StageDir
    New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $StageDir -Force
    Write-Log "Archive extracted to stage."

    $sourceRoot = Join-Path $StageDir "LinguaGacha"
    if (!(Test-Path $sourceRoot)) {
        $sourceRoot = $StageDir
    }

    Write-Log "Backup app.exe/version.txt/resource."
    Backup-Targets
    $needRollback = $true

    Write-Log "Apply staged files to install directory."
    Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $InstallDir -Recurse -Force

    Write-Log "Update applied successfully."
    Write-Result -Status "success" -Message "Update applied."
    Start-App
}
catch {
    $exitCode = 30
    $errorMessage = $_.Exception.Message
    $summaryStatus = "failed"
    $summaryMessage = $errorMessage
    Write-Log "ERROR: $errorMessage"

    if ($errorMessage -like "*SHA-256 mismatch*") {
        $exitCode = 10
    } elseif ($errorMessage -like "*lock already held*") {
        $exitCode = 21
    }

    if ($needRollback) {
        try {
            Write-Log "Start rollback."
            Restore-Targets
            Write-Log "Rollback finished."
        } catch {
            Write-Log "Rollback failed: $($_.Exception.Message)"
        }
    } else {
        Write-Log "Skip rollback because backup is unavailable."
    }

    Write-Result -Status "failed" -Message $errorMessage
    Start-App
}
finally {
    Remove-IfExists $LockPath

    if ($exitCode -eq 0) {
        Remove-IfExists $StageDir
        Remove-IfExists $BackupDir
        Remove-IfExists $ZipPath
        Remove-IfExists $RuntimeScriptPath
        Remove-IfExists $ResultPath
    }

    Write-Log "Updater exit code: $exitCode"
    Write-Summary -Code $exitCode -Status $summaryStatus -Message $summaryMessage
    Wait-ForUserConfirm
}
