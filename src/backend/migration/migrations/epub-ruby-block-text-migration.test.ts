import { write_zip, read_zip_fixture } from "../../../test/zip-fixture";

import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import type { ProjectDatabase } from "../../database/database-operations";
import { create_epub_fixture } from "../../../test/epub-fixture";
import { EpubRubyBlockTextMigration } from "./epub-ruby-block-text-migration";

describe("EpubRubyBlockTextMigration", () => {
  it("打开旧 EPUB ruby 项目时一次性迁移为 block_text item", async () => {
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );
    const { database, migration } = create_migration({
      items: [
        {
          id: 7,
          src: "宝\n條\n直\n希",
          dst: "宝条直希",
          name_src: "宝條直希",
          name_dst: "宝条直希",
          extra_field: {
            epub: {
              mode: "slot_per_line",
              doc_path: "OPS/chapter.xhtml",
              block_path: "/html[1]/body[1]/p[1]",
              parts: [
                { slot: "text", path: "/html[1]/body[1]/p[1]/ruby[1]" },
                { slot: "tail", path: "/html[1]/body[1]/p[1]/ruby[1]/rt[1]" },
                { slot: "tail", path: "/html[1]/body[1]/p[1]/ruby[1]/rt[2]" },
                { slot: "tail", path: "/html[1]/body[1]/p[1]/ruby[1]/rt[3]" },
              ],
              src_digest: "legacy",
              is_nav: false,
              ruby_clean_candidate: {
                cleaned_src: "宝條直希",
                block_path: "/html[1]/body[1]/p[1]",
                cleaned_digest: "legacy",
              },
            },
          },
          tag: "OPS/chapter.xhtml",
          row: 0,
          file_type: "EPUB",
          file_path: "book.epub",
          text_type: "NONE",
          status: "PROCESSED",
          retry_count: 2,
        },
      ],
      asset_content_by_path: { "book.epub": epub_asset },
    });

    const writes = await migration.build_writes("demo.lg");
    for (const write of writes) {
      write(database);
    }
    const migrated_items = vi.mocked(database.set_items).mock.calls[0]?.[1];
    const [migrated_item] = migrated_items as MutableJsonRecord[];
    if (migrated_item === undefined) {
      throw new Error("EPUB ruby 迁移未生成 item。");
    }

    expect(migrated_items).toEqual([
      expect.objectContaining({
        id: 7,
        src: "宝條直希",
        dst: "宝条直希",
        name_src: "宝條直希",
        name_dst: "宝条直希",
        status: "PROCESSED",
        retry_count: 2,
      }),
    ]);
    expect((migrated_item["extra_field"] as MutableJsonRecord).epub).toEqual(
      expect.objectContaining({
        mode: "block_text",
        doc_path: "OPS/chapter.xhtml",
        block_path: "/html[1]/body[1]/p[1]",
        src_digest: expect.any(String),
      }),
    );
    expect(database.bump_section_revisions).toHaveBeenCalledWith("demo.lg", ["items"]);
  });

  it("正文扩展改变提取序号时仅转换旧 ruby 条目，保留同文件其它记录", async () => {
    const zip = await read_zip_fixture(await create_epub_fixture("正文"));
    zip.set(
      "OPS/chapter.xhtml",
      "<html><body>新增正文<p>既有段落</p><p><ruby>漢<rt>かん</rt></ruby></p></body></html>",
    );
    const plain = {
      id: 8,
      src: "既有段落",
      dst: "已有译文",
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      row: 0,
      status: "PROCESSED",
    };
    const ruby = {
      id: 9,
      src: "漢",
      dst: "汉",
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      row: 1,
      status: "PROCESSED",
      skip_internal_filter: true,
      extra_field: {
        epub: {
          mode: "slot_per_line",
          doc_path: "OPS/chapter.xhtml",
          block_path: "/html[1]/body[1]/p[2]",
          ruby_clean_candidate: { cleaned_src: "漢" },
        },
      },
    };
    const { database, migration } = create_migration({
      items: [plain, ruby],
      asset_content_by_path: { "book.epub": await write_zip(zip) },
    });
    for (const write of await migration.build_writes("demo.lg")) write(database);
    const items = vi.mocked(database.set_items).mock.calls[0]?.[1];
    expect(items).toEqual([
      expect.objectContaining(plain),
      expect.objectContaining({
        id: 9,
        src: "漢",
        dst: "汉",
        row: 1,
        status: "PROCESSED",
        skip_internal_filter: true,
        extra_field: { epub: expect.objectContaining({ mode: "block_text" }) },
      }),
    ]);
    ruby.extra_field.epub.ruby_clean_candidate.cleaned_src = "不同正文";
    const unsafe = create_migration({
      items: [plain, ruby],
      asset_content_by_path: { "book.epub": await write_zip(zip) },
    });
    expect(await unsafe.migration.build_writes("demo.lg")).toEqual([]);
  });

  it("原始 EPUB 缺失时保留旧工程", async () => {
    const { migration } = create_migration({
      items: [
        {
          src: "宝\n條",
          extra_field: {
            epub: {
              ruby_clean_candidate: {
                cleaned_src: "宝條",
              },
            },
          },
          tag: "OPS/chapter.xhtml",
          row: 0,
          file_type: "EPUB",
          file_path: "missing.epub",
        },
      ],
    });

    await expect(migration.build_writes("demo.lg")).resolves.toEqual([]);
  });
});

/**
 * EPUB ruby 测试用内存 database stub 固定 items 与 asset bytes，专注验证类型化写入输出。
 */
function create_migration(options: {
  items?: MutableJsonRecord[];
  asset_content_by_path?: Record<string, Buffer>;
}): {
  database: ProjectDatabase;
  migration: EpubRubyBlockTextMigration;
} {
  const database = {
    get_all_items: vi.fn(() => options.items ?? []),
    read_asset_content: vi.fn((_project_path: string, asset_path: string) => {
      return options.asset_content_by_path?.[asset_path] ?? null;
    }),
    set_items: vi.fn(),
    bump_section_revisions: vi.fn(),
  } as unknown as ProjectDatabase;
  return {
    database,
    migration: new EpubRubyBlockTextMigration(database),
  };
}
