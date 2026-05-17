import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import type { AppSettingService } from "../../app/app-setting-service";
import { translation_prompt_legacy_slot_migration } from "./translation-prompt-legacy-slot-migration";

describe("translation_prompt_legacy_slot_migration", () => {
  it("当前提示词为空时按界面语言迁移旧提示词槽位并写入完成标记", async () => {
    const context = create_context({
      config: { app_language: "EN" },
      rule_text_by_name: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
        CUSTOM_PROMPT_EN: "legacy English prompt",
      },
    });

    expect(
      translation_prompt_legacy_slot_migration.build_project_open_operations?.(context),
    ).toEqual([
      {
        name: "setRuleText",
        args: {
          projectPath: "demo.lg",
          ruleType: "translation_prompt",
          text: "legacy English prompt",
        },
      },
      {
        name: "setMeta",
        args: {
          projectPath: "demo.lg",
          key: "translation_prompt_legacy_migrated",
          value: true,
        },
      },
    ]);
  });

  it("当前提示词已存在时只写入完成标记", async () => {
    const context = create_context({
      rule_text_by_type: { translation_prompt: "当前提示词" },
      rule_text_by_name: { CUSTOM_PROMPT_ZH: "旧中文提示词" },
    });

    expect(
      translation_prompt_legacy_slot_migration.build_project_open_operations?.(context),
    ).toEqual([
      {
        name: "setMeta",
        args: {
          projectPath: "demo.lg",
          key: "translation_prompt_legacy_migrated",
          value: true,
        },
      },
    ]);
  });

  it("迁移标记已存在时不再读取旧槽位", async () => {
    const context = create_context({
      meta: { translation_prompt_legacy_migrated: true },
      rule_text_by_name: { CUSTOM_PROMPT_ZH: "旧中文提示词" },
    });

    expect(
      translation_prompt_legacy_slot_migration.build_project_open_operations?.(context),
    ).toEqual([]);
  });
});

/**
 * 翻译提示词迁移需要同时模拟 meta、当前槽位、旧槽位和应用语言。
 */
function create_context(options: {
  meta?: Record<string, DatabaseJsonValue>;
  config?: Record<string, DatabaseJsonValue>;
  rule_text_by_type?: Record<string, string>;
  rule_text_by_name?: Record<string, string>;
}) {
  const database = {
    execute: vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return options.meta ?? {};
      }
      if (operation.name === "getRuleText") {
        return options.rule_text_by_type?.[String(operation.args?.["ruleType"] ?? "")] ?? "";
      }
      if (operation.name === "getRuleTextByName") {
        return options.rule_text_by_name?.[String(operation.args?.["ruleTypeName"] ?? "")] ?? "";
      }
      return null;
    }),
  } as unknown as ProjectDatabase;
  return {
    project_path: "demo.lg",
    database,
    app_setting_service: {
      read_setting: vi.fn(() => ({ app_language: "ZH", ...options.config })),
    } as unknown as AppSettingService,
  };
}
