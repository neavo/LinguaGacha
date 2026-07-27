import { describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../../domain/json";
import type { ProjectDatabase } from "../../database/database-operations";
import type { AppSettingService } from "../../app/app-setting-service";
import type { ProjectOpenMigrationContext } from "../migration-types";
import { translation_prompt_legacy_slot_migration } from "./translation-prompt-legacy-slot-migration";

describe("translation_prompt_legacy_slot_migration", () => {
  it("当前提示词为空时按界面语言迁移旧提示词槽位并写入完成标记", async () => {
    const context = create_context({
      config: { app_language: "EN" },
      rule_text: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
        CUSTOM_PROMPT_EN: "legacy English prompt",
      },
    });

    await apply_writes(context);

    expect(context.database.set_rule_text).toHaveBeenCalledWith(
      "demo.lg",
      "translation_prompt",
      "legacy English prompt",
    );
    expect(context.database.set_meta).toHaveBeenCalledWith(
      "demo.lg",
      "translation_prompt_legacy_migrated",
      true,
    );
  });

  it("德语界面迁移旧提示词时复用英文槽位", async () => {
    const context = create_context({
      config: { app_language: "DE" },
      rule_text: {
        CUSTOM_PROMPT_ZH: "旧中文提示词",
        CUSTOM_PROMPT_EN: "legacy English prompt",
      },
    });

    await apply_writes(context);

    expect(context.database.set_rule_text).toHaveBeenCalledWith(
      "demo.lg",
      "translation_prompt",
      "legacy English prompt",
    );
  });

  it("当前提示词已存在时只写入完成标记", async () => {
    const context = create_context({
      rule_text: {
        translation_prompt: "当前提示词",
        CUSTOM_PROMPT_ZH: "旧中文提示词",
      },
    });

    await apply_writes(context);

    expect(context.database.set_rule_text).not.toHaveBeenCalled();
    expect(context.database.set_meta).toHaveBeenCalledWith(
      "demo.lg",
      "translation_prompt_legacy_migrated",
      true,
    );
  });

  it("迁移标记已存在时不再读取旧槽位", async () => {
    const context = create_context({
      meta: { translation_prompt_legacy_migrated: true },
      rule_text: { CUSTOM_PROMPT_ZH: "旧中文提示词" },
    });

    expect(
      await translation_prompt_legacy_slot_migration.build_project_open_writes?.(context),
    ).toEqual([]);
  });
});

/**
 * 翻译提示词迁移需要同时模拟 meta、当前槽位、旧槽位和应用语言。
 */
function create_context(options: {
  meta?: JsonRecord;
  config?: JsonRecord;
  rule_text?: Record<string, string>;
}) {
  const database = {
    get_all_meta: vi.fn(() => options.meta ?? {}),
    get_rule_text: vi.fn(
      (_project_path: string, rule_type: string) => options.rule_text?.[rule_type] ?? "",
    ),
    set_rule_text: vi.fn(),
    set_meta: vi.fn(),
  } as unknown as ProjectDatabase;
  return {
    project_path: "demo.lg",
    database,
    app_setting_service: {
      read_setting: vi.fn(() => ({ app_language: "ZH", ...options.config })),
    } as unknown as AppSettingService,
  };
}

async function apply_writes(context: ProjectOpenMigrationContext): Promise<void> {
  const writes =
    (await translation_prompt_legacy_slot_migration.build_project_open_writes?.(context)) ?? [];
  for (const write of writes) {
    write(context.database);
  }
}
