import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import type { ProjectDatabase } from "../../database/database-operations";
import { create_epub_fixture } from "../../../test/epub-fixture";
import { EpubRubyBlockTextMigration } from "./epub-ruby-block-text-migration";
import { MarkdownV2BlockMigration } from "./markdown-v2-block-migration";

describe("MarkdownV2BlockMigration", () => {
  it("把 V1 逐行事实迁移为 V2 块并重建派生状态", () => {
    const data_uri = "data:image/png;base64,AAAA";
    const fixture = create_database(
      [
        legacy_item(1, 0, "# 标题", { dst: "# Title", status: "PROCESSED", retry_count: 1 }),
        legacy_item(2, 1, "", { status: "EXCLUDED" }),
        legacy_item(3, 2, "段落第一行", { dst: "First", status: "PROCESSED" }),
        legacy_item(4, 3, "段落第二行", {
          dst: "Second",
          status: "PROCESSED",
          retry_count: 3,
          skip_internal_filter: true,
        }),
        legacy_item(5, 4, "", { status: "EXCLUDED" }),
        legacy_item(6, 5, "```ts", { status: "EXCLUDED" }),
        legacy_item(7, 6, "const value = 1;", { dst: "const value = 2;", status: "EXCLUDED" }),
        legacy_item(8, 7, "```", { status: "NONE" }),
        legacy_item(9, 8, "", { status: "EXCLUDED" }),
        legacy_item(10, 9, `![封面](${data_uri})`, { status: "EXCLUDED" }),
        {
          id: 50,
          src: "保留",
          dst: "",
          row: 0,
          file_type: "TXT",
          file_path: "keep.txt",
          status: "NONE",
        },
      ],
      {
        translation_extras: { total_tokens: 42, time: 7, processed_line: 99 },
      },
    );
    const migration = new MarkdownV2BlockMigration(fixture.database);

    const writes = migration.build_writes("demo.lg");
    for (const write of writes) write(fixture.database);

    const markdown_items = fixture.items().filter((item) => item["file_path"] === "demo.md");
    expect(markdown_items).toHaveLength(4);
    expect(markdown_items).toEqual([
      expect.objectContaining({
        id: 1,
        src: "# 标题",
        dst: "# Title",
        row: 0,
        file_type: "MD_V2",
        text_type: "MD",
        status: "PROCESSED",
        retry_count: 1,
      }),
      expect.objectContaining({
        id: 3,
        src: "段落第一行\n段落第二行",
        dst: "First\nSecond",
        row: 2,
        status: "PROCESSED",
        retry_count: 3,
        skip_internal_filter: true,
      }),
      expect.objectContaining({
        id: 6,
        src: "```ts\nconst value = 1;\n```",
        dst: "```ts\nconst value = 2;\n```",
        row: 5,
        status: "EXCLUDED",
      }),
      expect.objectContaining({
        id: 10,
        src: "![封面](lg-resource:image/0)",
        dst: "",
        row: 9,
        status: "NONE",
      }),
    ]);
    expect(JSON.stringify(markdown_items)).not.toContain(data_uri);
    expect(fixture.items()).toContainEqual(expect.objectContaining({ id: 50, src: "保留" }));
    expect(fixture.meta()["translation_extras"]).toEqual({
      total_tokens: 42,
      time: 7,
      processed_line: 2,
      error_line: 0,
      total_line: 4,
      line: 2,
    });
    expect(fixture.meta()).toMatchObject({ analysis_extras: {}, analysis_candidate_count: 0 });
    expect(fixture.database.delete_analysis_item_checkpoints).toHaveBeenCalledWith("demo.lg");
    expect(fixture.database.clear_analysis_candidate_aggregates).toHaveBeenCalledWith("demo.lg");
    expect(fixture.bumped_sections).toEqual([["files", "items", "analysis"]]);
    expect(migration.build_writes("demo.lg")).toEqual([]);
    expect(fixture.items().every((item) => item["file_type"] !== "MD")).toBe(true);
  });

  it("聚合跳过、错误、未处理和混合终态并解析重复译文", () => {
    const fixture = create_database([
      legacy_item(1, 0, "规则一", { status: "RULE_SKIPPED" }),
      legacy_item(2, 1, "规则二", { status: "RULE_SKIPPED" }),
      legacy_item(3, 2, "", { status: "EXCLUDED" }),
      legacy_item(4, 3, "语言一", { status: "LANGUAGE_SKIPPED" }),
      legacy_item(5, 4, "语言二", { status: "LANGUAGE_SKIPPED" }),
      legacy_item(6, 5, "", { status: "EXCLUDED" }),
      legacy_item(7, 6, "错误一", { status: "PROCESSED", dst: "Done" }),
      legacy_item(8, 7, "错误二", { status: "ERROR" }),
      legacy_item(9, 8, "", { status: "EXCLUDED" }),
      legacy_item(10, 9, "待处理一", { status: "PROCESSED", dst: "Done" }),
      legacy_item(11, 10, "待处理二", { status: "NONE" }),
      legacy_item(12, 11, "", { status: "EXCLUDED" }),
      legacy_item(13, 12, "混合一", { status: "PROCESSED", dst: "Mixed" }),
      legacy_item(14, 13, "混合二", { status: "RULE_SKIPPED" }),
      legacy_item(15, 14, "", { status: "EXCLUDED" }),
      legacy_item(16, 15, "重复", { status: "PROCESSED", dst: "Repeated" }),
      legacy_item(17, 16, "", { status: "EXCLUDED" }),
      legacy_item(18, 17, "重复", { status: "DUPLICATED" }),
    ]);

    for (const write of new MarkdownV2BlockMigration(fixture.database).build_writes("demo.lg")) {
      write(fixture.database);
    }

    const items = fixture.items();
    expect(items.map((item) => item["status"])).toEqual([
      "RULE_SKIPPED",
      "LANGUAGE_SKIPPED",
      "ERROR",
      "NONE",
      "PROCESSED",
      "PROCESSED",
      "PROCESSED",
    ]);
    expect(items.at(-1)).toEqual(expect.objectContaining({ dst: "Repeated", id: 18 }));
  });

  it("按 URL 身份保留重排链接和用户修改的 destination", () => {
    const fixture = create_database([
      legacy_item(1, 0, "# [甲](https://a.example) [乙](https://b.example)", {
        dst: "[B](https://b.example) [A](https://changed.example)",
        status: "PROCESSED",
      }),
    ]);

    for (const write of new MarkdownV2BlockMigration(fixture.database).build_writes("demo.lg")) {
      write(fixture.database);
    }

    expect(fixture.items()[0]).toEqual(
      expect.objectContaining({
        dst: "[B](lg-resource:link/1) [A](https://changed.example)",
      }),
    );
  });

  it.each([
    {
      name: "非连续 row",
      items: [legacy_item(1, 0, "一"), legacy_item(2, 2, "二")],
      reason: "rows must be unique and contiguous",
    },
    {
      name: "重复 row",
      items: [legacy_item(1, 0, "一"), legacy_item(2, 0, "二")],
      reason: "rows must be unique and contiguous",
    },
    {
      name: "损坏正文",
      items: [{ ...legacy_item(1, 0, "一"), src: null }],
      reason: "src is not readable text",
    },
  ])("$name 会在生成 write 前拒绝且保持旧事实", ({ items, reason }) => {
    const fixture = create_database(items);
    const before = structuredClone(fixture.items());

    expect(() => new MarkdownV2BlockMigration(fixture.database).build_writes("demo.lg")).toThrow(
      expect.objectContaining({ message: expect.stringContaining(reason) }),
    );
    expect(fixture.items()).toEqual(before);
  });

  it("Markdown 与 EPUB 同时迁移时保留事务内前一迁移的结果", async () => {
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt></ruby>',
    );
    const fixture = create_database(
      [
        legacy_item(1, 0, "正文", { dst: "Text", status: "PROCESSED" }),
        {
          id: 20,
          src: "宝\n條",
          dst: "宝条",
          extra_field: {
            epub: {
              mode: "slot_per_line",
              doc_path: "OPS/chapter.xhtml",
              block_path: "/html[1]/body[1]/p[1]",
              ruby_clean_candidate: {
                cleaned_src: "宝條",
                block_path: "/html[1]/body[1]/p[1]",
              },
            },
          },
          tag: "OPS/chapter.xhtml",
          row: 0,
          file_type: "EPUB",
          file_path: "book.epub",
          text_type: "NONE",
          status: "PROCESSED",
          retry_count: 0,
        },
      ],
      {},
      { "book.epub": epub_asset },
    );
    const epub_writes = await new EpubRubyBlockTextMigration(fixture.database).build_writes(
      "demo.lg",
    );
    const markdown_writes = new MarkdownV2BlockMigration(fixture.database).build_writes("demo.lg");

    for (const write of [...epub_writes, ...markdown_writes]) write(fixture.database);

    expect(fixture.items()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file_path: "demo.md", file_type: "MD_V2" }),
        expect.objectContaining({
          file_path: "book.epub",
          extra_field: expect.objectContaining({
            epub: expect.objectContaining({ mode: "block_text" }),
          }),
        }),
      ]),
    );
  });
});

