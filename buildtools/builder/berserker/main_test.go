//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"testing/synctest"
	"time"
)

// 参数和 ZIP 路径都来自进程边界，拒绝缺失目标和目录逃逸。
func TestPlanAndArchivePaths(t *testing.T) {
	dir := t.TempDir()
	plan, err := parseBerserkerPlan([]string{"--zip", "update.zip", "--target", dir})
	if err != nil || plan.targetDir != dir {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	if _, err := parseBerserkerPlan([]string{"--zip", "update.zip"}); err == nil {
		t.Fatal("缺少参数应失败")
	}
	for _, name := range []string{"../evil.exe", "/absolute/evil.exe", "C:/evil.exe", "..", `..\evil.exe`} {
		if _, err := resolveArchiveDestination(dir, name); err == nil {
			t.Fatalf("未拒绝路径 %q", name)
		}
	}
}

// 成功路径须写入文件，并在用户按键后实际请求启动。
func TestRunBerserkerUpdatesAndWaitsForKey(t *testing.T) {
	dir := t.TempDir()
	archive := makeArchive(t, []string{"resource/data.txt", "app.exe"})
	var output bytes.Buffer
	pressed, started := false, false
	stdin := keyReader(func() { pressed = true })
	code := runBerserker([]string{"--zip", archive, "--target", dir}, stdin, &output, func(app string) error {
		started = true
		if !pressed {
			t.Fatal("按键前启动了应用")
		}
		for _, name := range []string{"app.exe", "resource/data.txt"} {
			content, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil || string(content) != name {
				t.Fatalf("%s: %q %v", name, content, err)
			}
		}
		return nil
	})
	if code != 0 || !started {
		t.Fatal(output.String())
	}
	log, err := os.ReadFile(filepath.Join(dir, "log", "update.log"))
	if err != nil || !bytes.Contains(log, output.Bytes()) {
		t.Fatalf("安装目录日志未记录控制台输出: %v", err)
	}
}

// 回调标记按键已被读取，用于验证重启时序。
type keyReader func()

// 提供单个确认字节。
func (reader keyReader) Read(data []byte) (int, error) {
	reader()
	data[0] = 'x'
	return 1, nil
}

// 主程序条目优先；真实共享冲突消耗跨文件预算并保留旧文件。
func TestAppFirstAndSharingBudget(t *testing.T) {
	dir := t.TempDir()
	app := filepath.Join(dir, "app.exe")
	if err := os.WriteFile(app, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	name, _ := syscall.UTF16PtrFromString(app)
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ, syscall.FILE_SHARE_READ, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.CloseHandle(handle)
	archive, err := zip.OpenReader(makeArchive(t, []string{"data.txt", "app.exe"}))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	files, err := orderedFiles(archive.File, berserkerPlan{targetDir: dir, appPath: app})
	if err != nil {
		t.Fatal(err)
	}
	if files[0].Name != "app.exe" {
		t.Fatal("未先更新 app.exe")
	}
	// 虚拟时间覆盖真实文件占用，生产代码直接使用标准时钟。
	synctest.Test(t, func(t *testing.T) {
		started := time.Now()
		budget := retryBudget{remaining: sharingWait}
		first := true
		var output bytes.Buffer
		if err := budget.run(func() error {
			if first {
				first = false
				return sharingViolation
			}
			return nil
		}, &output); err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(output.String(), "\n\n") || strings.HasSuffix(output.String(), "\n\n\n") {
			t.Fatal("文件占用倒计时末尾应有一个空行")
		}
		changed := false
		err := extractZipFile(files[0], app, &budget, io.Discard, &changed)
		if !errors.Is(err, sharingViolation) || changed {
			t.Fatalf("err=%v changed=%v", err, changed)
		}
		if time.Since(started) != 10*time.Second {
			t.Fatalf("跨文件等待未共用 10 秒预算: %v", time.Since(started))
		}
	})
	content, _ := os.ReadFile(app)
	if string(content) != "old" {
		t.Fatal("共享冲突破坏了旧文件")
	}
}

// 更新包目录不完整或逃逸时，在任何覆盖与重启之前失败。
func TestInvalidArchiveDoesNotWriteOrStart(t *testing.T) {
	dir := t.TempDir() // 连续更新共用安装目录，第二次运行须覆盖上次日志。
	for _, names := range [][]string{{"data.txt"}, {"app.exe", "../evil.exe"}} {
		var output bytes.Buffer
		code := runBerserker([]string{"--zip", makeArchive(t, names), "--target", dir}, bytes.NewBufferString("x"), &output, func(string) error { t.Fatal("失败后启动了应用"); return nil })
		entries, _ := os.ReadDir(dir)
		if code != 1 || len(entries) != 1 || entries[0].Name() != "log" {
			t.Fatalf("code=%d entries=%v output=%s", code, entries, output.String())
		}
		log, err := os.ReadFile(filepath.Join(dir, "log", "update.log"))
		_, body, _ := bytes.Cut(log, []byte("\n")) // 首行记录本次启动时间。
		if err != nil || !bytes.Equal(body, output.Bytes()) {
			t.Fatalf("失败日志应只包含本次输出: %v", err)
		}
		if len(strings.Split(strings.TrimSpace(output.String()), "\n\n")) != 3 {
			t.Fatal("失败标题、原因和关闭提示之间应各有一个空行")
		}
	}
}

// 查询失败只有在等待期限内且属于访问拒绝时才允许重新观察。
func TestWaitCountdownQueryFailures(t *testing.T) {
	denied := fmt.Errorf("PID=123: %w", syscall.ERROR_ACCESS_DENIED)
	for _, test := range []struct {
		name      string
		results   []error
		wantDone  bool
		wantError error
	}{
		{"已经退出直接继续", []error{nil}, true, nil},
		{"退出过渡后消失", []error{denied, nil}, true, nil},
		{"持续拒绝保留诊断", []error{denied, denied}, false, denied},
		{"其它错误立即失败", []error{syscall.ERROR_FILE_NOT_FOUND}, false, syscall.ERROR_FILE_NOT_FOUND},
	} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				calls := 0
				started := time.Now()
				var output bytes.Buffer
				done, err := waitCountdown(&output, processWait, "正在等待 …", "Waiting …", func() (bool, error) {
					result := test.results[min(calls, len(test.results)-1)]
					calls++
					return result == nil, result
				})
				if done != test.wantDone || !errors.Is(err, test.wantError) {
					t.Fatalf("done=%v err=%v", done, err)
				}
				if errors.Is(test.wantError, syscall.ERROR_ACCESS_DENIED) && time.Since(started) != 5*time.Second {
					t.Fatalf("持续拒绝须在 5 秒期限结束时报错: %v", time.Since(started))
				}
				if errors.Is(test.results[0], syscall.ERROR_ACCESS_DENIED) {
					if !strings.HasSuffix(output.String(), "\n\n") || strings.HasSuffix(output.String(), "\n\n\n") {
						t.Fatal("倒计时末尾应有一个空行")
					}
				} else if output.Len() != 0 || time.Since(started) != 0 {
					t.Fatal("无需等待时应直接返回")
				}
			})
		})
	}
}

