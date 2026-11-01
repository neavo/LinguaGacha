package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const drainTimeout = 30 * time.Second

var procIsProcessInJob = windows.NewLazySystemDLL("kernel32.dll").NewProc("IsProcessInJob") // x/sys 未提供此绑定。

// 租约跨多个顺序目标持有 Job，句柄只由监管程序关闭。
type supervisor struct {
	lock   windows.Handle
	job    windows.Handle
	thread windows.Handle // 暂停创建的线程登记后才恢复，恢复时关闭句柄。
}

// 同一真实锁文件采用稳定 Job 身份，新租约先回收旧目标。
func acquire(path string) (*supervisor, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	lock, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		return nil, errBusy
	}
	if err != nil {
		return nil, err
	}
	owner := &supervisor{lock: lock}
	// 文件句柄解析链接后的身份，使便携路径、大小写和目录链接共用同一 Job。
	buffer := make([]uint16, 32768)
	count, err := windows.GetFinalPathNameByHandle(lock, &buffer[0], uint32(len(buffer)), 0)
	if err != nil || count >= uint32(len(buffer)) {
		windows.CloseHandle(lock)
		return nil, fmt.Errorf("resolve lock identity: %w", err)
	}
	identity := strings.ToLower(windows.UTF16ToString(buffer[:count]))
	// Job 身份跨可执行文件重命名保持稳定，供新版本回收旧实例的残留进程。
	jobName, _ := windows.UTF16PtrFromString(fmt.Sprintf("Global\\LinguaGacha-Agent-%x", sha256.Sum256([]byte(identity))))
	owner.job, err = windows.CreateJobObject(nil, jobName)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		err = nil
	}
	if err == nil {
		err = owner.drain()
	}
	if err == nil {
		limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		_, err = windows.SetInformationJobObject(owner.job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits)))
	}
	if err != nil {
		return nil, errors.Join(err, owner.close())
	}
	return owner, nil
}

// 新进程暂停创建，原生 fork 则依靠 bootstrap 屏障等待登记。
func (owner *supervisor) start(command request) (int, <-chan result, error) {
	var process windows.Handle
	var pid uint32
	if command.Type == "attach" {
		pid = uint32(command.PID)
		var err error
		process, err = windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE|windows.SYNCHRONIZE|windows.PROCESS_QUERY_INFORMATION, false, pid)
		if err != nil {
			return 0, nil, fmt.Errorf("open attached process: %w", err)
		}
	} else {
		if !filepath.IsAbs(command.Executable) {
			return 0, nil, errors.New("executable must be absolute")
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
		stdin, err := os.Open(os.DevNull)
		if err != nil {
			return 0, nil, err
		}
		defer stdin.Close()
		// 只复制三个标准句柄。租约、Job 和监管管道均不进入目标进程。
		handles := make([]windows.Handle, 3)
		for index, source := range []uintptr{stdin.Fd(), stdout.Fd(), stderr.Fd()} {
			if err := windows.DuplicateHandle(windows.CurrentProcess(), windows.Handle(source), windows.CurrentProcess(), &handles[index], 0, true, windows.DUPLICATE_SAME_ACCESS); err != nil {
				return 0, nil, err
			}
			defer windows.CloseHandle(handles[index])
		}
		attributes, err := windows.NewProcThreadAttributeList(1)
		if err != nil {
			return 0, nil, err
		}
		defer attributes.Delete()
		if err := attributes.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
			return 0, nil, err
		}
		startup := windows.StartupInfoEx{ProcThreadAttributeList: attributes.List()}
		startup.Cb = uint32(unsafe.Sizeof(startup))
		startup.Flags = windows.STARTF_USESTDHANDLES
		startup.StdInput, startup.StdOutput, startup.StdErr = handles[0], handles[1], handles[2]
		arguments := []string{syscall.EscapeArg(command.Executable)}
		for _, arg := range command.Args {
			arguments = append(arguments, syscall.EscapeArg(arg))
		}
		line, err := windows.UTF16PtrFromString(strings.Join(arguments, " "))
		if err != nil {
			return 0, nil, err
		}
		executable, err := windows.UTF16PtrFromString(command.Executable)
		if err != nil {
			return 0, nil, err
		}
		cwd, err := windows.UTF16PtrFromString(command.Cwd)
		if err != nil {
			return 0, nil, err
		}
		environment, err := environmentBlock(command.Env)
		if err != nil {
			return 0, nil, err
		}
		info := windows.ProcessInformation{}
		err = windows.CreateProcess(executable, line, nil, nil, true, windows.CREATE_SUSPENDED|windows.CREATE_NO_WINDOW|windows.CREATE_UNICODE_ENVIRONMENT|windows.EXTENDED_STARTUPINFO_PRESENT, &environment[0], cwd, &startup.StartupInfo, &info)
		if err != nil {
			return 0, nil, err
		}
		owner.thread = info.Thread
		process, pid = info.Process, info.ProcessId
	}
	if err := windows.AssignProcessToJobObject(owner.job, process); err != nil {
		windows.TerminateProcess(process, 1)
		windows.WaitForSingleObject(process, windows.INFINITE)
		windows.CloseHandle(process)
		return 0, nil, fmt.Errorf("assign target to Job: %w", err)
	}
	completed := make(chan result, 1)
	go func() {
		defer windows.CloseHandle(process)
		_, err := windows.WaitForSingleObject(process, windows.INFINITE)
		if err != nil {
			completed <- result{Failure: fmt.Sprintf("wait target: %v", err)}
			return
		}
		var code uint32
		if err := windows.GetExitCodeProcess(process, &code); err != nil {
			completed <- result{Failure: fmt.Sprintf("read target exit: %v", err)}
			return
		}
		value := int(code)
		completed <- result{ExitCode: &value}
	}()
	if command.Type == "launch" {
		if err := owner.resume(); err != nil {
			return 0, nil, err
		}
	}
	return int(pid), completed, nil
}

