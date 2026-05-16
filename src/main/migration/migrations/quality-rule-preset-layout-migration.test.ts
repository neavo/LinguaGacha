import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogManager } from "../../log/log-manager";
import { AppPathService } from "../../service/path-service";
import { JsonTool } from "../../../shared/utils/json-tool";
import {
  QualityRulePresetLayoutMigration,
  quality_rule_preset_layout_migration,
} from "./quality-rule-preset-layout-migration";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-quality-migration-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("quality_rule_preset_layout_migration", () => {
  it("迁移质量规则用户预设、builtin 布局并归一默认预设值", () => {
    const context = create_context();
    write_file(path.join(temp_dir, "resource", "preset", "glossary", "user", "mine.json"), "[]");
    write_file(path.join(temp_dir, "resource", "preset", "glossary", "zh", "base.json"), "[]");
    write_file(
      path.join(temp_dir, "userdata", "config.json"),
      JsonTool.stringifyStrict({
        glossary_default_preset: "resource/preset/glossary/zh/base.json",
        text_preserve_default_preset: "resource/preset/text_preserve/user/mine.json",
      }),
    );

    quality_rule_preset_layout_migration.run_startup?.(context);

    expect(fs.existsSync(path.join(temp_dir, "userdata", "glossary", "mine.json"))).toBe(true);
    expect(fs.existsSync(path.join(temp_dir, "resource", "glossary", "preset", "base.json"))).toBe(
      true,
    );
    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir, "userdata", "config.json"))),
    ).toEqual({
      glossary_default_preset: "builtin:base.json",
      text_preserve_default_preset: "user:mine.json",
    });
  });

  it("把三段式 builtin 标识归一为当前虚拟 ID", () => {
    const context = create_context();
    const [normalized, changed] = QualityRulePresetLayoutMigration.normalize_setting_payload(
      context,
      {
        post_translation_replacement_default_preset: "builtin:zh:post.json",
      },
    );

    expect(changed).toBe(true);
    expect(normalized).toEqual({
      post_translation_replacement_default_preset: "builtin:post.json",
    });
  });
});

/**
 * 质量规则预设测试用真实路径服务覆盖旧目录、当前目录和配置归一三条路径。
 */
function create_context() {
  return {
    paths: new AppPathService({ appRoot: temp_dir }),
    log_manager: { warning(): void {} } as unknown as LogManager,
  };
}

/**
 * 质量规则预设夹具统一写真实文件，验证迁移后的物理落点。
 */
function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}
