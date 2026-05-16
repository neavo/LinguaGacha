import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../../database/database-types";
import type { SettingService } from "../../service/setting-service";
import { text_preserve_mode_migration } from "./text-preserve-mode-migration";

describe("text_preserve_mode_migration", () => {
  it("旧文本保护 bool 开关写回当前 mode 枚举", async () => {
    const context = create_context({ meta: { text_preserve_enable: true } });

    expect(text_preserve_mode_migration.build_project_open_operations?.(context)).toEqual([
      {
        name: "setMeta",
        args: { projectPath: "demo.lg", key: "text_preserve_mode", value: "custom" },
      },
    ]);
  });

  it("当前 mode 已合法时不写回旧 bool", async () => {
    const context = create_context({
      meta: { text_preserve_mode: "smart", text_preserve_enable: true },
    });

    expect(text_preserve_mode_migration.build_project_open_operations?.(context)).toEqual([]);
  });
});

/**
 * text_preserve 迁移只依赖 meta 快照，测试 context 固定为最小 ProjectOpenMigrationContext。
 */
function create_context(options: { meta?: Record<string, DatabaseJsonValue> }) {
  const database = {
    execute: vi.fn((operation: DatabaseOperation) => {
      if (operation.name === "getAllMeta") {
        return options.meta ?? {};
      }
      return null;
    }),
  } as unknown as ProjectDatabase;
  return {
    project_path: "demo.lg",
    database,
    setting_service: { load_setting: vi.fn(() => ({})) } as unknown as SettingService,
  };
}
