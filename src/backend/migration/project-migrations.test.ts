import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../database/database-operations";
import type { AppSettingService } from "../app/app-setting-service";
import { create_epub_fixture, read_epub_entry_text } from "../../test/epub-fixture";
import { create_item } from "../../domain/item";
import { EPUBFormat } from "../file/epub/epub-format";
import { build_project_open_writes } from "./project-migrations";

it("旧工程迁移保留身份与前序写入，关闭重开后实际导出已有译文", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-project-migrations-"));
  const project_path = path.join(temp.path, "fixture.lg");
  const epub_content = await create_epub_fixture("<ruby>漢<rt>かん</rt></ruby>");
  const database = new ProjectDatabase("1.0.0");
  try {
    await database.create_project(project_path, "fixture", (database) => {
      database.add_asset(project_path, "book.epub", epub_content, "EPUB", null);
      database.add_asset(project_path, "demo.md", Buffer.from("正文"), "MD", null);
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
    await database.transaction(project_path, (database) => {
      for (const write of writes) write(database);
    });
    const items = await database.get_all_items(project_path);
    expect(items).toEqual([
      expect.objectContaining({ id: 1, file_type: "MD_V2", dst: "Text" }),
      expect.objectContaining({
        id: 2,
        dst: "汉",
        extra_field: { epub: expect.objectContaining({ mode: "block_text" }) },
      }),
    ]);
    expect(await database.get_all_meta(project_path)).toMatchObject({
      text_preserve_mode: "smart",
      glossary_enable: true,
      translation_prompt_legacy_migrated: true,
    });
    expect(await database.get_rule_text(project_path, "translation_prompt")).toBe("旧提示词");
    expect(await build_project_open_writes(context)).toEqual([]);
    await database.close_project(project_path);
    const reopened = await database.get_all_items(project_path);
    expect(reopened).toEqual(items);
    expect(await build_project_open_writes(context)).toEqual([]);
    const format = new EPUBFormat({ target_language: "ZH" });
    const translated_path = path.join(temp.path, "translated");
    const bilingual_path = path.join(temp.path, "bilingual");
    await format.write_to_path(
      reopened.map(create_item),
      { translated_path, bilingual_path },
      (file) => database.read_asset_content(project_path, file),
    );
    const translated = await read_epub_entry_text(
      fs.readFileSync(path.join(translated_path, "book.epub")),
    );
    const bilingual = await read_epub_entry_text(
      fs.readFileSync(path.join(bilingual_path, "book.epub")),
    );
    expect(translated).toContain("汉");
    expect(translated).not.toContain("かん");
    expect(bilingual).toContain("<ruby>漢<rt>かん</rt></ruby>");
    expect(bilingual).toContain("汉");
  } finally {
    await database.close();
  }
});
