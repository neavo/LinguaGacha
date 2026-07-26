import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue } from "../../database/database-types";
import type { AppSettingService } from "../../app/app-setting-service";
import { text_preserve_mode_migration } from "./text-preserve-mode-migration";

describe("text_preserve_mode_migration", () => {
  it("旧文本保护 bool 开关写回当前 mode 枚举", async () => {
    const context = create_context({ meta: { text_preserve_enable: true } });
    const writes = (await text_preserve_mode_migration.build_project_open_writes?.(context)) ?? [];

    for (const write of writes) {
      write(context.database);
    }

    expect(context.database.set_meta).toHaveBeenCalledWith(
      "demo.lg",
      "text_preserve_mode",
      "custom",
    );
  });

  it("当前 mode 已合法时不写回旧 bool", async () => {
    const context = create_context({
      meta: { text_preserve_mode: "smart", text_preserve_enable: true },
    });

    expect(await text_preserve_mode_migration.build_project_open_writes?.(context)).toEqual([]);
  });
});

/**
 * text_preserve 迁移只依赖 meta 快照，测试 context 固定为最小 ProjectOpenMigrationContext。
 */
function create_context(options: { meta?: Record<string, DatabaseJsonValue> }) {
  const database = {
    get_all_meta: vi.fn(() => options.meta ?? {}),
    set_meta: vi.fn(),
  } as unknown as ProjectDatabase;
  return {
    project_path: "demo.lg",
    database,
    app_setting_service: { read_setting: vi.fn(() => ({})) } as unknown as AppSettingService,
  };
}
