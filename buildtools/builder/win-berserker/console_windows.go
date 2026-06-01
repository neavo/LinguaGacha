//go:build windows

package main

import (
	"io"
	"os"
	"syscall"
	"unsafe"
)

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
