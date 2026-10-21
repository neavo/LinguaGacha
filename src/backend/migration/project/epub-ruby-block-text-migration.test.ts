import { write_zip, read_zip_fixture } from "../../../test/zip-fixture";

import { describe, expect, it, vi } from "vitest";

import { EpubAst } from "../../file/epub/epub-ast";
import type { MutableJsonRecord } from "../../../domain/json";
import type { ProjectDatabaseAccess } from "../../database/database-operations";
import { create_epub_fixture } from "../../../test/epub-fixture";
import { EpubRubyBlockTextMigration } from "./epub-ruby-block-text-migration";

describe("EpubRubyBlockTextMigration", () => {
  it("打开旧 EPUB ruby 项目时一次性迁移为 block_text item", async () => {
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );
    const { database, migration, items } = create_migration({
      items: [
        {
          id: 7,
          src: "宝\n條\n直\n希",
          dst: "宝条直希",
          name_src: "宝條直希",
          name_dst: "宝条直希",
          extra_field: {
            note: "保留条目附加数据",
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
        },
      ],
      asset_content_by_path: { "book.epub": epub_asset },
    });

    const writes = await migration.build_writes("demo.lg", items);
    for (const write of writes) {
      write(database as unknown as ProjectDatabaseAccess);
    }
    expect(database.set_items.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        id: 7,
        src: "宝條直希",
        dst: "宝条直希",
        name_src: "宝條直希",
        name_dst: "宝条直希",
        status: "PROCESSED",
        extra_field: {
          note: "保留条目附加数据",
          epub: expect.objectContaining({
            mode: "block_text",
            doc_path: "OPS/chapter.xhtml",
            block_path: "/html[1]/body[1]/p[1]",
            src_digest: expect.any(String),
          }),
        },
      }),
    ]);
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
    const { database, migration, items } = create_migration({
      items: [plain, ruby],
      asset_content_by_path: { "book.epub": await write_zip(zip) },
    });
    for (const write of await migration.build_writes("demo.lg", items))
      write(database as unknown as ProjectDatabaseAccess);
    const migrated = vi.mocked(database.set_items).mock.calls[0]?.[1];
    expect(migrated).toEqual([
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
  });

  it("按旧摘要匹配，拒绝重复块、错误正文和失效路径", async () => {
    const asset = await create_epub_fixture("<ruby>A <rt>旧注音</rt></ruby> B");
    const old: MutableJsonRecord = {
      id: 9,
      src: "旧分行",
      dst: "已有译文",
      status: "PROCESSED",
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      extra_field: {
        epub: {
          mode: "slot_per_line",
          doc_path: "OPS/chapter.xhtml",
          block_path: "/html[1]/body[1]/p[1]",
          ruby_clean_candidate: { cleaned_digest: new EpubAst().sha1_hex("A B") },
        },
      },
    };
    const valid = create_migration({ items: [old], asset_content_by_path: { "book.epub": asset } });
    for (const write of await valid.migration.build_writes("demo.lg", valid.items))
      write(valid.database as unknown as ProjectDatabaseAccess);
    expect(valid.database.set_items.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ id: 9, src: "A B", dst: "已有译文", status: "PROCESSED" }),
    ]);
    const duplicate = create_migration({
      items: [old, { ...old, id: 10 }],
      asset_content_by_path: { "book.epub": asset },
    });
    expect(
      await duplicate.migration.build_writes("demo.lg", duplicate.items),
      "拒绝重复块",
    ).toEqual([]);
    const bad = structuredClone(old);
    const metadata = (bad["extra_field"] as MutableJsonRecord)["epub"] as MutableJsonRecord;
    (metadata["ruby_clean_candidate"] as MutableJsonRecord)["cleaned_src"] = "错误正文";
    const source_first = create_migration({
      items: [bad],
      asset_content_by_path: { "book.epub": asset },
    });
    expect(
      await source_first.migration.build_writes("demo.lg", source_first.items),
      "错误正文不能退回有效摘要",
    ).toEqual([]);
    (metadata["ruby_clean_candidate"] as MutableJsonRecord)["cleaned_src"] = "A B";
    metadata["block_path"] = "/html[1]/body[1]/p[2]";
    const rejected = create_migration({
      items: [old, bad],
      asset_content_by_path: { "book.epub": asset },
    });
    expect(
      await rejected.migration.build_writes("demo.lg", rejected.items),
      "拒绝整文件写入",
    ).toEqual([]);
  });

  it.each([undefined, Buffer.from("invalid epub")])(
    "原始 EPUB 缺失或无法解析时保留旧工程：%j",
    async (asset) => {
      const { migration, items } = create_migration({
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
        asset_content_by_path: asset === undefined ? {} : { "missing.epub": asset },
      });

      await expect(migration.build_writes("demo.lg", items)).resolves.toEqual([]);
    },
  );
});

/**
 * 用内存数据库记录迁移写入，原资产由各用例提供。
 */
function create_migration(options: {
  items?: MutableJsonRecord[];
  asset_content_by_path?: Record<string, Buffer>;
}) {
  const database = {
    get_all_items: vi.fn(() => options.items ?? []),
    read_asset_content: vi.fn(async (_project_path: string, asset_path: string) => {
      return options.asset_content_by_path?.[asset_path] ?? null;
    }),
    set_items: vi.fn(),
    bump_section_revisions: vi.fn(),
  };
  return {
    database,
    migration: new EpubRubyBlockTextMigration(database),
    items: options.items ?? [],
  };
}
