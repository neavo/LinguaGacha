//go:build windows

package main

import (
	"archive/zip"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	appExecutableName                            = "app.exe"
	maxProcessPathLength                         = 32768
	invalidParameter               syscall.Errno = 87
	processWait                                  = 5 * time.Second
	sharingWait                                  = 10 * time.Second
	pollInterval                                 = 250 * time.Millisecond
	processQueryLimitedInformation               = 0x1000
	sharingViolation               syscall.Errno = 32
	lockViolation                  syscall.Errno = 33
)

// 安装目录同时确定进程清理目标和文件覆盖位置。
type berserkerPlan struct {
	zipPath   string // 下载完成的更新包
	targetDir string // 绝对安装目录
	appPath   string // 安装目录中的主程序
}

// 创建交互控制台，再执行更新流程。
func main() {
	ensureInteractiveConsole()
	os.Exit(runBerserker(os.Args[1:], os.Stdin, os.Stdout, startApp))
}

// 业务收尾在启动本进程前完成；日志与覆盖目标共用安装目录。
func runBerserker(args []string, stdin io.Reader, output io.Writer, start func(string) error) int {
	// 失败原因与操作提示按块输出，已覆盖文件时补充恢复方法。
	fail := func(err error, changed bool) int {
		bilingual(output, "更新失败 …", "Update failed …")
		fmt.Fprintf(output, "%v\n\n", err)
		if changed {
			bilingual(output, "部分程序文件可能已更新，请手动解压完整更新包覆盖安装。", "Some files may have been updated. Extract the full update package manually to repair the installation.")
		}
		bilingual(output, "按任意键关闭 …", "Press any key to close …")
		waitForAnyKey(stdin)
		return 1
	}
	plan, err := parseBerserkerPlan(args)
	if err != nil {
		return fail(err, false)
	}
	logDir := filepath.Join(plan.targetDir, "log")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fail(err, false)
	}
	logFile, err := os.Create(filepath.Join(logDir, "update.log"))
	if err != nil {
		return fail(err, false)
	}
	defer logFile.Close()
	output = io.MultiWriter(output, logFile)
	fmt.Fprintf(logFile, "Started: %s\n", time.Now().Format(time.RFC3339))
	reader, err := zip.OpenReader(plan.zipPath)
	if err != nil {
		return fail(fmt.Errorf("无法打开更新包\nCannot open update package: %w", err), false)
	}
	defer reader.Close()
	files, err := orderedFiles(reader.File, plan)
	if err != nil {
		return fail(err, false)
	}
	if err := stopAppProcesses(plan.appPath, output, logFile); err != nil {
		return fail(err, false)
	}
	bilingual(output, "正在更新 …", "Updating …")
	budget := retryBudget{remaining: sharingWait}
	changed := false
	for _, file := range files {
		destination := filepath.Join(plan.targetDir, file.Name) // 全部路径已在覆盖前校验。
		if file.FileInfo().IsDir() {
			err = os.MkdirAll(destination, 0o755)
		} else {
			err = os.MkdirAll(filepath.Dir(destination), 0o755)
			if err == nil {
				err = extractZipFile(file, destination, &budget, output, &changed)
			}
		}
		if err != nil {
			return fail(fmt.Errorf("更新文件失败\nCannot update file %s: %w", destination, err), changed)
		}
	}
	bilingual(output, "更新成功，按任意键重新启动应用 …", "Update complete, press any key to restart …")
	waitForAnyKey(stdin)
	if err := start(plan.appPath); err != nil {
		return fail(fmt.Errorf("更新已完成，但无法启动应用\nUpdate complete, but cannot start the app: %w", err), false)
	}
	return 0
}

