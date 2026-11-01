//go:build linux || darwin

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// 租约与宿主共享，进程组覆盖根进程退出后的遗留成员。
type supervisor struct {
	lock  *os.File
	group int
	gate  *os.File // 宿主登记进程组后才写入启动许可。
}

// fd 3 与宿主共享同一打开文件描述，任意一方存活都继续持锁。
func acquire(_ string) (*supervisor, error) {
	lock := os.NewFile(3, "node.lock")
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return nil, errBusy
		}
		return nil, err
	}
	return &supervisor{lock: lock}, nil
}

// 启动门等待登记，原生 fork 已由 bootstrap 提供同样的屏障。
func (owner *supervisor) start(command request) (int, <-chan result, error) {
	completed := make(chan result, 1)
	if command.Type == "attach" {
		owner.group = command.PID
		go func() {
			for unix.Kill(command.PID, 0) == nil {
				time.Sleep(10 * time.Millisecond)
			}
			completed <- result{}
		}()
		return command.PID, completed, nil
	}
	stdout, err := os.OpenFile(command.Stdout, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return 0, nil, err
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(command.Stderr, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return 0, nil, err
	}
	defer stderr.Close()
	read, write, err := os.Pipe()
	if err != nil {
		return 0, nil, err
	}
	defer read.Close()
	executable, err := os.Executable()
	if err != nil {
		write.Close()
		return 0, nil, err
	}
	child := exec.Command(executable, append([]string{"--gate", command.Executable}, command.Args...)...)
	child.Dir, child.Env = command.Cwd, command.Env
	child.Stdout, child.Stderr = stdout, stderr
	child.ExtraFiles = []*os.File{read}
	child.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := child.Start(); err != nil {
		write.Close()
		return 0, nil, err
	}
	owner.group, owner.gate = child.Process.Pid, write
	go func() {
		child.Wait() // 非零退出由状态回执表达。
		if child.ProcessState == nil {
			completed <- result{Failure: "could not wait for target"}
			return
		}
		code := child.ProcessState.ExitCode()
		status := result{ExitCode: &code}
		if state, ok := child.ProcessState.Sys().(syscall.WaitStatus); ok && state.Signaled() {
			name := state.Signal().String()
			status.ExitCode, status.Signal = nil, &name
		}
		completed <- status
	}()
	return owner.group, completed, nil
}

// 写入许可后关闭门句柄，控制连接失效时未放行的目标自动退出。
func (owner *supervisor) resume() error {
	if owner.gate == nil {
		return nil
	}
	_, err := owner.gate.Write([]byte{1})
	err = errors.Join(err, owner.gate.Close())
	owner.gate = nil
	return err
}

// 回收整个进程组，根进程结束不能作为释放共享环境的依据。
func (owner *supervisor) drain() error {
	if owner.gate != nil {
		owner.gate.Close()
		owner.gate = nil
	}
	if owner.group == 0 {
		return nil
	}
	if err := unix.Kill(-owner.group, unix.SIGKILL); err != nil && !errors.Is(err, unix.ESRCH) {
		return err
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		err := unix.Kill(-owner.group, 0)
		if errors.Is(err, unix.ESRCH) {
			owner.group = 0
			return nil
		}
		if err != nil {
			return err
		}
		if time.Now().After(deadline) {
			return errors.New("process group did not drain")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// 监管程序仅关闭自己的锁描述，宿主仍可继续持锁收尾。
func (owner *supervisor) close() error {
	return errors.Join(owner.drain(), owner.lock.Close())
}

// 启动门在监管管道关闭时直接退出，宿主登记进程组后才允许真正执行。
func runGate() {
	gate := os.NewFile(3, "launch gate")
	var token [1]byte
	_, err := io.ReadFull(gate, token[:])
	gate.Close()
	if err == nil && len(os.Args) >= 3 {
		err = syscall.Exec(os.Args[2], os.Args[2:], os.Environ())
	}
	fmt.Fprintln(os.Stderr, "launch gate:", err)
	os.Exit(1)
}
