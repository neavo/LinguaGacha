import { read_pdf_document } from "../file/formats/pdf/pdf-document";
import { create_pdf_fixture } from "../file/formats/pdf/test-support";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { NativeFs } from "../../native/native-fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JsonTool } from "../../shared/utils/json-tool";
import { ZstdTool } from "../../shared/utils/zstd-tool";
import { migration_orchestrator } from "../migration/migration-orchestrator";
import {
  PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
  PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
} from "../migration/migration-orchestrator";
import { ProjectDataReader } from "../project/project-data-reader";
import { ProjectDatabase } from "./database-operations";

let temp_dir = "";
let cleanup_databases: ProjectDatabase[] = [];

/** 将测试工程限制在本例临时目录。 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/** 登记真实连接，由 afterEach 先关闭再删除临时目录。 */
function create_database(): ProjectDatabase {
  const database = new ProjectDatabase();
  cleanup_databases.push(database);
  return database;
}

/** 创建真实工程并登记连接清理。 */
function create_database_project(name: string): { database: ProjectDatabase; lg_path: string } {
  const database = create_database();
  const lg_path = project_path(`${name}.lg`);
  database.create_project(lg_path, name);
  return { database, lg_path };
}

/** 从公开读取结果取得指定 meta，保持数据库序列化边界。 */
function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: unknown,
): unknown {
  return (database.get_all_meta(project_path) as Record<string, unknown>)[key] ?? default_value;
}

/** 观察 SQLite 是否仍保留 WAL 侧文件。 */
function has_project_sidecar(lg_path: string): boolean {
  return [`${lg_path}-wal`, `${lg_path}-shm`].some((sidecar_path) => fs.existsSync(sidecar_path));
}

/** 读取 SQLite 文件头中的自动回收模式，直接观察 .lg 物理契约。 */
function read_auto_vacuum_mode(lg_path: string): number {
  using db = new DatabaseSync(lg_path);
  const row = db.prepare("PRAGMA auto_vacuum").get();
  return Number(row?.["auto_vacuum"] ?? 0);
}