// 正常退出与强制清理都按完整路径等待，另一个安装目录的同名进程继续运行。
func TestStopAppProcessesMatchesFullPath(t *testing.T) {
	for _, natural := range []bool{true, false} {
		t.Run(fmt.Sprintf("natural=%v", natural), func(t *testing.T) {
			target, targetDone, exit := startHelper(t)
			other, _, _ := startHelper(t)
			if natural {
				exit()
			}
			var output bytes.Buffer
			var diagnostics bytes.Buffer
			if err := stopAppProcesses(target, &output, &diagnostics); err != nil {
				t.Fatal(err)
			}
			select {
			case <-targetDone:
			case <-time.After(5 * time.Second):
				t.Fatal("目标进程未退出")
			}
			remaining, err := findAppProcesses(other)
			if err != nil {
				t.Fatal(err)
			}
			defer closeProcesses(remaining)
			if len(remaining) != 1 {
				t.Fatal("错误结束了其它目录的 app.exe")
			}
			if natural && diagnostics.Len() != 0 {
				t.Fatal("正常退出被强制终止")
			}
			if !natural && !strings.Contains(output.String(), "5 …") {
				t.Fatal("等待期间没有倒计时")
			}
		})
	}
}

// 独立运行时维持一个真实 Windows 进程，关闭标准输入后退出。
func TestProcessHelper(t *testing.T) {
	if os.Getenv("LINGUAGACHA_UPDATER_HELPER") != "1" {
		return
	}
	os.Stdout.Write([]byte("R"))
	var one [1]byte
	os.Stdin.Read(one[:])
	os.Exit(0)
}

// 隔离可执行文件目录，等待就绪信号并在测试结束时回收进程。
func startHelper(t *testing.T) (string, <-chan struct{}, func()) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "app.exe")
	if err := os.WriteFile(target, data, 0o700); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(target, "-test.run=^TestProcessHelper$")
	command.Env = append(os.Environ(), "LINGUAGACHA_UPDATER_HELPER=1")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { command.Wait(); close(finished) }()
	t.Cleanup(func() { stdin.Close(); command.Process.Kill(); <-finished })
	ready := make(chan error, 1)
	go func() { var one [1]byte; _, err := io.ReadFull(stdout, one[:]); ready <- err }()
	select {
	case err := <-ready:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("辅助进程未就绪")
	}
	return target, finished, func() { stdin.Close() }
}

// ZIP 条目按输入顺序创建，让测试能观察主程序的优先处理。
func makeArchive(t *testing.T, names []string) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "update.zip")
	target, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(target)
	for _, name := range names {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, name); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
	return file
}
