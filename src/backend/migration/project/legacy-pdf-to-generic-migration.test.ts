import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { ProjectDatabase } from "../../database/database-operations";
import { ZstdTool } from "../../database/zstd-tool";
import { build_project_open_writes } from "../project-migrations";

it("旧工程打开时封存 PDF 字节和历史页数据，清理旧表后重复打开不再写入", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-legacy-pdf-"));
  const project_path = path.join(directory.path, "old.lg");
  const source = Buffer.from("old PDF bytes");
  const page = {
    page: 1,
    width: 100,
    height: 200,
    rotation: 0,
    label: null,
    translation: { kind: "translate", markdown: "" },
    reviewed: true,
    notes: "已并入下一页",
  };
  {
    using old = new DatabaseSync(project_path);
    old.exec(`
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL,
        data BLOB NOT NULL, original_size INTEGER NOT NULL, compressed_size INTEGER NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE pdf_documents (file_path TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE pdf_pages (file_path TEXT NOT NULL, page INTEGER NOT NULL, data TEXT NOT NULL);
    `);
    const insert = old.prepare(
      "INSERT INTO assets(path, sort_order, data, original_size, compressed_size) VALUES (?, ?, ?, ?, ?)",
    );
    const compressed = ZstdTool.compress(source);
    insert.run("book.pdf", 4, compressed, source.length, compressed.length);
    insert.run("BOOK.PDF.generic", 4, compressed, source.length, compressed.length);
    insert.run("missing.pdf", 8, compressed, source.length, compressed.length);
    old.prepare("INSERT INTO meta VALUES (?, ?)").run("project_runtime_revision.pdf", "1");
    old.prepare("INSERT INTO pdf_documents VALUES (?, ?)").run("book.pdf", '{"digest":"old"}');
    const add_page = old.prepare("INSERT INTO pdf_pages VALUES (?, ?, ?)");
    add_page.run("book.pdf", 1, JSON.stringify(page));
    add_page.run("book.pdf", 2, "{broken");
  }

  const database = new ProjectDatabase("1.0.0");
  try {
    await database.prepare(project_path);
    const input = { database, project_path };
    const commit = async (fail = false) => {
      const writes = await build_project_open_writes(input);
      return database.transaction(project_path, (writer) => {
        for (const write of writes) write(writer);
        if (fail) throw new Error("rollback");
      });
    };
    await expect(commit(true)).rejects.toThrow();
    expect(await database.read_asset_content(project_path, "book.pdf")).toEqual(source);
    await commit();

    expect(await database.get_all_asset_records(project_path)).toEqual([
      { path: "book.pdf_2.generic", sort_order: 4, file_type: "GENERIC" },
      { path: "BOOK.PDF.generic", sort_order: 4, file_type: "NONE" },
      { path: "missing.pdf.generic", sort_order: 8, file_type: "GENERIC" },
    ]);
    const bytes = await database.read_asset_content(project_path, "book.pdf_2.generic");
    const zip = await JSZip.loadAsync(bytes!);
    expect(await zip.file("source.pdf")!.async("nodebuffer")).toEqual(source);
    expect(await zip.file("items.json")!.async("string")).toBe("[]");
    expect(JSON.parse(await zip.file("legacy-pdf.json")!.async("string"))).toEqual({
      original_file_path: "book.pdf",
      digest: "old",
      pages: [page],
      raw_pages: [{ page: 2, data: "{broken" }],
    });
    const missing = await database.read_asset_content(project_path, "missing.pdf.generic");
    const missing_zip = await JSZip.loadAsync(missing!);
    expect(JSON.parse(await missing_zip.file("legacy-pdf.json")!.async("string"))).toMatchObject({
      digest: null,
      pages: [],
    });
    expect(await database.get_all_meta(project_path)).not.toHaveProperty([
      "project_runtime_revision.pdf",
    ]);
    expect(await build_project_open_writes(input)).toEqual([]);
  } finally {
    await database.close();
  }
});