/** 构造使用旧物理模式的最小工程，供首次打开场景验证真实转换。 */
function create_legacy_project(lg_path: string, name: string): void {
  using db = new DatabaseSync(lg_path);
  db.exec(`
    PRAGMA auto_vacuum=NONE;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    "name",
    JsonTool.stringifyStrict(name),
  );
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-database-"));
  cleanup_databases = [];
});

afterEach(() => {
  for (const database of cleanup_databases.splice(0)) {
    database.close();
  }
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectDatabase", () => {
  it("新建拒绝已有目标并保留原有内容", () => {
    const database = create_database();
    const target = project_path("existing.lg");
    fs.writeFileSync(target, "existing content");
    expect(() => database.create_project(target, "replacement")).toThrow("project.already_exists");
    expect(fs.readFileSync(target, "utf8")).toBe("existing content");
  });

  it("WAL 初始化失败会关闭连接并删除本次创建的空文件", () => {
    const database = create_database();
    const target = project_path("failed-wal.lg");
    const original = DatabaseSync.prototype.exec;
    const failure = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
      this: DatabaseSync,
      sql,
    ) {
      if (sql === "PRAGMA journal_mode=WAL")
        throw Object.assign(new Error("database is locked"), { errcode: 5 });
      return original.call(this, sql);
    });
    expect(() => database.create_project(target, "failed")).toThrow("database.busy");
    expect(fs.existsSync(target)).toBe(false);
    expect(has_project_sidecar(target)).toBe(false);
    failure.mockRestore();
    database.create_project(target, "retry");
    expect(read_meta(database, target, "name", "")).toBe("retry");
  });

  it("提交后关闭失败保留工程并明确禁止重放写入", () => {
    const database = create_database();
    const target = project_path("committed.lg");
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    expect(() => database.create_project(target, "committed")).toThrow(
      expect.objectContaining({
        code: "data.committed_sync_failed",
        public_details: { committed: true, action: "reload_project" },
      }),
    );
    expect(fs.existsSync(target)).toBe(true);
    database.close();
    expect(read_meta(database, target, "name", "")).toBe("committed");
  });

  it("新建失败且清理失败时保留两个异常与残留文件", () => {
    const native_fs = new NativeFs();
    const database = new ProjectDatabase(native_fs);
    cleanup_databases.push(database);
    const target = project_path("cleanup-failed.lg");
    vi.spyOn(native_fs, "remove").mockImplementationOnce(() => {
      throw new Error("remove failed");
    });
    let failure: unknown;
    try {
      database.create_project(target, "failed", () => {
        throw new Error("initialize failed");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toHaveProperty("cause.errors", [
      expect.objectContaining({ cause: expect.objectContaining({ message: "initialize failed" }) }),
      expect.objectContaining({ cause: expect.objectContaining({ message: "remove failed" }) }),
    ]);
    expect(fs.existsSync(target)).toBe(true);
  });

  it.each([false, true])(
    "真实进程持锁：持续占用=%s",
    async (persistent) => {
      const target = project_path("locked.lg");
      // 子进程独立释放锁，父进程阻塞在 DatabaseSync 时仍能观察真实 SQLite 等待行为。
      const child = spawn(
        process.execPath,
        [
          "--input-type=commonjs",
          "-e",
          `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
      process.on('message', (delay) => {
        setTimeout(() => { db.exec('COMMIT'); db.close(); process.disconnect(); }, delay);
        process.send('armed');
      });
      process.send('locked');
    `,
          target,
        ],
        { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true },
      );
      const exited = once(child, "exit");
      try {
        await once(child, "message");
        if (!persistent) {
          const armed = once(child, "message");
          child.send(300);
          await armed;
        }
        const database = create_database();
        if (persistent) {
          expect(() => database.get_all_meta(target)).toThrow(
            expect.objectContaining({
              code: "database.busy",
              severity: "warning",
              diagnostic_context: expect.objectContaining({
                operation: "journal_mode",
                sqlite_code: 5,
              }),
            }),
          );
          child.send(0);
        } else {
          database.get_all_meta(target);
        }
        await exited;
        database.set_meta(target, "name", "available");
        expect(read_meta(database, target, "name", "")).toBe("available");
      } finally {
        if (child.exitCode === null) child.kill();
        await exited;
      }
    },
    15000,
  );

  it("创建工程并读写 meta", () => {
    const database = create_database();
    const lg_path = project_path("demo.lg");

    database.create_project(lg_path, "demo");
    database.set_meta(lg_path, "source_language", "JA");

    expect(read_meta(database, lg_path, "source_language", "")).toBe("JA");
    expect(
      read_meta(database, lg_path, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY, []),
    ).toEqual(PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("新建工程使用 FULL auto-vacuum", () => {
    const database = create_database();
    const lg_path = project_path("auto-vacuum-full.lg");

    database.create_project(lg_path, "auto-vacuum-full");

    expect(read_auto_vacuum_mode(lg_path)).toBe(1);
  });

  it("首次打开历史工程时回收空闲页并保留项目事实", () => {
    const lg_path = project_path("legacy-auto-vacuum.lg");
    create_legacy_project(lg_path, "legacy-auto-vacuum");
    {
      using db = new DatabaseSync(lg_path);
      db.exec("CREATE TABLE retired_payload (data BLOB NOT NULL)");
      db.prepare("INSERT INTO retired_payload (data) VALUES (?)").run(
        Buffer.alloc(2 * 1024 * 1024, 0x41),
      );
      db.exec("DELETE FROM retired_payload");
    }
    const size_before_open = fs.statSync(lg_path).size;
    const database = create_database();

    expect(read_meta(database, lg_path, "name", "")).toBe("legacy-auto-vacuum");

    expect(read_auto_vacuum_mode(lg_path)).toBe(1);
    expect(fs.statSync(lg_path).size).toBeLessThan(size_before_open);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("物理整理失败时仍可读取历史工程", () => {
    const lg_path = project_path("deferred-auto-vacuum.lg");
    create_legacy_project(lg_path, "deferred-auto-vacuum");
    const database = create_database();
    const original_exec = DatabaseSync.prototype.exec;
    let vacuum_failed = false;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === "VACUUM") {
        vacuum_failed = true;
        throw new Error("vacuum unavailable");
      }
      return Reflect.apply(original_exec, this, [sql]) as void;
    });

    expect(read_meta(database, lg_path, "name", "")).toBe("deferred-auto-vacuum");
    expect(vacuum_failed).toBe(true);
    expect(read_auto_vacuum_mode(lg_path)).toBe(0);
  });

  it("普通 scoped 操作结束后不常驻 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("scoped.lg");

    database.create_project(lg_path, "scoped");
    database.set_meta(lg_path, "target_language", "ZH");
    read_meta(database, lg_path, "target_language", "");

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("首次打开旧工程时写回质量规则身份并满足严格读取契约", () => {
    const { database, lg_path } = create_database_project("legacy-quality-rule-identity");
    database.set_rules(lg_path, "glossary", [{ src: "缺失身份", dst: "译文" }]);
    database.close_project(lg_path);
    // 新工程已执行全部迁移，移除目标 id 才能模拟历史工程首次打开。
    {
      using legacy_db = new DatabaseSync(lg_path);
      const applied_ids = PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS.filter(
        (id) => id !== "quality-rule-entry-identity",
      );
      legacy_db
        .prepare("UPDATE meta SET value = ? WHERE key = ?")
        .run(
          JsonTool.stringifyStrict(applied_ids),
          PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
        );
    }

    const data_reader = new ProjectDataReader(database);
    expect(() =>
      data_reader.build_quality_block(lg_path, data_reader.get_all_meta(lg_path)),
    ).not.toThrow();

    expect(database.get_rules(lg_path, "glossary")).toEqual([
      { entry_id: expect.any(String), src: "缺失身份", dst: "译文" },
    ]);
    expect(
      read_meta(database, lg_path, PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY, []),
    ).toContain("quality-rule-entry-identity");
  });

  it("关闭工程后迟到的租约释放不会二次关闭连接", () => {
    const database = create_database();
    const lg_path = project_path("lease-close.lg");

    database.create_project(lg_path, "lease-close");
    const release = database.acquire_project_lease(lg_path, "test");
    database.set_meta(lg_path, "source_language", "JA");

    database.close_project(lg_path);

    expect(() => release()).not.toThrow();
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("显式租约期间保留连接，释放后清理 WAL 副文件", () => {
    const database = create_database();
    const lg_path = project_path("lease.lg");

    database.create_project(lg_path, "lease");
    const release = database.acquire_project_lease(lg_path, "test");
    database.set_meta(lg_path, "source_language", "JA");

    expect(has_project_sidecar(lg_path)).toBe(true);
    release();
    release();

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("一条连接关闭失败仍释放其它连接，并保留失败连接供再次回收", () => {
    const database = create_database();
    const first_path = project_path("first-close.lg");
    const second_path = project_path("second-close.lg");
    database.create_project(first_path, "first");
    database.create_project(second_path, "second");
    const release_first = database.acquire_project_lease(first_path, "test");
    const release_second = database.acquire_project_lease(second_path, "test");
    const failure = new Error("close failed");
    const close = vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => database.close()).toThrow(AggregateError);
    expect(close).toHaveBeenCalledTimes(2);
    expect(has_project_sidecar(second_path)).toBe(false);
    database.close();
    expect(() => release_first()).not.toThrow();
    expect(() => release_second()).not.toThrow();
    expect(has_project_sidecar(first_path)).toBe(false);
  });

  it("项目数据库初始化失败时关闭连接并保留原始原因", () => {
    const database = create_database();
    const lg_path = project_path("open-failed.lg");
    const open_failure = new Error("migration failed");
    let connection_close: ReturnType<typeof vi.spyOn> | null = null;
    vi.spyOn(migration_orchestrator, "run_project_database_migrations").mockImplementationOnce(
      (db) => {
        connection_close = vi.spyOn(db, "close");
        throw open_failure;
      },
    );

    expect(() => database.get_all_meta(lg_path)).toThrow(
      expect.objectContaining({
        cause: open_failure,
        diagnostic_context: expect.objectContaining({ operation: "migration" }),
      }),
    );

    expect(connection_close).not.toBeNull();
    expect(connection_close).toHaveBeenCalledTimes(1);
  });

  it("由 服务层读取源文件、压缩 asset，并通过 ProjectDatabase 返回原始 bytes", () => {
    const database = create_database();
    const lg_path = project_path("asset.lg");
    const source_path = project_path("source.txt");
    fs.writeFileSync(source_path, Buffer.from("hello"));

    database.create_project(lg_path, "asset");
    database.add_asset_from_source(lg_path, "source.txt", source_path, null, 0);

    expect(database.read_asset_content(lg_path, "source.txt")).toEqual(Buffer.from("hello"));
  });

  it("事务失败时回滚已排队写入", () => {
    const database = create_database();
    const lg_path = project_path("rollback.lg");
    database.create_project(lg_path, "rollback");

    expect(() =>
      database.transaction(lg_path, () => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("rollback");
      }),
    ).toThrow(expect.objectContaining({ cause: expect.objectContaining({ message: "rollback" }) }));

    expect(read_meta(database, lg_path, "target_language", "missing")).toBe("missing");
  });

  it("创建工程事务失败时先结束 scoped 连接再删除新文件", () => {
    const database = create_database();
    const lg_path = project_path("create-rollback.lg");

    expect(() =>
      database.create_project(lg_path, "create-rollback", () => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("rollback");
      }),
    ).toThrow(expect.objectContaining({ cause: expect.objectContaining({ message: "rollback" }) }));

    expect(fs.existsSync(lg_path)).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("回滚失败时保留两个原因并撤销租约持有的失效连接", () => {
    const { database, lg_path } = create_database_project("rollback-failed");
    const release = database.acquire_project_lease(lg_path, "test");
    const original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return original.call(this, sql);
    });
    let failure: unknown;
    try {
      database.transaction(lg_path, () => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("write failed");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toHaveProperty("cause.errors", [
      expect.objectContaining({ cause: expect.objectContaining({ message: "write failed" }) }),
      expect.objectContaining({ cause: expect.objectContaining({ message: "rollback failed" }) }),
    ]);
    expect(has_project_sidecar(lg_path)).toBe(false);
    expect(read_meta(database, lg_path, "target_language", "missing")).toBe("missing");
    expect(() => release()).not.toThrow();
  });

  it("只推进受支持的section revision，并忽略重复 section", () => {
    const { database, lg_path } = create_database_project("section-revision");

    expect(
      database.bump_section_revisions(lg_path, ["items", "files", "items", "project"]),
    ).toEqual({ items: 1, files: 1 });
    expect(database.bump_section_revisions(lg_path, ["items"])).toEqual({ items: 2 });
    expect(database.get_all_meta(lg_path)).toMatchObject({
      "project_runtime_revision.items": 2,
      "project_runtime_revision.files": 1,
    });
  });

  it("按排序快照维护 asset，并可更新和读取内容", () => {
    const { database, lg_path } = create_database_project("asset-list");
    const alpha_path = project_path("alpha.txt");
    const beta_path = project_path("beta.txt");
    const cover_path = project_path("cover.bin");
    const updated_beta_path = project_path("updated-beta.txt");
    fs.writeFileSync(alpha_path, Buffer.from("alpha"));
    fs.writeFileSync(beta_path, Buffer.from("beta"));
    fs.writeFileSync(cover_path, Buffer.from("cover"));
    fs.writeFileSync(updated_beta_path, Buffer.from("updated-beta"));

    database.add_asset_from_source(lg_path, "chapter-b.txt", beta_path, null, 10);
    database.add_asset_from_source(lg_path, "chapter-a.txt", alpha_path, null);
    database.add_asset_from_source(lg_path, "cover.bin", cover_path, null, 0);
    database.update_asset_sort_orders(lg_path, ["chapter-a.txt", "cover.bin", "chapter-b.txt"]);
    database.update_asset_from_source(lg_path, "chapter-b.txt", updated_beta_path, null);

    expect(database.get_asset_count(lg_path)).toBe(3);
    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "chapter-a.txt", sort_order: 0 },
      { path: "cover.bin", sort_order: 1 },
      { path: "chapter-b.txt", sort_order: 2 },
    ]);
    expect(database.read_asset_content(lg_path, "chapter-b.txt")).toEqual(
      Buffer.from("updated-beta"),
    );
  });

  it("批量替换 item 后保持回查顺序并支持字段补丁", () => {
    const { database, lg_path } = create_database_project("items");

    expect(
      database.set_items(lg_path, [
        { id: 10, file_path: "script-a.txt", src: "おはよう", status: "NONE" },
        { file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
      ]),
    ).toEqual([10, 11]);
    expect(database.get_item_count(lg_path)).toBe(2);
    database.patch_item_fields_by_ids(lg_path, [10], { status: "PROCESSED" });
    expect(database.get_items_by_ids(lg_path, [11, 10, 11, 999])).toEqual([
      { id: 11, file_path: "script-b.txt", src: "こんばんは", status: "PROCESSED" },
      { id: 10, file_path: "script-a.txt", src: "おはよう", status: "PROCESSED" },
    ]);
  });

  it("事务同步写入 item、规则和 meta，并让工程摘要反映当前事实", () => {
    const { database, lg_path } = create_database_project("summary");
    const source_path = project_path("chapter.txt");
    fs.writeFileSync(source_path, "chapter");

    database.add_asset_from_source(lg_path, "chapter.txt", source_path, null, 0);
    database.set_items(lg_path, [
      { id: 1, src: "完成", status: "PROCESSED" },
      { id: 2, src: "失败后修复", status: "ERROR" },
      { id: 3, src: "待处理", status: "NONE" },
      { id: 4, src: "跳过", status: "RULE_SKIPPED" },
    ]);
    database.set_rule_text(lg_path, "prompt.translation", "请保持语气");
    database.transaction(lg_path, () => {
      database.patch_item_fields_by_ids(lg_path, [2], { status: "PROCESSED" });
      database.set_rules(lg_path, "glossary", [{ src: "姫", dst: "公主" }]);
      database.upsert_meta_entries(lg_path, {
        source_language: "JA",
        target_language: "ZH_CN",
        updated_at: "2026-05-16T00:00:00.000Z",
      });
    });

    expect(database.get_rule_text(lg_path, "prompt.translation")).toBe("请保持语气");
    expect(database.get_rules(lg_path, "glossary")).toEqual([{ src: "姫", dst: "公主" }]);
    expect(database.get_project_summary(lg_path)).toEqual(
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

  it("工程预览在重排并重新打开后返回完整文件顺序", () => {
    const { database, lg_path } = create_database_project("preview-order");
    const source_path = project_path("source.txt");
    fs.writeFileSync(source_path, "source");
    for (const file_path of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
      database.add_asset_from_source(lg_path, file_path, source_path, null);
    }
    database.update_asset_sort_orders(lg_path, ["e.txt", "c.txt", "a.txt", "d.txt", "b.txt"]);
    database.close_project(lg_path);
    expect(database.get_project_summary(lg_path)).toMatchObject({
      file_paths: ["e.txt", "c.txt", "a.txt", "d.txt", "b.txt"],
    });
  });

  it("patchItemTranslationFields 只更新译文字段并保留条目持久事实", () => {
    const { database, lg_path } = create_database_project("translation-patch");

    database.set_items(lg_path, [
      {
        id: 1,
        src: "原文",
        dst: "",
        name_src: "原名",
        name_dst: null,
        status: "NONE",
        retry_count: 2,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
    ]);

    database.patch_item_translation_fields(lg_path, [
      {
        id: 1,
        patch: {
          dst: "译文",
          name_dst: ["译名"],
          status: "PROCESSED",
          retry_count: 0,
        },
      },
    ]);

    expect(database.get_all_items(lg_path)).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: "原名",
        name_dst: ["译名"],
        status: "PROCESSED",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
    ]);
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

    const database = create_database();
    expect(database.read_asset_content(lg_path, "legacy.txt")).toEqual(Buffer.from("legacy"));
  });
});

it("PDF 源文件在解析后变化时导入事务保留旧资产和译稿", async () => {
  const { database, lg_path } = create_database_project("pdf-source-conflict");
  const source = project_path("book.pdf");
  const bytes = create_pdf_fixture();
  fs.writeFileSync(source, bytes);
  const document = read_pdf_document(bytes);
  database.transaction(lg_path, () =>
    database.add_asset_from_source(lg_path, "book.pdf", source, document, 0),
  );
  fs.writeFileSync(source, create_pdf_fixture(["changed after parse"]));
  expect(() =>
    database.transaction(lg_path, () =>
      database.update_asset_from_source(lg_path, "book.pdf", source, document),
    ),
  ).toThrow("file.parse_failed");
  expect(database.read_asset_content(lg_path, "book.pdf")).toEqual(Buffer.from(bytes));
  expect(database.read_pdf_document(lg_path, "book.pdf")).toEqual(document);
});

it("PDF 摘要区分译稿覆盖、确认保留和省略，核对标记独立于处置", () => {
  const { database, lg_path } = create_database_project("pdf-summary");
  const source = project_path("summary.pdf");
  const bytes = create_pdf_fixture(["Text", null, null, null, "Pending"]);
  fs.writeFileSync(source, bytes);
  const document = read_pdf_document(bytes);
  document.pages[0]!.translation = { kind: "translate", markdown: "正文" };
  document.pages[1]!.translation = { kind: "omit", reason: "装饰页" };
  document.pages[2]!.translation = { kind: "keep", reason: "纯图页无需翻译" };
  document.pages[3]!.translation = { kind: "translate", markdown: "" };
  for (const page of document.pages) page.reviewed = true;
  database.transaction(lg_path, () =>
    database.add_asset_from_source(lg_path, "summary.pdf", source, document, 0),
  );
  expect(database.read_pdf_summaries(lg_path)["summary.pdf"]).toEqual({
    pages: 5,
    translated_pages: 2,
    kept_pages: 1,
    omitted_pages: 1,
  });
});

it("文件候选按外层路径统计全部条目", () => {
  const { database, lg_path } = create_database_project("file-counts");
  database.set_items(lg_path, [
    { file_path: "目录/书.epub", src: "一", status: "NONE" },
    { file_path: "目录/书.epub", src: "二", status: "EXCLUDED" },
    { file_path: "规则.xlsx", src: "三", status: "PROCESSED" },
  ]);
  expect(database.read_file_counts(lg_path)).toEqual(
    new Map([
      ["目录/书.epub", 2],
      ["规则.xlsx", 1],
    ]),
  );
});
