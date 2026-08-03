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

    expect(load_agent_session_seed(paths, new NativeFs())).toEqual({
      user: expect.any(String),
      assistant: expect.any(String),
    });
  });

  it("读取并裁剪固定的一问一答", () => {
    const paths = create_paths();
    write_seed(paths, JSON.stringify({ user: "  种子设定。 ", assistant: " 种子确认。 " }));

    expect(load_agent_session_seed(paths, new NativeFs())).toEqual({
      user: "种子设定。",
      assistant: "种子确认。",
    });
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
    ["缺少 assistant", { user: "种子设定。" }],
    ["包含额外字段", { user: "种子设定。", assistant: "种子确认。", extra: true }],
    ["内容为空", { user: " ", assistant: "种子确认。" }],
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
