import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { prompt_user_preset_layout_migration } from "./prompt-user-preset-layout-migration";

describe("prompt_user_preset_layout_migration", () => {
  it("把旧中英文翻译提示词用户预设合并到当前目录", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-prompt-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_file(
      path.join(temp_dir.path, "resource", "preset", "custom_prompt", "user", "zh", "a.txt"),
      "中文",
    );
    write_file(
      path.join(temp_dir.path, "resource", "preset", "custom_prompt", "user", "en", "b.txt"),
      "英文",
    );

    prompt_user_preset_layout_migration.run_startup?.(context);

    expect(
      fs.readFileSync(path.join(temp_dir.path, "userdata", "translation_prompt", "a.txt"), "utf-8"),
    ).toBe("中文");
    expect(
      fs.readFileSync(path.join(temp_dir.path, "userdata", "translation_prompt", "b.txt"), "utf-8"),
    ).toBe("英文");
  });
});

function create_context(app_root: string) {
  return {
    paths: new AppPathService({
      appRoot: app_root,
      builtinRoot: path.join(app_root, "builtin"),
    }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}
