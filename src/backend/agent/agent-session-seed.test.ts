import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NativeFs } from "../../native/native-fs";
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

    expect(() => load_agent_session_seed(paths, new NativeFs())).not.toThrow();
  });

  it("读取任意顺序的消息并裁剪文本", () => {
    const paths = create_paths();
    write_seed(
      paths,
      JSON.stringify([
        { role: "assistant", content: " 第一条消息。\n" },
        { role: "assistant", content: "\t " },
        { role: "user", content: "" },
      ]),
    );

    expect(load_agent_session_seed(paths, new NativeFs())).toEqual([
      { role: "assistant", content: "第一条消息。" },
      { role: "assistant", content: "" },
      { role: "user", content: "" },
    ]);
  });

  it("消息数组为空时返回空种子", () => {
    const paths = create_paths();
    write_seed(paths, "[]");

    expect(load_agent_session_seed(paths, new NativeFs())).toEqual([]);
  });

  it("资源缺失时保留原始读取异常", () => {
    const paths = create_paths();
    let thrown: unknown;

    try {
      load_agent_session_seed(paths, new NativeFs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "file.io_failed" });
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });

  it("资源不是合法 JSON 时汇报解析失败", () => {
    const paths = create_paths();
    write_seed(paths, "{ 不是 JSON");

    expect(() => load_agent_session_seed(paths, new NativeFs())).toThrow(
      expect.objectContaining({ code: "file.parse_failed" }),
    );
  });

  it.each([
    ["仍使用旧对象格式", { user: "种子设定。", assistant: "种子确认。" }],
    ["消息项不是对象", ["种子设定。"]],
    ["消息缺少字段", [{ role: "user" }]],
    ["消息包含额外字段", [{ role: "user", content: "种子设定。", extra: true }]],
    ["role 非法", [{ role: "system", content: "种子设定。" }]],
    ["content 不是字符串", [{ role: "user", content: 1 }]],
  ])("%s 时拒绝启动", (_case_name, value) => {
    const paths = create_paths();
    write_seed(paths, JSON.stringify(value));

    expect(() => load_agent_session_seed(paths, new NativeFs())).toThrow(
      expect.objectContaining({ code: "file.invalid_structure" }),
    );
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
