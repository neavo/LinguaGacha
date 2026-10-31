package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const appExecutableName = "app.exe" // cli.exe 与 app.exe 固定同目录，避免 PATH 或安装器语义进入启动器

// 描述 cli.exe 交给同目录 app.exe 的转发计划。
type launcherPlan struct {
	executablePath string   // executablePath 指向同目录 Electron GUI 主程序
	args           []string // args 固定以 --cli 开头，后面保留用户原始参数顺序
}

// 作为 Windows console 子系统入口，只负责转发并返回 app.exe 的退出码。
func main() {
	exitCode, err := runLauncher(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	os.Exit(exitCode)
}

// 定位同目录 app.exe，继承当前终端 IO，并等待 CLI 任务结束。
func runLauncher(userArgs []string) (int, error) {
	currentExecutablePath, err := os.Executable()
	if err != nil {
		return 1, fmt.Errorf("无法定位 cli.exe：%w", err)
	}

	plan, err := buildLauncherPlan(currentExecutablePath, userArgs)
	if err != nil {
		return 1, err
	}
	if err := ensureAppExecutableExists(plan.executablePath); err != nil {
		return 1, err
	}

	command := exec.Command(plan.executablePath, plan.args...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr

	return normalizeExitResult(command.Run())
}

// 只做参数计划，保证 Windows Unicode、空格和引号都交给 exec.Command 处理。
func buildLauncherPlan(currentExecutablePath string, userArgs []string) (launcherPlan, error) {
	if currentExecutablePath == "" {
		return launcherPlan{}, errors.New("cli.exe 路径为空")
	}

	executableDir := filepath.Dir(currentExecutablePath)
	args := make([]string, 0, len(userArgs)+1)
	args = append(args, "--cli")
	args = append(args, userArgs...)

	return launcherPlan{
		executablePath: filepath.Join(executableDir, appExecutableName),
		args:           args,
	}, nil
}

// 在启动前确认同目录 app.exe 存在，避免 exec.Command 返回难读的系统错误。
func ensureAppExecutableExists(appPath string) error {
	if _, err := os.Stat(appPath); err != nil {
		return fmt.Errorf("找不到 GUI 主程序 %s：%w", appPath, err)
	}
	return nil
}

// 保留 app.exe 的退出码；启动失败才归一为 1。
func normalizeExitResult(err error) (int, error) {
	if err == nil {
		return 0, nil
	}

	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return exitError.ExitCode(), nil
	}
	return 1, err
}
