import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { prompt_user_preset_layout_migration } from "./prompt-user-preset-layout-migration";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-prompt-migration-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("prompt_user_preset_layout_migration", () => {
  it("把旧中英文翻译提示词用户预设合并到当前目录", () => {
    const context = create_context();
    write_file(
      path.join(temp_dir, "resource", "preset", "custom_prompt", "user", "zh", "a.txt"),
      "中文",
    );
    write_file(
      path.join(temp_dir, "resource", "preset", "custom_prompt", "user", "en", "b.txt"),
      "英文",
    );

    prompt_user_preset_layout_migration.run_startup?.(context);

    expect(
      fs.readFileSync(path.join(temp_dir, "userdata", "translation_prompt", "a.txt"), "utf-8"),
    ).toBe("中文");
    expect(
      fs.readFileSync(path.join(temp_dir, "userdata", "translation_prompt", "b.txt"), "utf-8"),
    ).toBe("英文");
  });
});

/**
 * 提示词预设迁移依赖 AppPathService 解析当前 userdata 目标目录。
 */
function create_context() {
  return {
    paths: new AppPathService({ appRoot: temp_dir }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

/**
 * 测试旧语言目录时统一创建父目录，避免夹具噪音遮住迁移行为。
 */
function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}
