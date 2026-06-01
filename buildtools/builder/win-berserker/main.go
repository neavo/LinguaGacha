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
	"strconv"
	"strings"
	"time"
)

const waitPidPollLimit = 300
const waitPidPollInterval = 200 * time.Millisecond

// 描述主进程传给外部更新器的最小覆盖更新计划。
type berserkerPlan struct {
	zipPath   string
	targetDir string
	appPath   string
	waitPid   int
}

// 由 Electron 脱离主进程启动，先自建控制台再执行覆盖解压和重启。
func main() {
	ensureInteractiveConsole()
	exitCode := runBerserker(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, defaultPidRunning, time.Sleep, startApp)
	os.Exit(exitCode)
}

// 执行完整更新流程，所有用户可见输出保持中英文双语。
func runBerserker(
	args []string,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	isPidRunning func(int) bool,
	sleep func(time.Duration),
	start func(string) error,
) int {
	plan, err := parseBerserkerPlan(args)
	if err != nil {
		printFailure(stderr, err)
		waitForInput(stdin)
		return 1
	}

	fmt.Fprintln(stdout, "LinguaGacha 更新器将在 3 秒后开始 ... | LinguaGacha updater will start in 3 seconds ...")
	for second := 3; second >= 1; second -= 1 {
		fmt.Fprintf(stdout, "%d ...\n", second)
		sleep(time.Second)
	}

	if plan.waitPid > 0 {
		fmt.Fprintln(stdout, "等待主程序退出 ... | Waiting for the app to exit ...")
		if err := waitForPidExit(plan.waitPid, isPidRunning, sleep); err != nil {
			printFailure(stderr, err)
			waitForInput(stdin)
			return 1
		}
	}

	fmt.Fprintln(stdout, "正在解压 ... | Extracting ...")
	if err := extractZip(plan.zipPath, plan.targetDir); err != nil {
		printFailure(stderr, err)
		waitForInput(stdin)
		return 1
	}

	fmt.Fprintln(stdout, "解压成功，按任意键重新启动应用 ... | Extracted successfully. Press any key to restart the app ...")
	waitForInput(stdin)
	if err := start(plan.appPath); err != nil {
		printFailure(stderr, err)
		waitForInput(stdin)
		return 1
	}

	return 0
}

// 收口 main 与 Go 更新器之间的 CLI 契约。
func parseBerserkerPlan(args []string) (berserkerPlan, error) {
	flags := flag.NewFlagSet("win-berserker", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	zipPath := flags.String("zip", "", "release zip path")
	targetDir := flags.String("target", "", "install target directory")
	appPath := flags.String("app", "", "app executable path")
	waitPid := flags.String("wait-pid", "0", "main app process id")
	if err := flags.Parse(args); err != nil {
		return berserkerPlan{}, err
	}

	parsedWaitPid, err := strconv.Atoi(strings.TrimSpace(*waitPid))
	if err != nil || parsedWaitPid < 0 {
		return berserkerPlan{}, errors.New("wait-pid 参数无效")
	}

	plan := berserkerPlan{
		zipPath:   strings.TrimSpace(*zipPath),
		targetDir: strings.TrimSpace(*targetDir),
		appPath:   strings.TrimSpace(*appPath),
		waitPid:   parsedWaitPid,
	}
	if plan.zipPath == "" || plan.targetDir == "" || plan.appPath == "" {
		return berserkerPlan{}, errors.New("缺少必要参数：--zip、--target、--app")
	}

	return plan, nil
}

// 等待主应用进程消失，避免覆盖仍被占用的 app.exe。
func waitForPidExit(
	pid int,
	isPidRunning func(int) bool,
	sleep func(time.Duration),
) error {
	for attempt := 0; attempt < waitPidPollLimit; attempt += 1 {
		if !isPidRunning(pid) {
			return nil
		}
		sleep(waitPidPollInterval)
	}

	return fmt.Errorf("等待主程序退出超时：pid %d", pid)
}

// 通过 Windows tasklist 查询进程状态；查询失败时按已退出处理。
func defaultPidRunning(pid int) bool {
	command := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH")
	output, err := command.Output()
	if err != nil {
		return false
	}

	return strings.Contains(string(output), fmt.Sprintf("\"%d\"", pid))
}

// 解压 release zip，并拒绝绝对路径、盘符路径和 .. 逃逸。
func extractZip(zipPath string, targetDir string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("打开更新包失败：%w", err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		destinationPath, err := resolveArchiveDestination(targetDir, file.Name)
		if err != nil {
			return err
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(destinationPath, 0o755); err != nil {
				return fmt.Errorf("创建目录失败：%w", err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destinationPath), 0o755); err != nil {
			return fmt.Errorf("创建目录失败：%w", err)
		}
		if err := extractZipFile(file, destinationPath); err != nil {
			return err
		}
	}

	return nil
}

// 把 zip 条目限制在目标目录内部。
func resolveArchiveDestination(targetDir string, archiveName string) (string, error) {
	normalizedName := filepath.Clean(archiveName)
	if archiveName == "" ||
		strings.HasPrefix(archiveName, "/") ||
		strings.HasPrefix(archiveName, "\\") ||
		filepath.IsAbs(archiveName) ||
		filepath.VolumeName(archiveName) != "" ||
		normalizedName == "." ||
		normalizedName == ".." ||
		strings.HasPrefix(normalizedName, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("更新包包含非法路径：%s", archiveName)
	}

	destinationPath := filepath.Join(targetDir, normalizedName)
	relativePath, err := filepath.Rel(targetDir, destinationPath)
	if err != nil {
		return "", fmt.Errorf("解析更新包路径失败：%w", err)
	}
	if relativePath == ".." ||
		strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) ||
		filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("更新包路径逃逸目标目录：%s", archiveName)
	}

	return destinationPath, nil
}

// 覆盖写入单个文件条目。
func extractZipFile(file *zip.File, destinationPath string) error {
	source, err := file.Open()
	if err != nil {
		return fmt.Errorf("读取更新包文件失败：%w", err)
	}
	defer source.Close()

	target, err := os.OpenFile(destinationPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
	if err != nil {
		return fmt.Errorf("写入目标文件失败：%w", err)
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return fmt.Errorf("复制更新文件失败：%w", err)
	}
	return nil
}

// 启动更新后的 app.exe，继承独立进程生命周期。
func startApp(appPath string) error {
	command := exec.Command(appPath)
	return command.Start()
}

// 输出双语失败原因，保证脱离 Electron 后用户仍能看懂错误。
func printFailure(stderr io.Writer, err error) {
	fmt.Fprintf(stderr, "更新失败：%v | Update failed: %v\n", err, err)
}

// 等待用户确认，避免控制台错误信息闪退。
func waitForInput(stdin io.Reader) {
	waitForAnyKey(stdin)
}

// 为测试、管道和非交互输入提供单字节等待兜底。
func waitForInputByte(stdin io.Reader) {
	var buffer [1]byte
	_, _ = stdin.Read(buffer[:])
}
