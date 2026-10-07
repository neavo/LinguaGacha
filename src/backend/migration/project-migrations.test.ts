import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../database/database-operations";
import type { AppSettingService } from "../app/app-setting-service";
import { create_epub_fixture } from "../../test/epub-fixture";
import { build_project_open_writes } from "./project-migrations";

it("打开旧工程按顺序迁移设置、提示词和文件，并保留前序写入", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-project-migrations-"));
  const project_path = path.join(temp.path, "fixture.lg");
  const epub_path = path.join(temp.path, "book.epub");
  fs.writeFileSync(epub_path, await create_epub_fixture("<ruby>漢<rt>かん</rt></ruby>"));
  const database = new ProjectDatabase();
  try {
    database.create_project(project_path, "fixture", () => {
      database.add_asset_from_source(project_path, "book.epub", epub_path, null);
      database.set_rule_text(project_path, "CUSTOM_PROMPT_EN", "旧提示词");
      database.set_items(project_path, [
        {
          id: 1,
          src: "正文",
          dst: "Text",
          row: 0,
          file_type: "MD",
          file_path: "demo.md",
          status: "PROCESSED",
        },
        {
          id: 2,
          src: "漢",
          dst: "汉",
          row: 0,
          file_type: "EPUB",
          file_path: "book.epub",
          tag: "OPS/chapter.xhtml",
          status: "PROCESSED",
          extra_field: {
            epub: {
              mode: "slot_per_line",
              doc_path: "OPS/chapter.xhtml",
              block_path: "/html[1]/body[1]/p[1]",
              ruby_clean_candidate: { cleaned_src: "漢" },
            },
          },
        },
      ]);
    });
    const context = {
      project_path,
      database,
      app_setting_service: {
        read_setting: () => ({ app_language: "EN" }),
      } as unknown as AppSettingService,
    };
    const writes = await build_project_open_writes(context);
    await database.transaction(project_path, () => {
      for (const write of writes) write(database);
    });
    const items = database.get_all_items(project_path);
    expect(items).toEqual([
      expect.objectContaining({ id: 1, file_type: "MD_V2", dst: "Text" }),
      expect.objectContaining({
        id: 2,
        dst: "汉",
        extra_field: { epub: expect.objectContaining({ mode: "block_text" }) },
      }),
    ]);
    expect(database.get_all_meta(project_path)).toMatchObject({
      text_preserve_mode: "smart",
      glossary_enable: true,
      translation_prompt_legacy_migrated: true,
    });
    expect(database.get_rule_text(project_path, "translation_prompt")).toBe("旧提示词");
    expect(await build_project_open_writes(context)).toEqual([]);
    expect(database.get_all_items(project_path)).toEqual(items);
  } finally {
    database.close();
  }
});