function legacy_item(
  id: number,
  row: number,
  src: string,
  overrides: MutableJsonRecord = {},
): MutableJsonRecord {
  return {
    id,
    src,
    dst: "",
    row,
    file_type: "MD",
    file_path: "demo.md",
    text_type: "MD",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_database(
  initial_items: MutableJsonRecord[],
  initial_meta: MutableJsonRecord = {},
  assets: Record<string, Buffer> = {},
): {
  database: ProjectDatabase;
  items: () => MutableJsonRecord[];
  meta: () => MutableJsonRecord;
  bumped_sections: string[][];
} {
  let items = structuredClone(initial_items);
  const meta = structuredClone(initial_meta);
  const bumped_sections: string[][] = [];
  const database = {
    get_all_items: vi.fn(() => structuredClone(items)),
    get_all_meta: vi.fn(() => structuredClone(meta)),
    read_asset_content: vi.fn(
      (_project_path: string, file_path: string) => assets[file_path] ?? null,
    ),
    set_items: vi.fn((_project_path: string, next_items: MutableJsonRecord[]) => {
      let next_id = Math.max(0, ...next_items.map((item) => Number(item["id"] ?? 0))) + 1;
      items = structuredClone(next_items).map((item) => ({
        ...item,
        id: item["id"] ?? next_id++,
      }));
      return items.map((item) => Number(item["id"]));
    }),
    delete_analysis_item_checkpoints: vi.fn(),
    clear_analysis_candidate_aggregates: vi.fn(),
    upsert_meta_entries: vi.fn((_project_path: string, entries: MutableJsonRecord) => {
      Object.assign(meta, structuredClone(entries));
    }),
    bump_section_revisions: vi.fn((_project_path: string, sections: string[]) => {
      bumped_sections.push([...sections]);
    }),
  } as unknown as ProjectDatabase;
  return {
    database,
    items: () => structuredClone(items),
    meta: () => structuredClone(meta),
    bumped_sections,
  };
}
