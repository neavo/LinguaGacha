package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// npm 及其脚本借用 Electron 的解释器，不能回退到系统 Node。
func main() {
	executable := os.Getenv("LG_NODE_EXECUTABLE")
	if !filepath.IsAbs(executable) {
		fmt.Fprintln(os.Stderr, "LG_NODE_EXECUTABLE must be an absolute Electron path.")
		os.Exit(1)
	}
	command := exec.Command(executable, os.Args[1:]...)
	command.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1")
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := command.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
