//go:build windows

package main

import (
	"bytes"
	"testing"
)

// 证明非控制台输入走单字节兜底。
func TestWaitForAnyKeyFallsBackForNonConsoleInput(t *testing.T) {
	stdin := bytes.NewBufferString("x")

	waitForAnyKey(stdin)

	if stdin.Len() != 0 {
		t.Fatalf("剩余输入长度 = %d，期望 0", stdin.Len())
	}
}