// 参数来自 GUI 准备阶段，安装目标与要结束的程序必须指向同一目录。
func parseBerserkerPlan(args []string) (berserkerPlan, error) {
	flags := flag.NewFlagSet("win-berserker", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	zipPath := flags.String("zip", "", "release zip path")
	target := flags.String("target", "", "install target directory")
	if err := flags.Parse(args); err != nil {
		return berserkerPlan{}, err
	}
	plan := berserkerPlan{zipPath: strings.TrimSpace(*zipPath), targetDir: strings.TrimSpace(*target)}
	if plan.zipPath == "" || plan.targetDir == "" {
		return plan, errors.New("缺少 --zip 或 --target\nMissing --zip or --target")
	}
	var err error
	plan.targetDir, err = filepath.Abs(plan.targetDir)
	if err != nil {
		return plan, err
	}
	plan.appPath = filepath.Join(plan.targetDir, appExecutableName)
	return plan, nil
}

// 检查完整目录后把 app.exe 提到最前，避免其它文件先被覆盖。
func orderedFiles(files []*zip.File, plan berserkerPlan) ([]*zip.File, error) {
	appIndex := -1
	for index, file := range files {
		destination, err := resolveArchiveDestination(plan.targetDir, file.Name)
		if err != nil {
			return nil, err
		}
		if !file.FileInfo().IsDir() && strings.EqualFold(destination, plan.appPath) {
			appIndex = index
		}
	}
	if appIndex < 0 {
		return nil, errors.New("更新包缺少 app.exe\nUpdate package is missing app.exe")
	}
	ordered := make([]*zip.File, 0, len(files))
	ordered = append(ordered, files[appIndex])
	ordered = append(ordered, files[:appIndex]...)
	ordered = append(ordered, files[appIndex+1:]...)
	return ordered, nil
}

// `filepath.IsLocal` 统一校验 Windows 路径，目录根本身不能作为文件条目。
func resolveArchiveDestination(targetDir, archiveName string) (string, error) {
	if !filepath.IsLocal(archiveName) || filepath.Clean(archiveName) == "." {
		return "", fmt.Errorf("更新包包含非法路径\nInvalid archive path: %s", archiveName)
	}
	return filepath.Join(targetDir, archiveName), nil
}

// 所有文件共享占用等待预算；成功写入的耗时不消耗预算。
type retryBudget struct {
	remaining time.Duration // 多个文件累计剩余的占用等待时间
}

// 仅共享冲突消耗等待预算，每次等待按剩余时间输出倒计时。
func (budget *retryBudget) run(operation func() error, output io.Writer) error {
	lastSecond := 0
	for {
		err := operation()
		if err == nil || (!errors.Is(err, sharingViolation) && !errors.Is(err, lockViolation)) {
			return err
		}
		if budget.remaining <= 0 {
			return err
		}
		seconds := remainingSeconds(budget.remaining)
		if lastSecond == 0 {
			defer fmt.Fprintln(output) // 首次输出后登记空行，所有返回路径共用一次收尾。
			bilingual(output, "文件被占用，正在等待重试 …", "File in use, waiting to retry …")
		}
		if seconds != lastSecond {
			fmt.Fprintf(output, "%d …\n", seconds)
			lastSecond = seconds
		}
		before := time.Now()
		time.Sleep(min(pollInterval, budget.remaining))
		budget.remaining -= time.Since(before)
	}
}

// 成功打开目标即视为已改动；写入和关闭错误共同决定该文件是否成功。
func extractZipFile(file *zip.File, destination string, budget *retryBudget, output io.Writer, changed *bool) error {
	source, err := file.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	var target *os.File
	err = budget.run(func() error {
		var openErr error
		target, openErr = os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
		return openErr
	}, output)
	if err != nil {
		return err
	}
	*changed = true // 文件打开已发生截断，即使随后 CRC 或写入失败也属于部分覆盖。
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	return errors.Join(copyErr, closeErr)
}

// 进程身份和原生句柄随同一批查询结果释放。
type appProcess struct {
	pid    uint32         // 诊断日志中的进程标识
	handle syscall.Handle // 查询、等待和终止使用同一句柄，避免 PID 复用导致误杀。
}

var queryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")

// 每次重新枚举或结束清理时释放上一批句柄。
func closeProcesses(processes []appProcess) {
	for _, process := range processes {
		syscall.CloseHandle(process.handle)
	}
}

// 先按名称缩小查询，再核实完整路径；同名的其它安装目录不会进入终止集合。
func findAppProcesses(appPath string) (processes []appProcess, err error) {
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(snapshot)
	defer func() {
		if err != nil {
			closeProcesses(processes)
		}
	}()
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for scanErr := syscall.Process32First(snapshot, &entry); ; scanErr = syscall.Process32Next(snapshot, &entry) {
		if errors.Is(scanErr, syscall.ERROR_NO_MORE_FILES) {
			break
		}
		if scanErr != nil {
			return processes, scanErr
		}
		if !strings.EqualFold(syscall.UTF16ToString(entry.ExeFile[:]), filepath.Base(appPath)) {
			continue
		}
		handle, openErr := syscall.OpenProcess(processQueryLimitedInformation|syscall.SYNCHRONIZE|syscall.PROCESS_TERMINATE, false, entry.ProcessID)
		// 枚举后进程可能已经退出，直接忽略该项。
		if errors.Is(openErr, invalidParameter) {
			continue
		}
		if openErr != nil {
			return processes, fmt.Errorf("无法查询进程\nCannot inspect process PID=%d: %w", entry.ProcessID, openErr)
		}
		buffer := make([]uint16, maxProcessPathLength)
		size := uint32(len(buffer))
		ok, _, queryErr := queryFullProcessImageName.Call(uintptr(handle), 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
		if ok == 0 {
			status, _ := syscall.WaitForSingleObject(handle, 0)
			syscall.CloseHandle(handle)
			// 查询期间已经退出，句柄也已关闭。
			if status == syscall.WAIT_OBJECT_0 {
				continue
			}
			return processes, fmt.Errorf("无法查询进程路径\nCannot inspect process path PID=%d: %w", entry.ProcessID, queryErr)
		}
		if !strings.EqualFold(filepath.Clean(syscall.UTF16ToString(buffer[:size])), filepath.Clean(appPath)) {
			syscall.CloseHandle(handle)
			continue
		}
		status, waitErr := syscall.WaitForSingleObject(handle, 0)
		if waitErr != nil {
			syscall.CloseHandle(handle)
			return processes, waitErr
		}
		if status == syscall.WAIT_OBJECT_0 {
			syscall.CloseHandle(handle)
			continue
		}
		processes = append(processes, appProcess{entry.ProcessID, handle})
	}
	return processes, nil
}

// 进程退出期间可能暂时拒绝路径查询；在同一阶段期限内重查，并报告最后一次结果。
func waitCountdown(output io.Writer, duration time.Duration, chinese, english string, ready func() (bool, error)) (bool, error) {
	deadline := time.Now().Add(duration)
	lastSecond := 0
	for {
		done, err := ready()
		if err == nil && done {
			return true, nil
		}
		if err != nil && !errors.Is(err, syscall.ERROR_ACCESS_DENIED) {
			return false, err
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return false, err
		}
		seconds := remainingSeconds(remaining)
		if lastSecond == 0 {
			defer fmt.Fprintln(output) // 首次输出后登记空行，所有返回路径共用一次收尾。
			bilingual(output, chinese, english)
		}
		if seconds != lastSecond {
			fmt.Fprintf(output, "%d …\n", seconds)
			lastSecond = seconds
		}
		time.Sleep(min(pollInterval, remaining))
	}
}

// 向上取整，剩余不足一秒时仍显示 1。
func remainingSeconds(duration time.Duration) int {
	return int((duration + time.Second - 1) / time.Second)
}

// 两个退出阶段共用路径查询和句柄释放规则，强制终止仅使用已核实的进程句柄。
func stopAppProcesses(appPath string, output, diagnostics io.Writer) error {
	processes := []appProcess{}
	defer func() { closeProcesses(processes) }()
	// 每轮替换查询快照；失败时 findAppProcesses 已释放本轮句柄。
	ready := func() (bool, error) {
		closeProcesses(processes)
		processes = nil
		found, err := findAppProcesses(appPath)
		if err != nil {
			return false, err
		}
		processes = found
		return len(processes) == 0, nil
	}
	done, err := waitCountdown(output, processWait, "正在等待应用退出 …", "Waiting for the app to exit …", ready)
	if err != nil || done {
		return err
	}
	for _, process := range processes {
		fmt.Fprintf(diagnostics, "Terminate PID=%d path=%s\n", process.pid, appPath)
		if err := syscall.TerminateProcess(process.handle, 1); err != nil {
			status, _ := syscall.WaitForSingleObject(process.handle, 0)
			if status != syscall.WAIT_OBJECT_0 {
				return fmt.Errorf("无法结束进程\nCannot terminate PID=%d: %w", process.pid, err)
			}
		}
	}
	done, err = waitCountdown(output, processWait, fmt.Sprintf("正在清理残留进程，剩余 %d 秒 …", remainingSeconds(processWait)), fmt.Sprintf("Stopping remaining processes: %ds remaining …", remainingSeconds(processWait)), ready)
	if err != nil {
		return err
	}
	if !done {
		return errors.New("结束进程后等待超时\nTimed out waiting for processes to terminate")
	}
	return nil
}

// 使用安装目录作为工作目录，启动更新后的应用。
func startApp(appPath string) error {
	command := exec.Command(appPath)
	command.Dir = filepath.Dir(appPath)
	return command.Start()
}

// 控制台中文与英文分行输出，阶段之间留一行。
func bilingual(output io.Writer, chinese, english string) {
	fmt.Fprintf(output, "%s\n%s\n\n", chinese, english)
}

// 测试和重定向输入以读取一个字节表示确认。
func waitForInputByte(stdin io.Reader) {
	var buffer [1]byte
	_, _ = stdin.Read(buffer[:])
}

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	getConsoleWindow = kernel32.NewProc("GetConsoleWindow")
	allocConsole     = kernel32.NewProc("AllocConsole")
	getConsoleMode   = kernel32.NewProc("GetConsoleMode")
	setConsoleMode   = kernel32.NewProc("SetConsoleMode")
	readConsoleInput = kernel32.NewProc("ReadConsoleInputW")
)

const (
	enableLineInput = 0x0002
	enableEchoInput = 0x0004
	keyEvent        = 0x0001
	keyPressed      = 1
)

// 对齐 Windows INPUT_RECORD 的按键事件子集。
type inputRecord struct {
	eventType uint16
	_         uint16
	event     keyEventRecord
}

// 对齐 Windows KEY_EVENT_RECORD 的字段布局。
type keyEventRecord struct {
	keyDown         int32
	repeatCount     uint16
	virtualKeyCode  uint16
	virtualScanCode uint16
	unicodeChar     uint16
	controlKeyState uint32
}

// 保证 GUI 子系统启动的更新器拥有可见控制台和可读取输入。
func ensureInteractiveConsole() {
	window, _, _ := getConsoleWindow.Call()
	if window == 0 {
		if allocated, _, _ := allocConsole.Call(); allocated == 0 {
			return
		}
	}

	if stdin, err := os.OpenFile("CONIN$", os.O_RDWR, 0); err == nil {
		os.Stdin = stdin
	}
	if stdout, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
		os.Stdout = stdout
	}
	if stderr, err := os.OpenFile("CONOUT$", os.O_RDWR, 0); err == nil {
		os.Stderr = stderr
	}
}

