//go:build !windows

package main

import (
	"bytes"
	"testing"
)

// 证明非 Windows 平台不会尝试分配控制台。
func TestEnsureInteractiveConsoleNoopOnNonWindows(t *testing.T) {
	ensureInteractiveConsole()
}

// 证明非 Windows 平台沿用单字节等待兜底。
func TestWaitForAnyKeyUsesByteFallbackOnNonWindows(t *testing.T) {
	stdin := bytes.NewBufferString("x")

	waitForAnyKey(stdin)

	if stdin.Len() != 0 {
		t.Fatalf("剩余输入长度 = %d，期望 0", stdin.Len())
	}
}
