import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZstdTool } from "../utils/zstd-tool";
import { ProjectDatabase } from "./database-operations";

let temp_dir = "";

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-database-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectDatabase", () => {
  it("创建工程并读写 meta", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("demo.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "demo" },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "source_language", default: "" },
      }),
    ).toBe("JA");
    database.close();
  });

  it("由 TS 侧读取源文件、压缩 asset，并按 octet-stream 返回原始 bytes", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("asset.lg");
    const source_path = project_path("source.txt");
    fs.writeFileSync(source_path, Buffer.from("hello"));

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "asset" },
    });
    database.execute({
      name: "addAssetFromSource",
      args: {
        projectPath: lg_path,
        path: "source.txt",
        sourcePath: source_path,
        sortOrder: 0,
      },
    });

    expect(database.read_asset_content(lg_path, "source.txt")).toEqual(Buffer.from("hello"));
    database.close();
  });

  it("事务失败时回滚已排队写入", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("rollback.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "rollback" },
    });

    expect(() =>
      database.execute_transaction([
        {
          name: "setMeta",
          args: { projectPath: lg_path, key: "target_language", value: "ZH" },
        },
        {
          name: "missingOperation",
          args: { projectPath: lg_path },
        },
      ]),
    ).toThrow("未知 database 操作");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "target_language", default: "missing" },
      }),
    ).toBe("missing");
    database.close();
  });

  it("打开旧 items 状态时执行迁移归一", () => {
    const lg_path = project_path("legacy.lg");
    const db = new DatabaseSync(lg_path);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);
      INSERT INTO items (data) VALUES ('{"src":"A","status":"PROCESSED_IN_PAST"}');
      INSERT INTO items (data) VALUES ('{"src":"B","status":"PROCESSING"}');
    `);
    db.close();

    const database = new ProjectDatabase();
    expect(
      database.execute({
        name: "getAllItems",
        args: { projectPath: lg_path },
      }),
    ).toEqual([
      { id: 1, src: "A", status: "PROCESSED" },
      { id: 2, src: "B", status: "NONE" },
    ]);
    database.close();
  });

  it("兼容读取旧压缩 asset bytes", () => {
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

    const database = new ProjectDatabase();
    expect(database.read_asset_content(lg_path, "legacy.txt")).toEqual(Buffer.from("legacy"));
    expect(
      database.execute({
        name: "getAllAssetRecords",
        args: { projectPath: lg_path },
      }),
    ).toEqual([{ path: "legacy.txt", sort_order: 0 }]);
    database.close();
  });
});
