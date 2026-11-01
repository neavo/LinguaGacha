import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { default_native_fs } from "../../native/native-fs";
import {
  read_agent_process_output,
  watch_agent_process_output,
  type AgentProcessOutputTail,
} from "./process-output";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./workspace/runtime/policy";

let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "lg-process-output-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

it("完整 JSON 对象和数组投影为结构化内容", () => {
  fs.writeFileSync(path.join(directory, "out"), ' {"items":[{"id":1}]}\n');
  fs.writeFileSync(path.join(directory, "err"), '[{"code":"notice"}]\n');
  expect(read_agent_process_output(directory, "out")).toMatchObject({
    path: "out",
    content: { items: [{ id: 1 }] },
  });
  expect(read_agent_process_output(directory, "err")).toMatchObject({
    content: [{ code: "notice" }],
  });
});

it.each(["123\n", '"{}"\n', 'progress\n{"ok":true}\n'])("标量和混合日志保留原文：%j", (text) => {
  fs.writeFileSync(path.join(directory, "out"), text);
  expect(read_agent_process_output(directory, "out")).toMatchObject({ content: text });
});

it("按字节独立限制每路输出，超限文件不读入内存", () => {
  const json = '{"value":true}'.padEnd(AGENT_WORKSPACE_RUNTIME_POLICY.inlineOutputBytes, " ");
  const large = `${json}末尾`;
  fs.writeFileSync(path.join(directory, "out"), large);
  fs.writeFileSync(path.join(directory, "err"), json);
  const read = vi.spyOn(default_native_fs, "read_text_file");
  expect(read_agent_process_output(directory, "out")).toEqual({
    path: "out",
    bytes: Buffer.byteLength(large),
    message: expect.any(String),
  });
  expect(read).not.toHaveBeenCalledWith(path.join(directory, "out"));
  expect(read_agent_process_output(directory, "err")).toEqual({
    path: "err",
    bytes: Buffer.byteLength(json),
    content: { value: true },
  });
});

it("监视日志末尾：截断处丢弃残片，回车进度折叠为一行，摘要取本次增长的一路，中止后退出", async () => {
  // 截断点落在只有回车的进度序列中，窗口内仍要留下完整的最新进度。
  fs.writeFileSync(
    path.join(directory, "out"),
    `${"进度 10%\r".repeat(2000)}第一行\r\n进度 10%\r进度 100%\n`,
  );
  const outputs: AgentProcessOutputTail[] = [];
  const controller = new AbortController();
  const watching = watch_agent_process_output(
    directory,
    { stdoutPath: "out", stderrPath: "err" }, // stderr 尚不存在，按空内容处理
    (output) => outputs.push(output),
    controller.signal,
  );
  const stdout = "第一行\n进度 100%\n";
  await vi.waitFor(() => expect(outputs).toEqual([{ stdout, stderr: "", line: "进度 100%" }]));
  fs.writeFileSync(path.join(directory, "err"), "警告\n");
  await vi.waitFor(() =>
    expect(outputs.at(-1)).toEqual({ stdout, stderr: "警告\n", line: "警告" }),
  );
  controller.abort();
  await expect(watching).resolves.toBeUndefined();
});
