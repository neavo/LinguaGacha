import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { default_native_fs } from "../../native/native-fs";
import { read_agent_process_output } from "./process-output";
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
