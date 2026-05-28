import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CLICommandOptions } from "./cli-parser";
import type { CoreWorkerExecution } from "../core/worker/core-worker-execution";

const run_cli_command_mock = vi.hoisted(() => {
  return vi.fn();
});
const IN_PROCESS_WORKER_EXECUTION: CoreWorkerExecution = { kind: "in_process" }; // CLI entry 测试 mock 真实 job，只需传递显式执行契约

vi.mock("./cli-runner", () => {
  return {
    run_cli_command: run_cli_command_mock,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  run_cli_command_mock.mockReset();
});

describe("run_cli_entry", () => {
  it("读取发布目录 version.txt 并把版本写到 stdout", async () => {
    const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-cli-entry-"));
    const stdout = spy_process_write(process.stdout);
    try {
      fs.writeFileSync(path.join(app_root, "version.txt"), "1.2.3\n", "utf-8");
      const { run_cli_entry } = await import("./cli-entry");

      await expect(
        run_cli_entry(["--version"], app_root, IN_PROCESS_WORKER_EXECUTION),
      ).resolves.toBe(0);

      expect(stdout.messages).toEqual(["1.2.3\n"]);
    } finally {
      fs.rmSync(app_root, { force: true, recursive: true });
    }
  });

  it("执行命令时不再把产物路径作为 stdout 协议输出", async () => {
    run_cli_command_mock.mockResolvedValue(undefined);
    const stdout = spy_process_write(process.stdout);
    const { run_cli_entry } = await import("./cli-entry");

    await expect(
      run_cli_entry(
        [
          "translate",
          "--input",
          "script.txt",
          "--output-dir",
          "out",
          "--source-language",
          "JA",
          "--target-language",
          "ZH",
        ],
        "E:/App",
        IN_PROCESS_WORKER_EXECUTION,
      ),
    ).resolves.toBe(0);

    expect(run_cli_command_mock).toHaveBeenCalledWith(
      "E:/App",
      {
        command: "translate",
        inputPaths: ["script.txt"],
        outputDir: "out",
        sourceLanguage: "JA",
        targetLanguage: "ZH",
        resources: {
          promptPath: null,
          glossaryPath: null,
          preReplacementPath: null,
          postReplacementPath: null,
          textPreservePath: null,
        },
      } satisfies CLICommandOptions,
      IN_PROCESS_WORKER_EXECUTION,
    );
    expect(stdout.messages).toEqual([]);
  });

  it("参数错误返回 usage 退出码并写入 stderr", async () => {
    const stderr = spy_process_write(process.stderr);
    const { run_cli_entry } = await import("./cli-entry");

    await expect(run_cli_entry(["translate"], "E:/App", IN_PROCESS_WORKER_EXECUTION)).resolves.toBe(
      2,
    );

    expect(stderr.messages.join("")).toContain("Missing required option --input");
    expect(stderr.messages.join("")).toContain("全局参数 | Global Options:");
    expect(stderr.messages.join("")).toContain("更多说明 | More Info:");
    expect(run_cli_command_mock).not.toHaveBeenCalled();
  });
});

function spy_process_write(stream: NodeJS.WriteStream): { messages: string[] } {
  const messages: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
    messages.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  });
  return { messages };
}
