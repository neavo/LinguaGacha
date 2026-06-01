package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// 证明 main 与更新器之间的 CLI 契约稳定。
func TestParseBerserkerPlanReadsRequiredArguments(t *testing.T) {
	plan, err := parseBerserkerPlan([]string{
		"--zip", filepath.Join("userdata", "berserker", "v1.2.4", "update.zip"),
		"--target", filepath.Join("LinguaGacha"),
		"--app", filepath.Join("LinguaGacha", "app.exe"),
		"--wait-pid", "12345",
	})

	if err != nil {
		t.Fatalf("parseBerserkerPlan 返回错误：%v", err)
	}
	expected := berserkerPlan{
		zipPath:   filepath.Join("userdata", "berserker", "v1.2.4", "update.zip"),
		targetDir: filepath.Join("LinguaGacha"),
		appPath:   filepath.Join("LinguaGacha", "app.exe"),
		waitPid:   12345,
	}
	if !reflect.DeepEqual(plan, expected) {
		t.Fatalf("更新计划 = %#v，期望 %#v", plan, expected)
	}
}

// 证明缺少核心参数时不会进入覆盖写入。
func TestParseBerserkerPlanRequiresCoreArguments(t *testing.T) {
	_, err := parseBerserkerPlan([]string{"--zip", "update.zip"})

	if err == nil {
		t.Fatal("parseBerserkerPlan 应该拒绝缺少目标目录和 app 路径的参数")
	}
}

// 证明更新包不能写出目标目录。
func TestResolveArchiveDestinationRejectsZipSlip(t *testing.T) {
	targetDir := t.TempDir()
	illegalNames := []string{
		"../evil.exe",
		"/absolute/evil.exe",
		"C:/absolute/evil.exe",
		"..",
	}

	for _, name := range illegalNames {
		if _, err := resolveArchiveDestination(targetDir, name); err == nil {
			t.Fatalf("resolveArchiveDestination 应该拒绝非法条目 %q", name)
		}
	}
}

// 证明更新器会解压目录和文件并覆盖目标内容。
func TestExtractZipWritesFilesInsideTarget(t *testing.T) {
	targetDir := t.TempDir()
	zipPath := filepath.Join(t.TempDir(), "update.zip")
	createZip(t, zipPath, map[string]string{
		"app.exe":           "new app",
		"resource/data.txt": "new data",
	})
	if err := os.WriteFile(filepath.Join(targetDir, "app.exe"), []byte("old app"), 0o644); err != nil {
		t.Fatalf("准备旧 app.exe 失败：%v", err)
	}

	if err := extractZip(zipPath, targetDir); err != nil {
		t.Fatalf("extractZip 返回错误：%v", err)
	}

	assertFileContent(t, filepath.Join(targetDir, "app.exe"), "new app")
	assertFileContent(t, filepath.Join(targetDir, "resource", "data.txt"), "new data")
}

// 证明 zip slip 条目会中止更新。
func TestExtractZipRejectsEscapedEntry(t *testing.T) {
	targetDir := t.TempDir()
	zipPath := filepath.Join(t.TempDir(), "update.zip")
	createZip(t, zipPath, map[string]string{
		"../evil.exe": "evil",
	})

	err := extractZip(zipPath, targetDir)

	if err == nil || !strings.Contains(err.Error(), "非法路径") {
		t.Fatalf("extractZip 错误 = %v，期望拒绝非法路径", err)
	}
}

// 证明等待逻辑按 pid 运行态推进。
func TestWaitForPidExitPollsUntilProcessDisappears(t *testing.T) {
	runningStates := []bool{true, true, false}
	sleepCount := 0

	err := waitForPidExit(
		12345,
		func(pid int) bool {
			if pid != 12345 {
				t.Fatalf("pid = %d，期望 12345", pid)
			}
			state := runningStates[0]
			runningStates = runningStates[1:]
			return state
		},
		func(time.Duration) {
			sleepCount += 1
		},
	)

	if err != nil {
		t.Fatalf("waitForPidExit 返回错误：%v", err)
	}
	if sleepCount != 2 {
		t.Fatalf("sleep 次数 = %d，期望 2", sleepCount)
	}
}

// 证明测试和管道输入不需要回车换行也能继续。
func TestWaitForInputAcceptsSingleByte(t *testing.T) {
	stdin := bytes.NewBufferString("x")

	waitForInput(stdin)

	if stdin.Len() != 0 {
		t.Fatalf("剩余输入长度 = %d，期望 0", stdin.Len())
	}
}

// 证明成功路径会等待主程序、解压并启动 app。
func TestRunBerserkerExtractsAndStartsApp(t *testing.T) {
	targetDir := t.TempDir()
	zipPath := filepath.Join(t.TempDir(), "update.zip")
	appPath := filepath.Join(targetDir, "app.exe")
	createZip(t, zipPath, map[string]string{"app.exe": "new app"})
	startedApps := []string{}
	stdin := bytes.NewBufferString("x")
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	exitCode := runBerserker(
		[]string{"--zip", zipPath, "--target", targetDir, "--app", appPath, "--wait-pid", "7"},
		stdin,
		stdout,
		stderr,
		func(int) bool { return false },
		func(time.Duration) {},
		func(path string) error {
			startedApps = append(startedApps, path)
			return nil
		},
	)

	if exitCode != 0 {
		t.Fatalf("退出码 = %d，stderr = %s", exitCode, stderr.String())
	}
	assertFileContent(t, appPath, "new app")
	if !reflect.DeepEqual(startedApps, []string{appPath}) {
		t.Fatalf("启动路径 = %#v，期望 %#v", startedApps, []string{appPath})
	}
	if !strings.Contains(stdout.String(), "正在解压") {
		t.Fatalf("stdout 未包含解压进度：%s", stdout.String())
	}
}

// 构造更新包夹具，保持解压断言只关注目标行为。
func createZip(t *testing.T, zipPath string, files map[string]string) {
	t.Helper()
	target, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("创建 zip 失败：%v", err)
	}
	defer target.Close()

	writer := zip.NewWriter(target)
	defer writer.Close()
	for name, content := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("创建 zip 条目失败：%v", err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatalf("写入 zip 条目失败：%v", err)
		}
	}
}

// 断言覆盖写入后的目标文件内容。
func assertFileContent(t *testing.T, filePath string, expected string) {
	t.Helper()
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("读取文件失败：%v", err)
	}
	if string(content) != expected {
		t.Fatalf("%s 内容 = %q，期望 %q", filePath, string(content), expected)
	}
}
