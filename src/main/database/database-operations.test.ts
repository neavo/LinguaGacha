import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZstdTool } from "../../shared/utils/zstd-tool";
import { ProjectDatabase } from "./database-operations";

let temp_dir = "";

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function project_sidecar_paths(lg_path: string): string[] {
  return [`${lg_path}-wal`, `${lg_path}-shm`];
}

function has_project_sidecar(lg_path: string): boolean {
  return project_sidecar_paths(lg_path).some((sidecar_path) => fs.existsSync(sidecar_path));
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
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "writeback_migration_version", default: 0 },
      }),
    ).toBe(1);
    expect(has_project_sidecar(lg_path)).toBe(false);
    database.close();
  });

  it("普通 scoped 操作结束后不常驻 WAL 副文件", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("scoped.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "scoped" },
    });
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "target_language", value: "ZH" },
    });
    database.execute({
      name: "getMeta",
      args: { projectPath: lg_path, key: "target_language", default: "" },
    });

    expect(has_project_sidecar(lg_path)).toBe(false);
    database.close();
  });

  it("关闭工程后迟到的租约释放不会二次关闭连接", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("lease-close.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "lease-close" },
    });
    const release = database.acquire_project_lease(lg_path, "test");
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

    database.execute({
      name: "closeProject",
      args: { projectPath: lg_path },
    });

    expect(() => release()).not.toThrow();
    expect(has_project_sidecar(lg_path)).toBe(false);
    database.close();
  });

  it("显式租约期间保留连接，释放后清理 WAL 副文件", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("lease.lg");

    database.execute({
      name: "createProject",
      args: { projectPath: lg_path, name: "lease" },
    });
    const release = database.acquire_project_lease(lg_path, "test");
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "source_language", value: "JA" },
    });

    expect(has_project_sidecar(lg_path)).toBe(true);
    release();
    release();

    expect(has_project_sidecar(lg_path)).toBe(false);
    database.close();
  });

  it("由 服务层读取源文件、压缩 asset，并通过 ProjectDatabase 返回原始 bytes", () => {
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
    ).toThrow("runtime.internal_invariant");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "target_language", default: "missing" },
      }),
    ).toBe("missing");
    database.close();
  });

  it("创建工程事务失败时先结束 scoped 连接再删除新文件", () => {
    const database = new ProjectDatabase();
    const lg_path = project_path("create-rollback.lg");

    expect(() =>
      database.execute_transaction([
        {
          name: "createProject",
          args: { projectPath: lg_path, name: "create-rollback" },
        },
        {
          name: "setMeta",
          args: { projectPath: lg_path, key: "target_language", value: "ZH" },
        },
        {
          name: "missingOperation",
          args: { projectPath: lg_path },
        },
      ]),
    ).toThrow("runtime.internal_invariant");

    expect(fs.existsSync(lg_path)).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(false);
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
    database.close();
  });
});
