import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NativeFs } from "../../native/native-fs";
import {
  FileIoFailedError,
  FileParseFailedError,
  InvalidFileStructureError,
} from "../../shared/error";
import { AppPathService } from "../app/app-path-service";
import { load_agent_session_seed } from "./agent-session-seed";

const cleanup_roots: string[] = []; // 每个用例独立建临时应用根，统一在 afterEach 回收

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("Agent 会话种子加载", () => {
  it("内置会话种子资源可直接加载", () => {
    const paths = new AppPathService({ appRoot: process.cwd(), env: {}, platform: "win32" });
    const seed = load_agent_session_seed(paths, new NativeFs());

    expect(seed.length).toBeGreaterThan(0);
    expect(seed.length % 2).toBe(0);
    expect(seed.every(({ content }) => content.length > 0)).toBe(true);
  });

  it("读取并裁剪多轮对话", () => {
    const paths = create_paths();
    write_seed(
      paths,
      JSON.stringify([
        { role: "user", content: "  第一轮设定。 " },
        { role: "assistant", content: " 第一轮确认。\n" },
        { role: "user", content: "\n第二轮设定。  " },
        { role: "assistant", content: "\t第二轮确认。 " },
      ]),
    );

    expect(load_agent_session_seed(paths, new NativeFs())).toEqual([
      { role: "user", content: "第一轮设定。" },
      { role: "assistant", content: "第一轮确认。" },
      { role: "user", content: "第二轮设定。" },
      { role: "assistant", content: "第二轮确认。" },
    ]);
  });

  it("资源缺失时保留原始读取异常", () => {
    const paths = create_paths();
    let thrown: unknown;

    try {
      load_agent_session_seed(paths, new NativeFs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FileIoFailedError);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });

  it("资源不是合法 JSON 时汇报解析失败", () => {
    const paths = create_paths();
    write_seed(paths, "{ 不是 JSON");

    expect(() => load_agent_session_seed(paths, new NativeFs())).toThrow(FileParseFailedError);
  });

  it.each([
    ["仍使用旧对象格式", { user: "种子设定。", assistant: "种子确认。" }],
    ["消息数组为空", []],
    ["消息条数为奇数", [{ role: "user", content: "种子设定。" }]],
    [
      "首条为 assistant",
      [
        { role: "assistant", content: "种子确认。" },
        { role: "user", content: "种子设定。" },
      ],
    ],
    [
      "连续两条 user",
      [
        { role: "user", content: "第一条设定。" },
        { role: "user", content: "第二条设定。" },
      ],
    ],
    ["消息项不是对象", ["种子设定。", { role: "assistant", content: "种子确认。" }]],
    ["消息缺少字段", [{ role: "user" }, { role: "assistant", content: "种子确认。" }]],
    [
      "消息包含额外字段",
      [
        { role: "user", content: "种子设定。", extra: true },
        { role: "assistant", content: "种子确认。" },
      ],
    ],
    [
      "role 非法",
      [
        { role: "system", content: "种子设定。" },
        { role: "assistant", content: "种子确认。" },
      ],
    ],
    [
      "content 不是字符串",
      [
        { role: "user", content: 1 },
        { role: "assistant", content: "种子确认。" },
      ],
    ],
    [
      "content 只有空白",
      [
        { role: "user", content: " " },
        { role: "assistant", content: "种子确认。" },
      ],
    ],
  ])("%s 时拒绝启动", (_case_name, value) => {
    const paths = create_paths();
    write_seed(paths, JSON.stringify(value));

    expect(() => load_agent_session_seed(paths, new NativeFs())).toThrow(InvalidFileStructureError);
  });
});

function create_paths(): AppPathService {
  const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-seed-"));
  cleanup_roots.push(app_root);
  return new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
}

function write_seed(paths: AppPathService, content: string): void {
  const file_path = paths.get_agent_session_seed_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf-8");
}
