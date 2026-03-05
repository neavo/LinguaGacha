$ErrorActionPreference = "Stop"

$SYNC_PATH_MAPPINGS = @(
    @{ source = "input"; target = "input" },
    @{ source = "input_bak"; target = "input_bak" },
    @{ source = "output"; target = "output" },
    @{ source = "resource/config.json"; target = "resource/config.json" }
)

$current_worktree = (Resolve-Path ".").Path
$all_worktrees = git worktree list --porcelain
$worktree_paths = @()

foreach ($line in $all_worktrees) {
    if ($line -like "worktree *") {
        $worktree_paths += $line.Substring(9)
    }
}

$source_worktree = $current_worktree
if ($worktree_paths.Count -gt 0) {
    $source_worktree = $worktree_paths[0]
    if ((Resolve-Path $source_worktree).Path -eq $current_worktree -and $worktree_paths.Count -gt 1) {
        $source_worktree = $worktree_paths[1]
    }
}

foreach ($path_mapping in $SYNC_PATH_MAPPINGS) {
    $source_relative_path = [string]$path_mapping["source"]
    $target_relative_path = [string]$path_mapping["target"]

    $source_path = Join-Path $source_worktree $source_relative_path
    if (-not (Test-Path -LiteralPath $source_path)) {
        continue
    }

    $target_path = Join-Path $current_worktree $target_relative_path
    $source_item = Get-Item -LiteralPath $source_path -Force

    if ($source_item.PSIsContainer) {
        if (-not (Test-Path -LiteralPath $target_path)) {
            New-Item -ItemType Directory -Path $target_path | Out-Null
        }

        $resolved_source_path = (Resolve-Path -LiteralPath $source_path).Path
        $resolved_target_path = (Resolve-Path -LiteralPath $target_path).Path
        if ($resolved_source_path -eq $resolved_target_path) {
            continue
        }

        Get-ChildItem -LiteralPath $source_path -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $target_path -Recurse -Force
        }
        continue
    }

    $target_parent_path = Split-Path -Parent $target_path
    if ($target_parent_path -and -not (Test-Path -LiteralPath $target_parent_path)) {
        New-Item -ItemType Directory -Path $target_parent_path -Force | Out-Null
    }

    if (Test-Path -LiteralPath $target_path) {
        $resolved_source_path = (Resolve-Path -LiteralPath $source_path).Path
        $resolved_target_path = (Resolve-Path -LiteralPath $target_path).Path
        if ($resolved_source_path -eq $resolved_target_path) {
            continue
        }
    }

    Copy-Item -LiteralPath $source_path -Destination $target_path -Force
}
