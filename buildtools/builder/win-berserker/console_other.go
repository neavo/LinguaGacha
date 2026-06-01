//go:build !windows

package main

import "io"

// 非 Windows 平台无需分配控制台。
func ensureInteractiveConsole() {}

// 非 Windows 测试环境沿用单字节等待兜底。
func waitForAnyKey(stdin io.Reader) {
	waitForInputByte(stdin)
}
