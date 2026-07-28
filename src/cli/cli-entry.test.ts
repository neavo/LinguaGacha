import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BackendWorkerExecution } from "../backend/worker/worker-execution";

const run_cli_command_mock = vi.hoisted(() => vi.fn());
const IN_PROCESS_WORKER_EXECUTION: BackendWorkerExecution = { kind: "in_process" };
const TRANSLATE_ARGV = [
  "translate",
  "--input",
  "script.txt",
  "--output-dir",
  "out",
  "--source-language",
  "JA",
  "--target-language",
  "ZH",
] as const;

vi.mock("./cli-runner", () => ({ run_cli_command: run_cli_command_mock }));

import { run_cli_entry } from "./cli-entry";

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

      await expect(
        run_cli_entry(["--version"], app_root, IN_PROCESS_WORKER_EXECUTION),
      ).resolves.toBe(0);

      expect(stdout.messages).toEqual(["1.2.3\n"]);
    } finally {
      fs.rmSync(app_root, { force: true, recursive: true });
    }
  });

  it("命令成功时透传运行配置且不追加 stdout", async () => {
    run_cli_command_mock.mockResolvedValue(undefined);
    const stdout = spy_process_write(process.stdout);

    await expect(
      run_cli_entry([...TRANSLATE_ARGV], "E:/App", IN_PROCESS_WORKER_EXECUTION),
    ).resolves.toBe(0);

    expect(run_cli_command_mock).toHaveBeenCalledWith(
      "E:/App",
      expect.objectContaining({ command: "translate" }),
      IN_PROCESS_WORKER_EXECUTION,
    );
    expect(stdout.messages).toEqual([]);
  });

  it("参数错误返回 usage 退出码并写入错误与帮助", async () => {
    const stderr = spy_process_write(process.stderr);

    await expect(run_cli_entry(["translate"], "E:/App", IN_PROCESS_WORKER_EXECUTION)).resolves.toBe(
      2,
    );

    expect(stderr.messages.join("")).toContain("Missing required option --input");
    expect(stderr.messages.join("")).toContain("全局参数 | Global Options:");
    expect(run_cli_command_mock).not.toHaveBeenCalled();
  });

  it("运行期错误返回 1 并只把错误写入 stderr", async () => {
    run_cli_command_mock.mockRejectedValue(new Error("job failed"));
    const stderr = spy_process_write(process.stderr);

    await expect(
      run_cli_entry([...TRANSLATE_ARGV], "E:/App", IN_PROCESS_WORKER_EXECUTION),
    ).resolves.toBe(1);

    expect(stderr.messages).toEqual(["job failed\n"]);
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