// Windows 环境块按变量名排序，以两个 NUL 结束。
func environmentBlock(values []string) ([]uint16, error) {
	values = append([]string(nil), values...)
	sort.Slice(values, func(i, j int) bool { return strings.ToUpper(values[i]) < strings.ToUpper(values[j]) })
	var block []uint16
	for _, entry := range values {
		value, err := windows.UTF16FromString(entry)
		if err != nil {
			return nil, err
		}
		block = append(block, value...)
	}
	return append(block, 0, 0), nil
}

// 先加入 Job 再恢复线程，防止目标在监管建立前执行。
func (owner *supervisor) resume() error {
	if owner.thread == 0 {
		return nil
	}
	_, err := windows.ResumeThread(owner.thread)
	err = errors.Join(err, windows.CloseHandle(owner.thread))
	owner.thread = 0
	return err
}

// 逐成员回收使具名 Job 仍可接收下一阶段的原生 fork。
func (owner *supervisor) drain() error {
	if owner.job == 0 {
		return nil
	}
	deadline := time.Now().Add(drainTimeout)
	for {
		// 循环覆盖终止期间新产生的后代。
		capacity := 1024
		var buffer []byte
		for {
			buffer = make([]byte, 8+capacity*int(unsafe.Sizeof(uintptr(0))))
			err := windows.QueryInformationJobObject(owner.job, windows.JobObjectBasicProcessIdList, uintptr(unsafe.Pointer(&buffer[0])), uint32(len(buffer)), nil)
			if errors.Is(err, windows.ERROR_MORE_DATA) {
				capacity *= 2
				continue
			}
			if err != nil {
				return err
			}
			break
		}
		count := *(*uint32)(unsafe.Pointer(&buffer[4]))
		if count == 0 {
			return nil
		}
		ids := unsafe.Slice((*uintptr)(unsafe.Pointer(&buffer[8])), int(count))
		for _, pid := range ids {
			if err := owner.terminateMember(uint32(pid)); err != nil {
				return err
			}
		}
		if time.Now().After(deadline) {
			return errors.New("Job processes did not drain")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// PID 列表只是快照，打开句柄后复核 Job 身份，避免 PID 复用时终止无关进程。
func (owner *supervisor) terminateMember(pid uint32) error {
	process, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_INFORMATION, false, pid)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) || errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return nil // 已退出或正终止的成员由下一次 Job 查询确认。
	}
	if err != nil {
		return err
	}
	defer windows.CloseHandle(process)
	var member int32 // Win32 BOOL 固定为 32 位。
	ok, _, err := procIsProcessInJob.Call(uintptr(process), uintptr(owner.job), uintptr(unsafe.Pointer(&member)))
	if ok == 0 {
		return fmt.Errorf("check Job membership: %w", err)
	}
	if member == 0 {
		return nil
	}
	if err := windows.TerminateProcess(process, 1); err != nil && !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return err
	}
	return nil
}

// Windows 采用暂停创建，内部启动门只用于 POSIX。
func runGate() { panic("POSIX gate is not used on Windows") }

// 回收失败也关闭全部句柄，让错误进入宿主的清理回执。
func (owner *supervisor) close() error {
	err := owner.drain()
	if owner.thread != 0 {
		err = errors.Join(err, windows.CloseHandle(owner.thread))
	}
	if owner.job != 0 {
		err = errors.Join(err, windows.CloseHandle(owner.job))
	}
	if owner.lock != 0 {
		err = errors.Join(err, windows.CloseHandle(owner.lock))
	}
	return err
}
