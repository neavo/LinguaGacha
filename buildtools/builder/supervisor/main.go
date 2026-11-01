package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
)

// 宿主通过独立控制管道提交目标，参数不经过 shell 解释。
type request struct {
	Type       string   `json:"type"`
	PID        int      `json:"pid"`
	Executable string   `json:"executable"`
	Args       []string `json:"args"`
	Cwd        string   `json:"cwd"`
	Env        []string `json:"env"`
	Stdout     string   `json:"stdout"`
	Stderr     string   `json:"stderr"`
}

// 目标退出与监管故障分别表达，避免将回收失败当作正常退出。
type result struct {
	Failure  string  `json:"-"`
	ExitCode *int    `json:"exitCode"`
	Signal   *string `json:"signal"`
}

var outputMu sync.Mutex // 控制回执必须保持完整 JSON 行。

// 多个结束路径共用控制输出，目标 stdout/stderr 已重定向到日志文件。
func emit(value any) {
	outputMu.Lock()
	defer outputMu.Unlock()
	if err := json.NewEncoder(os.Stdout).Encode(value); err != nil {
		// 控制管道关闭时 main 的输入也会关闭，统一走延迟回收。
		fmt.Fprintln(os.Stderr, err)
	}
}

// 启动门属于 POSIX 内部协议，其余入口负责持有系统租约。
func main() {
	if len(os.Args) > 1 && os.Args[1] == "--gate" {
		runGate()
		return
	}
	if err := run(); err != nil {
		code := "runtime.failed"
		if errors.Is(err, errBusy) {
			code = "runtime.busy"
		}
		emit(map[string]any{"type": "fault", "code": code, "message": err.Error()})
		os.Exit(1)
	}
}

var errBusy = errors.New("shared Node environment is busy")

// 一条控制管道拥有租约和多个顺序目标；目标收尾后仍等宿主释放租约。
func run() (failure error) {
	if len(os.Args) != 2 {
		return errors.New("expected lock path")
	}
	owner, err := acquire(os.Args[1])
	if err != nil {
		return err
	}
	defer func() { failure = errors.Join(failure, owner.close()) }()
	emit(map[string]any{"type": "leased"})
	commands := make(chan request)
	inputFailure := make(chan error, 1)
	go func() {
		defer close(commands)
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 4096), 16*1024*1024)
		for scanner.Scan() {
			var command request
			if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
				inputFailure <- err
				return
			}
			commands <- command
		}
		if err := scanner.Err(); err != nil {
			inputFailure <- err
		}
	}()
	var completed <-chan result
	for {
		select {
		case err := <-inputFailure:
			return err
		case status := <-completed:
			if status.Failure != "" {
				return errors.New(status.Failure)
			}
			completed = nil
			emit(map[string]any{"type": "exited", "exitCode": status.ExitCode, "signal": status.Signal})
			if err := owner.drain(); err != nil {
				return err
			}
			emit(map[string]any{"type": "drained"})
		case command, ok := <-commands:
			if !ok {
				return nil
			}
			switch command.Type {
			case "launch", "attach":
				if completed != nil {
					return errors.New("target is already running")
				}
				pid, done, err := owner.start(command)
				if err != nil {
					return err
				}
				completed = done
				emit(map[string]any{"type": "ready", "pid": pid})
			case "resume":
				if err := owner.resume(); err != nil {
					return err
				}
			case "stop":
				if err := owner.drain(); err != nil {
					return err
				}
			case "release":
				if completed != nil {
					return errors.New("cannot release an active target")
				}
				if err := owner.drain(); err != nil {
					return err
				}
				emit(map[string]any{"type": "released"})
				return nil
			default:
				return fmt.Errorf("invalid command: %s", command.Type)
			}
		}
	}
}