// 在真实控制台中读取单次按键，非控制台输入回退到字节读取。
func waitForAnyKey(stdin io.Reader) {
	if file, ok := stdin.(*os.File); !ok || file != os.Stdin {
		waitForInputByte(stdin)
		return
	}

	handle := os.Stdin.Fd()
	if handle == 0 || handle == ^uintptr(0) {
		waitForInputByte(stdin)
		return
	}

	var originalMode uint32
	if ok, _, _ := getConsoleMode.Call(handle, uintptr(unsafe.Pointer(&originalMode))); ok == 0 {
		waitForInputByte(stdin)
		return
	}
	rawMode := originalMode &^ (enableLineInput | enableEchoInput)
	modeChanged, _, _ := setConsoleMode.Call(handle, uintptr(rawMode))
	if modeChanged != 0 {
		defer setConsoleMode.Call(handle, uintptr(originalMode))
	}

	for {
		var record inputRecord
		var readCount uint32
		ok, _, _ := readConsoleInput.Call(
			handle,
			uintptr(unsafe.Pointer(&record)),
			1,
			uintptr(unsafe.Pointer(&readCount)),
		)
		if ok == 0 {
			waitForInputByte(stdin)
			return
		}
		if readCount == 1 && record.eventType == keyEvent && record.event.keyDown == keyPressed {
			return
		}
	}
}
