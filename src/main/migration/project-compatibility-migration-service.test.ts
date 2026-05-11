import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { ConfigService } from "../service/config-service";
import { ProjectCompatibilityMigrationService } from "./project-compatibility-migration-service";

type MutableJsonRecord = Record<string, DatabaseJsonValue>;

describe("ProjectCompatibilityMigrationService", () => {
  it("把旧文本保护开关和旧中文翻译提示词转换为当前工程事实", () => {
    const service = create_service({
      meta: { text_preserve_enable: true },
      rule_text_by_name: { CUSTOM_PROMPT_ZH: "旧中文提示词" },
    });

    expect(service.build_open_compatibility_operations("demo.lg")).toEqual([
      {
        name: "setMeta",
        args: { projectPath: "demo.lg", key: "text_preserve_mode", value: "custom" },
      },
      {
        name: "setRuleText",
        args: {
          projectPath: "demo.lg",
          ruleType: "translation_prompt",
          text: "旧中文提示词",
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

  it("当前提示词已存在时只写入旧迁移完成标记", () => {
    const service = create_service({
      meta: {
        text_preserve_mode: "smart",
      },
      rule_text_by_type: {
        translation_prompt: "当前提示词",
      },
      rule_text_by_name: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
      },
    });

    expect(service.build_open_compatibility_operations("demo.lg")).toEqual([
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

  it("英文界面优先迁移旧英文翻译提示词", () => {
    const service = create_service({
      config: { app_language: "EN" },
      rule_text_by_name: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
        CUSTOM_PROMPT_EN: "legacy English prompt",
      },
    });

    expect(service.build_open_compatibility_operations("demo.lg")).toContainEqual({
      name: "setRuleText",
      args: {
        projectPath: "demo.lg",
        ruleType: "translation_prompt",
        text: "legacy English prompt",
      },
    });
  });
});

function create_service(options: {
  meta?: MutableJsonRecord;
  config?: MutableJsonRecord;
  rule_text_by_type?: Record<string, string>;
  rule_text_by_name?: Record<string, string>;
}): ProjectCompatibilityMigrationService {
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
  const config_service = {
    load_config: vi.fn(() => ({
      app_language: "ZH",
      ...options.config,
    })),
  } as unknown as ConfigService;
  return new ProjectCompatibilityMigrationService(database, config_service);
}
