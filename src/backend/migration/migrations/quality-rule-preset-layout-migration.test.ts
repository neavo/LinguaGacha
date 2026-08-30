import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../app/app-path-service";
import { JsonTool } from "../../../shared/utils/json-tool";
import {
  normalize_quality_rule_preset_setting_payload,
  quality_rule_preset_layout_migration,
} from "./quality-rule-preset-layout-migration";

describe("quality_rule_preset_layout_migration", () => {
  it("迁移质量规则用户预设，并只用旧 builtin 路径归一默认预设值", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-quality-migration-"),
    );
    const context = create_context(temp_dir.path);
    write_file(
      path.join(temp_dir.path, "resource", "preset", "glossary", "user", "mine.json"),
      "[]",
    );
    write_file(path.join(temp_dir.path, "resource", "preset", "glossary", "zh", "base.json"), "[]");
    write_file(
      path.join(temp_dir.path, "userdata", "config.json"),
      JsonTool.stringifyStrict({
        glossary_default_preset: "resource/preset/glossary/zh/base.json",
        text_preserve_default_preset: "resource/preset/text_preserve/user/mine.json",
      }),
    );

    quality_rule_preset_layout_migration.run_startup?.(context);

    expect(fs.existsSync(path.join(temp_dir.path, "userdata", "glossary", "mine.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(temp_dir.path, "builtin", "glossary", "preset", "base.json")),
    ).toBe(false);
    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir.path, "userdata", "config.json"))),
    ).toEqual({
      glossary_default_preset: "builtin:base.json",
      text_preserve_default_preset: "user:mine.json",
    });
  });

  it("把三段式 builtin 标识归一为当前虚拟 ID", () => {
    using temp_dir = fs.mkdtempDisposableSync(
      path.join(os.tmpdir(), "linguagacha-quality-migration-"),
    );
    const context = create_context(temp_dir.path);
    const [normalized, changed] = normalize_quality_rule_preset_setting_payload(context, {
      post_translation_replacement_default_preset: "builtin:zh:post.json",
    });

    expect(changed).toBe(true);
    expect(normalized).toEqual({
      post_translation_replacement_default_preset: "builtin:post.json",
    });
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
