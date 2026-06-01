package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// 证明启动器只追加 --cli，不改写用户参数。
func TestBuildLauncherPlanForwardsCLIMarkerAndUserArgs(t *testing.T) {
	currentExecutablePath := filepath.Join("install", "cli.exe")
	userArgs := []string{"translate", "--input", filepath.Join("game files", "script.txt")}

	plan, err := buildLauncherPlan(currentExecutablePath, userArgs)

	if err != nil {
		t.Fatalf("buildLauncherPlan 返回错误：%v", err)
	}
	if plan.executablePath != filepath.Join("install", "app.exe") {
		t.Fatalf("主程序路径 = %q，期望 %q", plan.executablePath, filepath.Join("install", "app.exe"))
	}
	expectedArgs := []string{"--cli", "translate", "--input", filepath.Join("game files", "script.txt")}
	if !reflect.DeepEqual(plan.args, expectedArgs) {
		t.Fatalf("转发参数 = %#v，期望 %#v", plan.args, expectedArgs)
	}
}

// 证明入口路径缺失时不会构造错误转发计划。
func TestBuildLauncherPlanRejectsEmptyExecutablePath(t *testing.T) {
	_, err := buildLauncherPlan("", []string{"--help"})

	if err == nil {
		t.Fatal("buildLauncherPlan 应该拒绝空 cli.exe 路径")
	}
}

// 证明子进程成功时启动器返回 0。
func TestNormalizeExitResultKeepsSuccess(t *testing.T) {
	exitCode, err := normalizeExitResult(nil)

	if err != nil {
		t.Fatalf("normalizeExitResult 返回错误：%v", err)
	}
	if exitCode != 0 {
		t.Fatalf("退出码 = %d，期望 0", exitCode)
	}
}

// 证明启动失败时启动器返回通用失败码。
func TestNormalizeExitResultReportsLaunchFailure(t *testing.T) {
	launchErr := errors.New("启动失败")

	exitCode, err := normalizeExitResult(launchErr)

	if !errors.Is(err, launchErr) {
		t.Fatalf("错误 = %v，期望保留原始错误", err)
	}
	if exitCode != 1 {
		t.Fatalf("退出码 = %d，期望 1", exitCode)
	}
}

// 证明缺少 app.exe 时会给出明确错误。
func TestEnsureAppExecutableExistsReportsMissingApp(t *testing.T) {
	tempDir := t.TempDir()

	err := ensureAppExecutableExists(filepath.Join(tempDir, "app.exe"))

	if err == nil {
		t.Fatal("ensureAppExecutableExists 应该报告 app.exe 缺失")
	}
}

// 证明 app.exe 存在时启动前检查通过。
func TestEnsureAppExecutableExistsAcceptsExistingApp(t *testing.T) {
	tempDir := t.TempDir()
	appPath := filepath.Join(tempDir, "app.exe")
	if err := os.WriteFile(appPath, []byte("app"), 0o755); err != nil {
		t.Fatalf("准备 app.exe 失败：%v", err)
	}

	err := ensureAppExecutableExists(appPath)

	if err != nil {
		t.Fatalf("ensureAppExecutableExists 返回错误：%v", err)
	}
}
