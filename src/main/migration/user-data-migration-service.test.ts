import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LogManager } from "../log/log-manager";
import { AppPathService } from "../service/path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { UserDataMigrationService } from "./user-data-migration-service";

let temp_dir = "";

interface FakeLogManager {
  warning_messages: string[];
  warning_payloads: unknown[];
  manager: LogManager;
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-user-data-migration-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("UserDataMigrationService", () => {
  it("把旧提示词用户预设迁到当前 userdata 目录并保留新文件", () => {
    const service = create_service();
    const legacy_dir = path.join(temp_dir, "resource", "preset", "custom_prompt", "user", "zh");
    const destination_dir = path.join(temp_dir, "userdata", "translation_prompt");
    write_file(path.join(legacy_dir, "story.txt"), "old");
    write_file(path.join(legacy_dir, "readme.md"), "keep");
    write_file(path.join(destination_dir, "story.txt"), "new");

    service.migrate_prompt_user_presets();

    expect(fs.readFileSync(path.join(destination_dir, "story.txt"), "utf-8")).toBe("new");
    expect(fs.existsSync(path.join(legacy_dir, "story.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(legacy_dir, "readme.md"), "utf-8")).toBe("keep");
  });

  it("当前配置已存在时不会被旧默认配置覆盖", () => {
    const service = create_service();
    write_file(
      path.join(temp_dir, "userdata", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: false }),
    );
    write_file(
      path.join(temp_dir, "resource", "config.json"),
      JsonTool.stringifyStrict({ clean_ruby: true }),
    );

    service.migrate_default_config_if_needed();

    expect(
      JsonTool.parseStrict(fs.readFileSync(path.join(temp_dir, "userdata", "config.json"))),
    ).toEqual({ clean_ruby: false });
  });

  it("把旧质量规则用户预设迁到当前 userdata 目录", () => {
    const service = create_service();
    write_file(path.join(temp_dir, "resource", "preset", "glossary", "user", "mine.json"), "[]");

    service.migrate_quality_rule_user_presets();

    expect(fs.existsSync(path.join(temp_dir, "userdata", "glossary", "mine.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(temp_dir, "resource", "preset", "glossary", "user", "mine.json")),
    ).toBe(false);
  });

  it("把平铺前的质量规则 builtin 预设迁到当前 resource 目录", () => {
    const service = create_service();
    write_file(path.join(temp_dir, "resource", "preset", "glossary", "zh", "base.json"), "[]");
    write_file(
      path.join(temp_dir, "resource", "text_preserve", "preset", "en", "protect.json"),
      "[]",
    );

    service.migrate_quality_rule_builtin_layout();

    expect(fs.existsSync(path.join(temp_dir, "resource", "glossary", "preset", "base.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(temp_dir, "resource", "text_preserve", "preset", "protect.json")),
    ).toBe(true);
  });

  it("把默认预设旧路径和三段式 builtin 标识归一为当前虚拟 ID", () => {
    const service = create_service();

    const [normalized, changed] = service.normalize_setting_payload({
      glossary_default_preset: "resource/preset/glossary/zh/01_demo.json",
      text_preserve_default_preset: "resource/preset/text_preserve/user/mine.json",
      pre_translation_replacement_default_preset:
        "resource/pre_translation_replacement/preset/en/rule.json",
      post_translation_replacement_default_preset: "builtin:zh:post.json",
    });

    expect(changed).toBe(true);
    expect(normalized).toEqual({
      glossary_default_preset: "builtin:01_demo.json",
      text_preserve_default_preset: "user:mine.json",
      pre_translation_replacement_default_preset: "builtin:rule.json",
      post_translation_replacement_default_preset: "builtin:post.json",
    });
  });

  it("启动期复制旧默认配置并写回归一后的默认预设值", () => {
    const service = create_service();
    write_file(
      path.join(temp_dir, "resource", "config.json"),
      JsonTool.stringifyStrict({
        clean_ruby: true,
        glossary_default_preset: "resource/preset/glossary/zh/01_demo.json",
      }),
    );

    service.run_startup_migrations();

    const saved = JsonTool.parseStrict(
      fs.readFileSync(path.join(temp_dir, "userdata", "config.json")),
    ) as Record<string, unknown>;
    expect(saved["clean_ruby"]).toBe(true);
    expect(saved["glossary_default_preset"]).toBe("builtin:01_demo.json");
  });

  it("无法识别的旧默认预设路径会清空并记录 warning", () => {
    const log_manager = create_log_manager();
    const service = create_service(log_manager.manager);

    expect(
      service.normalize_quality_rule_default_preset_value(
        "glossary",
        "resource/not_glossary/demo.json",
      ),
    ).toBe("");
    expect(log_manager.warning_messages).toEqual([
      "归一化默认预设值失败：glossary -> resource/not_glossary/demo.json …",
    ]);
    expect(log_manager.warning_payloads).toEqual([
      expect.objectContaining({ source: "migration" }),
    ]);
  });
});

function create_service(
  log_manager: LogManager = create_log_manager().manager,
): UserDataMigrationService {
  return new UserDataMigrationService(new AppPathService({ appRoot: temp_dir }), log_manager);
}

function create_log_manager(): FakeLogManager {
  const warning_messages: string[] = [];
  const warning_payloads: unknown[] = [];
  const manager = {
    warning(message: string, payload: unknown): void {
      warning_messages.push(message);
      warning_payloads.push(payload);
    },
  } as unknown as LogManager;
  return {
    warning_messages,
    warning_payloads,
    manager,
  };
}

function write_file(file_path: string, text: string): void {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, text, "utf-8");
}
