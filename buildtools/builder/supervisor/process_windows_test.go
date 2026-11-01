package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestMain(tests *testing.M) {
	mode := os.Getenv("LG_PROCESS_FIXTURE")
	if mode == "supervisor" {
		main()
		os.Exit(0)
	}
	if mode == "child" {
		os.WriteFile(os.Getenv("LG_PROCESS_MARKER"), []byte("ready"), 0600)
		for {
			time.Sleep(time.Hour)
		}
	}
	if mode == "tree" || mode == "waiting-tree" {
		child := exec.Command(os.Args[0])
		child.Env = append(fixtureEnvironment(), "LG_PROCESS_FIXTURE=child")
		if err := child.Start(); err != nil {
			panic(err)
		}
		os.WriteFile(os.Getenv("LG_PROCESS_PID"), []byte(strconv.Itoa(child.Process.Pid)), 0600)
		for !fileExists(os.Getenv("LG_PROCESS_MARKER")) {
			time.Sleep(time.Millisecond)
		}
		if mode == "tree" {
			os.Exit(0)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
	os.Exit(tests.Run())
}

func fixtureEnvironment() []string {
	var result []string
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "LG_PROCESS_FIXTURE=") {
			result = append(result, entry)
		}
	}
	return result
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

func startFixture(t *testing.T, owner *supervisor, directory, mode string) (int, <-chan result) {
	t.Helper()
	pid, completed, err := owner.start(request{Type: "launch", Executable: os.Args[0], Cwd: directory, Env: append(fixtureEnvironment(), "LG_PROCESS_FIXTURE="+mode, "LG_PROCESS_PID="+filepath.Join(directory, "pid"), "LG_PROCESS_MARKER="+filepath.Join(directory, "ready")), Stdout: filepath.Join(directory, "stdout"), Stderr: filepath.Join(directory, "stderr")})
	if err != nil {
		t.Fatal(err)
	}
	return pid, completed
}

func waitFixture(t *testing.T, directory string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !fileExists(filepath.Join(directory, "ready")) {
		if time.Now().After(deadline) {
			t.Fatal("fixture did not start")
		}
		time.Sleep(time.Millisecond)
	}
	bytes, err := os.ReadFile(filepath.Join(directory, "pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(string(bytes))
	if err != nil {
		t.Fatal(err)
	}
	return pid
}

func assertExited(t *testing.T, pid int) {
	t.Helper()
	process, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(process)
	status, err := windows.WaitForSingleObject(process, 5000)
	if err != nil || status != windows.WAIT_OBJECT_0 {
		t.Fatalf("process %d is still active: %d, %v", pid, status, err)
	}
}

func TestLeaseAndDescendants(t *testing.T) {
	directory := t.TempDir()
	lock := filepath.Join(directory, "node.lock")
	owner, err := acquire(lock)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.close()
	if _, err := acquire(lock); !errors.Is(err, errBusy) {
		t.Fatalf("expected busy: %v", err)
	}
	_, completed := startFixture(t, owner, directory, "tree")
	pid := waitFixture(t, directory)
	status := <-completed
	if status.ExitCode == nil || *status.ExitCode != 0 {
		data, _ := json.Marshal(status)
		t.Fatalf("bad root exit: %s", data)
	}
	if err := owner.drain(); err != nil {
		t.Fatal(err)
	}
	assertExited(t, pid)
	if _, err := acquire(lock); !errors.Is(err, errBusy) {
		t.Fatalf("drained target released lease early: %v", err)
	}
	// 同一租约在准备完成后还要接收原生 fork，Job 不能进入 terminated 状态。
	attached := exec.Command(os.Args[0])
	attached.Env = append(fixtureEnvironment(), "LG_PROCESS_FIXTURE=child", "LG_PROCESS_MARKER="+filepath.Join(directory, "attached"))
	if err := attached.Start(); err != nil {
		t.Fatal(err)
	}
	defer attached.Wait()
	_, done, err := owner.start(request{Type: "attach", PID: attached.Process.Pid})
	if err != nil {
		attached.Process.Kill()
		t.Fatal(err)
	}
	if err := owner.drain(); err != nil {
		t.Fatal(err)
	}
	<-done
	assertExited(t, attached.Process.Pid)
}

func TestTakeoverDrainsRetainedJob(t *testing.T) {
	directory := t.TempDir()
	lock := filepath.Join(directory, "node.lock")
	owner, err := acquire(lock)
	if err != nil {
		t.Fatal(err)
	}
	var retained windows.Handle
	if err := windows.DuplicateHandle(windows.CurrentProcess(), owner.job, windows.CurrentProcess(), &retained, 0, false, windows.DUPLICATE_SAME_ACCESS); err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(retained)
	pid, completed := startFixture(t, owner, directory, "waiting-tree")
	descendant := waitFixture(t, directory)
	// 模拟监管程序退出，但外部句柄使旧 Job 仍存活。
	windows.CloseHandle(owner.job)
	windows.CloseHandle(owner.lock)
	next, err := acquire(lock)
	if err != nil {
		t.Fatal(err)
	}
	defer next.close()
	<-completed
	assertExited(t, pid)
	assertExited(t, descendant)
}

func TestTerminateMemberChecksJobIdentity(t *testing.T) {
	directory := t.TempDir()
	owner, err := acquire(filepath.Join(directory, "node.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer owner.close()
	child := exec.Command(os.Args[0])
	child.Env = append(fixtureEnvironment(), "LG_PROCESS_FIXTURE=child", "LG_PROCESS_MARKER="+filepath.Join(directory, "ready"))
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		child.Process.Kill()
		child.Wait()
	}()
	process, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(child.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(process)
	// 用不属于本 Job 的存活 PID 模拟枚举之后 PID 被复用的结果。
	if err := owner.terminateMember(uint32(child.Process.Pid)); err != nil {
		t.Fatal(err)
	}
	status, err := windows.WaitForSingleObject(process, 0)
	if err != nil || status != uint32(windows.WAIT_TIMEOUT) {
		t.Fatalf("unrelated process was terminated: %d, %v", status, err)
	}
	_, completed, err := owner.start(request{Type: "attach", PID: child.Process.Pid})
	if err != nil {
		t.Fatal(err)
	}
	if err := owner.terminateMember(uint32(child.Process.Pid)); err != nil {
		t.Fatal(err)
	}
	<-completed
	assertExited(t, child.Process.Pid)
}

func TestControlLossAndSupervisorExit(t *testing.T) {
	for _, mode := range []string{"pipe-close", "process-kill"} {
		t.Run(mode, func(t *testing.T) {
			directory := t.TempDir()
			lock := filepath.Join(directory, "node.lock")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], lock)
			command.Env = append(fixtureEnvironment(), "LG_PROCESS_FIXTURE=supervisor")
			input, err := command.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			output, err := command.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			defer command.Process.Kill()
			decoder := json.NewDecoder(output)
			var event struct{ Type string }
			if err := decoder.Decode(&event); err != nil || event.Type != "leased" {
				t.Fatalf("lease: %v %+v", err, event)
			}
			launch := request{Type: "launch", Executable: os.Args[0], Cwd: directory, Env: append(fixtureEnvironment(), "LG_PROCESS_FIXTURE=waiting-tree", "LG_PROCESS_PID="+filepath.Join(directory, "pid"), "LG_PROCESS_MARKER="+filepath.Join(directory, "ready")), Stdout: filepath.Join(directory, "out"), Stderr: filepath.Join(directory, "err")}
			if err := json.NewEncoder(input).Encode(launch); err != nil {
				t.Fatal(err)
			}
			if err := decoder.Decode(&event); err != nil || event.Type != "ready" {
				t.Fatalf("ready: %v %+v", err, event)
			}
			pid := waitFixture(t, directory)
			if mode == "pipe-close" {
				input.Close()
			} else {
				command.Process.Kill()
			}
			command.Wait()
			assertExited(t, pid)
			owner, err := acquire(lock)
			if err != nil {
				t.Fatal(err)
			}
			if err := owner.close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
