import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../../database/database-operations";
import type { DatabaseJsonValue } from "../../database/database-types";
import { create_epub_fixture } from "../../../test/epub-fixture";
import { EpubRubyBlockTextMigration } from "./epub-ruby-block-text-migration";

type MutableJsonRecord = Record<string, DatabaseJsonValue>;

describe("EpubRubyBlockTextMigration", () => {
  it("打开旧 EPUB ruby 项目时一次性迁移为 block_text item", async () => {
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );
    const { database, migration, write_names } = create_migration({
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
    expect(write_names).toEqual([
      "setItems",
      "deleteAnalysisItemCheckpoints",
      "clearAnalysisCandidateAggregates",
      "upsertMetaEntries",
      "bumpSectionRevisions",
    ]);
  });

  it("旧 EPUB asset 缺失时不生成运行时兼容写回", async () => {
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
  write_names: string[];
} {
  const write_names: string[] = [];
  const database = {
    get_all_items: vi.fn(() => options.items ?? []),
    read_asset_content: vi.fn((_project_path: string, asset_path: string) => {
      return options.asset_content_by_path?.[asset_path] ?? null;
    }),
    set_items: vi.fn(() => {
      write_names.push("setItems");
    }),
    delete_analysis_item_checkpoints: vi.fn(() => {
      write_names.push("deleteAnalysisItemCheckpoints");
    }),
    clear_analysis_candidate_aggregates: vi.fn(() => {
      write_names.push("clearAnalysisCandidateAggregates");
    }),
    upsert_meta_entries: vi.fn(() => {
      write_names.push("upsertMetaEntries");
    }),
    bump_section_revisions: vi.fn(() => {
      write_names.push("bumpSectionRevisions");
    }),
  } as unknown as ProjectDatabase;
  return {
    database,
    migration: new EpubRubyBlockTextMigration(database),
    write_names,
  };
}
