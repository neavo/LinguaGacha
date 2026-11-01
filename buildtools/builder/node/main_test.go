package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
)

func TestMain(tests *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "--launch-fixture" && os.Getenv("ELECTRON_RUN_AS_NODE") == "1" {
		input, err := io.ReadAll(os.Stdin)
		if err != nil {
			panic(err)
		}
		os.Stderr.WriteString("fixture stderr")
		json.NewEncoder(os.Stdout).Encode(struct {
			Args  []string
			Node  string
			Input string
		}{os.Args[2:], os.Getenv("ELECTRON_RUN_AS_NODE"), string(input)})
		os.Exit(7)
	}
	if os.Getenv("LG_WIN_NODE_TEST") == "launcher" {
		main()
		os.Exit(0)
	}
	os.Exit(tests.Run())
}

func TestForwardArgumentsAndExit(t *testing.T) {
	args := []string{"中文", "a b", `a"b`, `C:\end\`, ""}
	command := exec.Command(os.Args[0], append([]string{"--launch-fixture"}, args...)...)
	command.Env = append(os.Environ(), "LG_WIN_NODE_TEST=launcher", "ELECTRON_RUN_AS_NODE=", "LG_NODE_EXECUTABLE="+os.Args[0])
	command.Stdin = strings.NewReader("fixture stdin")
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if exit, ok := err.(*exec.ExitError); !ok || exit.ExitCode() != 7 {
		t.Fatalf("exit: %v, %s", err, output)
	}
	var value struct {
		Args  []string
		Node  string
		Input string
	}
	if err := json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	if value.Node != "1" || !reflect.DeepEqual(value.Args, args) || value.Input != "fixture stdin" || stderr.String() != "fixture stderr" {
		t.Fatalf("bad forwarding: %+v", value)
	}
}

func TestMissingExecutable(t *testing.T) {
	command := exec.Command(os.Args[0])
	command.Env = append(os.Environ(), "LG_WIN_NODE_TEST=launcher", "LG_NODE_EXECUTABLE=")
	output, err := command.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "absolute Electron path") {
		t.Fatalf("expected configuration failure: %v %s", err, output)
	}
}
