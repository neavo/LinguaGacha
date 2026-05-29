import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogManager } from "../log/log-manager";
import { PathRelocation } from "./path-relocation";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-path-relocation-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("PathRelocation", () => {
  it("目标不存在时复制旧源并删除旧源", () => {
    const relocation = new PathRelocation(create_log_manager());
    const source_path = path.join(temp_dir, "legacy", "demo.txt");
    const destination_path = path.join(temp_dir, "userdata", "demo.txt");
    write_file(source_path, "旧内容");

    relocation.relocate_path_if_needed(source_path, destination_path);

    expect(fs.readFileSync(destination_path, "utf-8")).toBe("旧内容");
    expect(fs.existsSync(source_path)).toBe(false);
  });

  it("目标已存在时保留当前事实并清理旧源", () => {
    const relocation = new PathRelocation(create_log_manager());
    const source_path = path.join(temp_dir, "legacy", "demo.txt");
    const destination_path = path.join(temp_dir, "userdata", "demo.txt");
    write_file(source_path, "旧内容");
    write_file(destination_path, "当前内容");

    relocation.relocate_path_if_needed(source_path, destination_path);

    expect(fs.readFileSync(destination_path, "utf-8")).toBe("当前内容");
    expect(fs.existsSync(source_path)).toBe(false);
  });

  it("只迁移指定扩展名并保留非预设材料", () => {
    const relocation = new PathRelocation(create_log_manager());
    const source_dir = path.join(temp_dir, "resource", "preset");
    const destination_dir = path.join(temp_dir, "userdata", "preset");
    write_file(path.join(source_dir, "story.txt"), "预设");
    write_file(path.join(source_dir, "readme.md"), "说明");

    relocation.relocate_directory_items(source_dir, destination_dir, ".txt", [temp_dir]);

    expect(fs.readFileSync(path.join(destination_dir, "story.txt"), "utf-8")).toBe("预设");
    expect(fs.existsSync(path.join(source_dir, "story.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(source_dir, "readme.md"), "utf-8")).toBe("说明");
  });
});

/**
 * 路径迁移测试不验证日志内容，只需要提供 warning 出口保持真实构造路径。
 */
function create_log_manager(): LogManager {
  return {
    warning(): void {},
  } as unknown as LogManager;
}

/**
 * 测试夹具统一创建父目录，模拟旧 resource 与当前 userdata 的真实层级。
 */
function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}
