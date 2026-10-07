import { expect, it, vi } from "vitest";
import type { JsonRecord, JsonValue } from "../../../domain/json";
import type { ProjectOpenMigrationContext } from "../migration-types";
import { quality_settings_migration } from "./quality-settings-migration";

it.each([
  [
    {},
    [
      ["text_preserve_mode", "smart"],
      ["glossary_enable", true],
    ],
  ],
  [
    { text_preserve_enable: true },
    [
      ["text_preserve_mode", "custom"],
      ["glossary_enable", true],
    ],
  ],
  [{ text_preserve_mode: "invalid", glossary_enable: false }, [["text_preserve_mode", "smart"]]],
  [{ text_preserve_mode: "smart", text_preserve_enable: true, glossary_enable: false }, []],
] satisfies [JsonRecord, unknown[]][])(
  "物化缺失设置并保留显式选择：%j",
  (initial_meta, expected) => {
    const meta: JsonRecord = { ...initial_meta };
    const database = {
      set_meta: vi.fn((_path: string, key: string, value: JsonValue) => {
        meta[key] = value;
      }),
    };
    const context = {
      project_path: "demo.lg",
      database,
      meta,
      items: [],
    } as unknown as ProjectOpenMigrationContext;
    for (const write of quality_settings_migration(context)) write(context.database);
    expect(database.set_meta.mock.calls.map(([, key, value]) => [key, value])).toEqual(expected);
    expect(quality_settings_migration(context)).toEqual([]);
  },
);
