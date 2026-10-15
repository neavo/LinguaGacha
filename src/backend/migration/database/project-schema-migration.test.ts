import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { run_project_schema_migration } from "./project-schema-migration";

describe("run_project_schema_migration", () => {
  it("新建工程提供默认资产类型，并按文件与原页唯一保存页面", () => {
    using db = new DatabaseSync(":memory:");

    run_project_schema_migration(db);

    db.prepare(
      "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
    ).run("a.txt", Buffer.from("a"), 1, 1);
    expect(db.prepare("SELECT file_type FROM assets").get()!["file_type"]).toBe("NONE");
    expect(() => db.exec("UPDATE assets SET file_type = NULL")).toThrow(
      "NOT NULL constraint failed",
    );

    const insert = db.prepare("INSERT INTO pdf_pages(file_path, page, data) VALUES (?, ?, ?)");
    insert.run("a.pdf", 1, "{}");
    insert.run("b.pdf", 1, "{}");
    expect(() => insert.run("a.pdf", 1, "{}")).toThrow("UNIQUE constraint failed");
  });

  it("旧 assets 缺少 sort_order 时按 id 顺序补齐稳定文件顺序", () => {
    using db = new DatabaseSync(":memory:");
    db.exec(`
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
    ).run("b.txt", Buffer.from("b"), 1, 1);
    db.prepare(
      "INSERT INTO assets (path, data, original_size, compressed_size) VALUES (?, ?, ?, ?)",
    ).run("a.txt", Buffer.from("a"), 1, 1);

    run_project_schema_migration(db);

    expect(
      db
        .prepare("SELECT path, sort_order, file_type FROM assets ORDER BY id")
        .all()
        .map((row) => ({
          path: String(row["path"]),
          sort_order: Number(row["sort_order"]),
          file_type: row["file_type"],
        })),
    ).toEqual([
      { path: "b.txt", sort_order: 0, file_type: "NONE" },
      { path: "a.txt", sort_order: 1, file_type: "NONE" },
    ]);
  });
});
