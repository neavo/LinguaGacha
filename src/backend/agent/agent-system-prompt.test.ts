import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NativeFs } from "../../native/native-fs";
import { FileIoFailedError, InvalidFileStructureError } from "../../shared/error";
import { AppPathService } from "../app/app-path-service";
import { load_agent_system_prompt } from "./agent-system-prompt";

const cleanup_roots: string[] = [];

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("Agent system prompt 加载", () => {
  it("从内置资源读取并裁剪首尾空白", () => {
    const paths = create_paths();
    write_system_prompt(paths, "\n  基础系统指令。\n第二行。  \n");

    expect(load_agent_system_prompt(paths, new NativeFs())).toBe("基础系统指令。\n第二行。");
  });

  it("资源缺失时保留原始读取异常", () => {
    const paths = create_paths();
    let thrown: unknown;

    try {
      load_agent_system_prompt(paths, new NativeFs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FileIoFailedError);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });

  it("资源内容为空时拒绝启动", () => {
    const paths = create_paths();
    write_system_prompt(paths, " \r\n\t");

    expect(() => load_agent_system_prompt(paths, new NativeFs())).toThrow(
      InvalidFileStructureError,
    );
  });
});

function create_paths(): AppPathService {
  const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-prompt-"));
  cleanup_roots.push(app_root);
  return new AppPathService({ appRoot: app_root, env: {}, platform: "win32" });
}

function write_system_prompt(paths: AppPathService, content: string): void {
  const file_path = paths.get_agent_system_prompt_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf-8");
}
