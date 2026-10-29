import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, it, expect } from "vitest";
import { ProjectDatabase } from "./database-operations";
import { ZstdTool } from "./zstd-tool";
import { read_pdf_document } from "../file/pdf/pdf-document";
import { create_pdf_fixture } from "../file/pdf/test-support";

let temp_dir: string;
let database: ProjectDatabase;
beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-database-access-"));
  database = new ProjectDatabase("1.0.0");
});
afterEach(async () => {
  await database.close();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/** 真实临时工程同时验证作用域读写与持久化格式。 */
async function create_database_project(name: string) {
  const lg_path = project_path(name + ".lg");
  await database.create_project(lg_path, name);
  return { database, lg_path };
}
/** 所有资产与工程均限制在本例目录。 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

it("只推进受支持的section revision，并忽略重复 section", async () => {
  const { database, lg_path } = await create_database_project("section-revision");

  expect(
    await database.transaction(lg_path, (writer) =>
      writer.bump_section_revisions(lg_path, ["items", "files", "items", "project"]),
    ),
  ).toEqual({ items: 1, files: 1 });
  expect(
    await database.transaction(lg_path, (writer) =>
      writer.bump_section_revisions(lg_path, ["items"]),
    ),
  ).toEqual({ items: 2 });
  expect(await database.get_all_meta(lg_path)).toMatchObject({
    "project_runtime_revision.items": 2,
    "project_runtime_revision.files": 1,
  });
});

it("数据库从历史小数修订的整数基线推进", async () => {
  const { database, lg_path } = await create_database_project("revision-baseline");
  await database.transaction(lg_path, (writer) =>
    writer.set_meta(lg_path, "project_runtime_revision.items", "1.8"),
  );
  expect(
    await database.transaction(lg_path, (writer) =>
      writer.bump_section_revisions(lg_path, ["items"]),
    ),
  ).toEqual({ items: 2 });
  expect((await database.get_all_meta(lg_path))["project_runtime_revision.items"]).toBe(2);
});

it("按排序快照维护 asset，并可更新和读取内容", async () => {
  const { database, lg_path } = await create_database_project("asset-list");

  await database.transaction(lg_path, (writer) =>
    writer.add_asset(lg_path, "chapter-b.txt", Buffer.from("beta"), "TXT", null, 10),
  );
  await database.transaction(lg_path, (writer) =>
    writer.add_asset(lg_path, "chapter-a.txt", Buffer.from("alpha"), "TXT", null),
  );
  await database.transaction(lg_path, (writer) =>
    writer.add_asset(lg_path, "cover.bin", Buffer.from("cover"), "NONE", null, 0),
  );
  await database.transaction(lg_path, (writer) =>
    writer.update_asset_sort_orders(lg_path, ["chapter-a.txt", "cover.bin", "chapter-b.txt"]),
  );
  await database.transaction(lg_path, (writer) =>
    writer.update_asset(lg_path, "chapter-b.txt", Buffer.from("updated-beta"), "TXT", null),
  );

  expect(await database.get_asset_count(lg_path)).toBe(3);
  expect(await database.get_all_asset_records(lg_path)).toEqual([
    { path: "chapter-a.txt", sort_order: 0, file_type: "TXT" },
    { path: "cover.bin", sort_order: 1, file_type: "NONE" },
    { path: "chapter-b.txt", sort_order: 2, file_type: "TXT" },
  ]);
  expect(
    (await database.read_asset_content(lg_path, "chapter-b.txt"))!.equals(
      Buffer.from("updated-beta"),
    ),
  ).toBe(true);
});

it("批量替换 item 后保持回查顺序并支持字段补丁", async () => {
  const { database, lg_path } = await create_database_project("items");
  await database.transaction(lg_path, (writer) => {
    writer.add_asset(lg_path, "script-a.txt", Buffer.from("おはよう"), "TXT", null);
    writer.add_asset(lg_path, "script-b.txt", Buffer.from("こんばんは"), "TXT", null);
  });

  expect(
    await database.transaction(lg_path, (writer) =>
      writer.set_items(lg_path, [
        { id: 10, file_path: "script-a.txt", file_type: "TXT", src: "おはよう", status: "NONE" },
        { file_path: "script-b.txt", file_type: "TXT", src: "こんばんは", status: "PROCESSED" },
      ]),
    ),
  ).toEqual([10, 11]);
  expect(await database.get_item_count(lg_path)).toBe(2);
  await database.transaction(lg_path, (writer) =>
    writer.patch_item_translation_fields(lg_path, [
      { item_id: 10, next: { dst: "", name_dst: null, status: "PROCESSED" } },
    ]),
  );
  expect(await database.get_items_by_ids(lg_path, [11, 10, 11, 999])).toEqual([
    { id: 11, file_path: "script-b.txt", file_type: "TXT", src: "こんばんは", status: "PROCESSED" },
    {
      id: 10,
      file_path: "script-a.txt",
      file_type: "TXT",
      src: "おはよう",
      dst: "",
      name_dst: null,
      status: "PROCESSED",
    },
  ]);
});

it("事务同步写入 item、规则和 meta，并让工程摘要反映当前事实", async () => {
  const { database, lg_path } = await create_database_project("summary");

  await database.transaction(lg_path, (writer) =>
    writer.add_asset(lg_path, "chapter.txt", Buffer.from("chapter"), "TXT", null, 0),
  );
  await database.transaction(lg_path, (writer) =>
    writer.set_items(lg_path, [
      { id: 1, src: "完成", status: "PROCESSED" },
      { id: 2, src: "失败后修复", status: "ERROR" },
      { id: 3, src: "待处理", status: "NONE" },
      { id: 4, src: "跳过", status: "RULE_SKIPPED" },
    ]),
  );
  await database.transaction(lg_path, (writer) =>
    writer.set_rule_text(lg_path, "prompt.translation", "请保持语气"),
  );
  await database.transaction(lg_path, (database) => {
    database.patch_item_translation_fields(lg_path, [
      { item_id: 2, next: { dst: "", name_dst: null, status: "PROCESSED" } },
    ]);
    database.set_rules(lg_path, "glossary", [{ src: "姫", dst: "公主" }]);
    database.upsert_meta_entries(lg_path, {
      source_language: "JA",
      target_language: "ZH_CN",
      updated_at: "2026-05-16T00:00:00.000Z",
    });
  });

  expect(await database.get_rule_text(lg_path, "prompt.translation")).toBe("请保持语气");
  expect(await database.get_rules(lg_path, "glossary")).toEqual([{ src: "姫", dst: "公主" }]);
  expect(await database.read_project_preview(lg_path)).toEqual(
    expect.objectContaining({
      file_paths: ["chapter.txt"],
      updated_at: "2026-05-16T00:00:00.000Z",
      translation_stats: {
        total_items: 4,
        completed_count: 2,
        failed_count: 0,
        pending_count: 1,
        skipped_count: 1,
        completion_percent: 75,
      },
    }),
  );
});

it("工程预览按稳定 id 返回文件集合，不依赖工作台重排", async () => {
  const { database, lg_path } = await create_database_project("preview-order");
  for (const file_path of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
    await database.transaction(lg_path, (writer) =>
      writer.add_asset(lg_path, file_path, Buffer.from("source"), "TXT", null),
    );
  }
  await database.transaction(lg_path, (writer) =>
    writer.update_asset_sort_orders(lg_path, ["e.txt", "c.txt", "a.txt", "d.txt", "b.txt"]),
  );
  await database.close_project(lg_path);
  expect(await database.read_project_preview(lg_path)).toMatchObject({
    file_paths: ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"],
  });
});

it("patchItemTranslationFields 只更新译文字段并保留条目持久事实", async () => {
  const { database, lg_path } = await create_database_project("translation-patch");
  await database.transaction(lg_path, (writer) =>
    writer.add_asset(lg_path, "demo.txt", Buffer.from("原文"), "TXT", null),
  );

  await database.transaction(lg_path, (writer) =>
    writer.set_items(lg_path, [
      {
        id: 1,
        src: "原文",
        dst: "",
        name_src: "原名",
        name_dst: null,
        status: "NONE",
        file_path: "demo.txt",
        file_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
    ]),
  );

  await database.transaction(lg_path, (writer) =>
    writer.patch_item_translation_fields(lg_path, [
      {
        item_id: 1,
        next: {
          dst: "译文",
          name_dst: "译名",
          status: "PROCESSED",
        },
      },
    ]),
  );

  expect(await database.get_all_items(lg_path)).toEqual([
    {
      id: 1,
      src: "原文",
      dst: "译文",
      name_src: "原名",
      name_dst: "译名",
      status: "PROCESSED",
      file_path: "demo.txt",
      file_type: "TXT",
      row: 7,
      extra_field: { speaker: "春" },
    },
  ]);
});

it("兼容读取旧压缩 asset bytes", async () => {
  const lg_path = project_path("legacy-asset.lg");
  const db = new DatabaseSync(lg_path);
  const compressed = ZstdTool.compress(Buffer.from("legacy"));
  db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        data BLOB NOT NULL,
        original_size INTEGER NOT NULL,
        compressed_size INTEGER NOT NULL
      );
    `);
  db.prepare(
    "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
  ).run("legacy.txt", compressed, 6, compressed.byteLength);
  db.close();

  expect(
    (await database.read_asset_content(lg_path, "legacy.txt"))!.equals(Buffer.from("legacy")),
  ).toBe(true);
});

it("PDF 源文件在解析后变化时导入事务保留旧资产和译稿", async () => {
  const { database, lg_path } = await create_database_project("pdf-source-conflict");
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  await database.transaction(lg_path, (database) =>
    database.add_asset(lg_path, "book.pdf", bytes, "PDF", document, 0),
  );
  await expect(
    database.transaction(lg_path, (database) =>
      database.update_asset(
        lg_path,
        "book.pdf",
        create_pdf_fixture(["changed after parse"]),
        "PDF",
        document,
      ),
    ),
  ).rejects.toThrow(expect.objectContaining({ code: "file.parse_failed" }));
  expect((await database.read_asset_content(lg_path, "book.pdf"))!.equals(Buffer.from(bytes))).toBe(
    true,
  );
  expect(await database.read_pdf_document(lg_path, "book.pdf")).toEqual(document);
});

it("PDF 摘要区分译稿覆盖、确认保留和省略，核对标记独立于处置", async () => {
  const { database, lg_path } = await create_database_project("pdf-summary");
  const bytes = create_pdf_fixture(["Text", null, null, null, "Pending"]);
  const document = read_pdf_document(bytes);
  document.pages[0]!.translation = { kind: "translate", markdown: "正文" };
  document.pages[1]!.translation = { kind: "omit", reason: "装饰页" };
  document.pages[2]!.translation = { kind: "keep", reason: "纯图页无需翻译" };
  document.pages[3]!.translation = { kind: "translate", markdown: "" };
  for (const page of document.pages) page.reviewed = true;
  await database.transaction(lg_path, (database) =>
    database.add_asset(lg_path, "summary.pdf", bytes, "PDF", document, 0),
  );
  expect((await database.read_pdf_summaries(lg_path))["summary.pdf"]).toEqual({
    pages: 5,
    translated_pages: 2,
    kept_pages: 1,
    omitted_pages: 1,
  });
});

it("文件候选按外层路径统计全部条目", async () => {
  const { database, lg_path } = await create_database_project("file-counts");
  await database.transaction(lg_path, (writer) =>
    writer.set_items(lg_path, [
      { file_path: "目录/书.epub", src: "一", status: "NONE" },
      { file_path: "目录/书.epub", src: "二", status: "EXCLUDED" },
      { file_path: "规则.xlsx", src: "三", status: "PROCESSED" },
    ]),
  );
  expect(await database.read_file_counts(lg_path)).toEqual(
    new Map([
      ["目录/书.epub", 2],
      ["规则.xlsx", 1],
    ]),
  );
});
