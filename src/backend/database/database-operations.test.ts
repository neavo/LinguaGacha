import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { NativeFs } from "../../native/native-fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/error";
import { JsonTool } from "../../shared/utils/json-tool";
import * as migrations from "../migration/database-migrations";
import { PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY } from "../migration/database-migrations";
import { ProjectDataReader } from "../project/project-data-reader";
import { ProjectDatabase, type ProjectDatabaseAccess } from "./database-operations";

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
async function create_database_project(
  name: string,
): Promise<{ database: ProjectDatabase; lg_path: string }> {
  const database = create_database();
  const lg_path = project_path(`${name}.lg`);
  await database.create_project(lg_path, name);
  return { database, lg_path };
}

/** 从公开读取结果取得指定 meta，保持数据库序列化边界。 */
async function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: unknown,
): Promise<unknown> {
  return (
    ((await database.get_all_meta(project_path)) as Record<string, unknown>)[key] ?? default_value
  );
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

afterEach(async () => {
  for (const database of cleanup_databases.splice(0)) {
    await database.close();
  }
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectDatabase", () => {
  it.each(["sync", "async"] as const)("%s 作用域在操作完成后释放真实连接", async (mode) => {
    const { database, lg_path } = await create_database_project("scope-timing");
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const close = vi.spyOn(DatabaseSync.prototype, "close");
    const read = (reader: ProjectDatabaseAccess) => {
      expect(reader.get_all_meta(lg_path).name).toBe("scope-timing");
      expect(close).not.toHaveBeenCalled();
      return 42;
    };
    if (mode === "sync") expect(await database.read(lg_path, read)).toBe(42);
    else {
      const result = database.read(lg_path, async (reader) => {
        read(reader);
        entered.resolve();
        await finish.promise;
        return 42;
      });
      await entered.promise;
      expect(close).not.toHaveBeenCalled();
      finish.resolve();
      await expect(result).resolves.toBe(42);
    }
    expect(close).toHaveBeenCalledTimes(1);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("作用域保留主异常、关闭异常及已提交恢复信息", async () => {
    const { database, lg_path } = await create_database_project("scope-errors");
    const main = new Error("operation failed");
    const committed = new AppError("data.committed_sync_failed", {
      public_details: {
        committed: true,
        action: "reload_project",
        section_revisions: { items: 7 },
      },
    });
    for (const error of [main, committed, undefined])
      for (const close_fails of [false, true]) {
        const close = new Error("close failed");
        if (close_fails)
          vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
            throw close;
          });
        const operation = () => {
          if (error !== undefined) throw error;
          return 42;
        };
        let caught: unknown;
        try {
          const result = await database.read(lg_path, operation);
          expect(result).toBe(42);
        } catch (failure) {
          caught = failure;
        }
        if (error !== undefined && close_fails) {
          expect(caught).toHaveProperty("cause.errors", [
            error,
            expect.objectContaining({ cause: close }),
          ]);
          if (error === committed)
            expect(caught).toMatchObject({
              code: committed.code,
              public_details: committed.public_details,
            });
        } else if (error !== undefined) expect(caught).toBe(error);
        else if (close_fails) expect(caught).toHaveProperty("cause", close);
        else expect(caught).toBeUndefined();
        await database.close();
        vi.restoreAllMocks();
      }
  });

  it("新建拒绝已有目标并保留原有内容", async () => {
    const database = create_database();
    const target = project_path("existing.lg");
    fs.writeFileSync(target, "existing content");
    await expect(
      (async () => await database.create_project(target, "replacement"))(),
    ).rejects.toThrow(expect.objectContaining({ code: "project.already_exists" }));
    expect(fs.readFileSync(target, "utf8")).toBe("existing content");
  });

  it("WAL 初始化失败会关闭连接并删除本次创建的空文件", async () => {
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
    await expect((async () => await database.create_project(target, "failed"))()).rejects.toThrow(
      expect.objectContaining({ code: "database.busy" }),
    );
    expect(fs.existsSync(target)).toBe(false);
    expect(has_project_sidecar(target)).toBe(false);
    failure.mockRestore();
    await database.create_project(target, "retry");
    expect(await read_meta(database, target, "name", "")).toBe("retry");
  });

  it("提交后关闭失败保留工程并明确禁止重放写入", async () => {
    const database = create_database();
    const target = project_path("committed.lg");
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    await expect(
      (async () => await database.create_project(target, "committed"))(),
    ).rejects.toThrow(
      expect.objectContaining({
        code: "data.committed_sync_failed",
        public_details: { committed: true, action: "reload_project" },
      }),
    );
    expect(fs.existsSync(target)).toBe(true);
    await database.close();
    expect(await read_meta(database, target, "name", "")).toBe("committed");
  });

  it("新建失败且清理失败时保留两个异常与残留文件", async () => {
    const native_fs = new NativeFs();
    const database = new ProjectDatabase(native_fs);
    cleanup_databases.push(database);
    const target = project_path("cleanup-failed.lg");
    vi.spyOn(native_fs, "unlink").mockImplementationOnce(() => {
      throw new Error("remove failed");
    });
    let failure: unknown;
    try {
      await database.create_project(target, "failed", () => {
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
          await expect((async () => await database.prepare(target))()).rejects.toThrow(
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
          await database.prepare(target);
        }
        await exited;
        await database.prepare(target);
        await database.transaction(target, (writer) =>
          writer.set_meta(target, "name", "available"),
        );
        expect(await read_meta(database, target, "name", "")).toBe("available");
      } finally {
        if (child.exitCode === null) child.kill();
        await exited;
      }
    },
    15000,
  );

  it("新建工程使用 FULL auto-vacuum", async () => {
    const database = create_database();
    const lg_path = project_path("auto-vacuum-full.lg");

    await database.create_project(lg_path, "auto-vacuum-full");

    expect(read_auto_vacuum_mode(lg_path)).toBe(1);
  });

  it("首次打开历史工程时回收空闲页并保留项目事实", async () => {
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

    await database.prepare(lg_path);
    expect(await read_meta(database, lg_path, "name", "")).toBe("legacy-auto-vacuum");

    expect(read_auto_vacuum_mode(lg_path)).toBe(1);
    expect(fs.statSync(lg_path).size).toBeLessThan(size_before_open);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("物理整理失败时仍可读取历史工程", async () => {
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

    await database.prepare(lg_path);
    expect(await read_meta(database, lg_path, "name", "")).toBe("deferred-auto-vacuum");
    expect(vacuum_failed).toBe(true);
    expect(read_auto_vacuum_mode(lg_path)).toBe(0);
  });

  it("普通 scoped 操作结束后不常驻 WAL 副文件", async () => {
    const database = create_database();
    const lg_path = project_path("scoped.lg");

    await database.create_project(lg_path, "scoped");
    await database.transaction(lg_path, (writer) =>
      writer.set_meta(lg_path, "target_language", "ZH"),
    );
    await read_meta(database, lg_path, "target_language", "");

    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("首次打开旧工程时写回质量规则身份并满足严格读取契约", async () => {
    const { database, lg_path } = await create_database_project("legacy-quality-rule-identity");
    await database.transaction(lg_path, (writer) =>
      writer.set_rules(lg_path, "glossary", [{ src: "缺失身份", dst: "译文" }]),
    );
    const applied_ids = (await read_meta(
      database,
      lg_path,
      PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
      [],
    )) as string[];
    await database.close_project(lg_path);
    // 新工程已执行全部迁移，移除目标 id 才能模拟历史工程首次打开。
    {
      using legacy_db = new DatabaseSync(lg_path);
      legacy_db
        .prepare("UPDATE meta SET value = ? WHERE key = ?")
        .run(
          JsonTool.stringifyStrict(
            applied_ids.filter((id) => id !== "quality-rule-entry-identity"),
          ),
          PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
        );
    }

    await database.prepare(lg_path);
    const quality = await database.read(lg_path, (reader) => {
      const data_reader = new ProjectDataReader(reader);
      return data_reader.build_quality_block(lg_path, data_reader.get_all_meta(lg_path));
    });
    expect(quality.glossary.entries).toHaveLength(1);

    expect(await database.get_rules(lg_path, "glossary")).toEqual([
      { entry_id: expect.any(String), src: "缺失身份", dst: "译文" },
    ]);
    expect(
      await read_meta(
        database,
        lg_path,
        PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
        [],
      ),
    ).toContain("quality-rule-entry-identity");
  });

  it("作用域结束后旧访问对象失效，排队读取等待事务提交", async () => {
    const { database, lg_path } = await create_database_project("queued");
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let saved: ProjectDatabaseAccess | undefined;
    const transaction = database.transaction(lg_path, async (writer) => {
      saved = writer;
      writer.set_meta(lg_path, "value", 42);
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    let read_finished = false;
    const read = database.get_all_meta(lg_path).then((meta) => {
      read_finished = true;
      return meta;
    });
    await Promise.resolve();
    expect(read_finished).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(true);
    finish.resolve();
    await transaction;
    expect(await read).toHaveProperty("value", 42);
    expect(() => saved!.get_all_meta(lg_path)).toThrow();
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("关闭失败保留连接，后续收尾可以重试", async () => {
    const { database, lg_path } = await create_database_project("close-retry");
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => {
      throw new Error("close failed");
    });
    await expect(database.get_all_meta(lg_path)).rejects.toThrow();
    await database.close();
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("项目数据库初始化失败时关闭连接并保留原始原因", async () => {
    const database = create_database();
    const lg_path = project_path("open-failed.lg");
    const open_failure = new Error("migration failed");
    let connection_close: ReturnType<typeof vi.spyOn> | null = null;
    vi.spyOn(migrations, "run_project_database_migrations").mockImplementationOnce((db) => {
      connection_close = vi.spyOn(db, "close");
      throw open_failure;
    });

    await expect((async () => await database.prepare(lg_path))()).rejects.toThrow(
      expect.objectContaining({
        cause: open_failure,
        diagnostic_context: expect.objectContaining({ operation: "migration" }),
      }),
    );

    expect(connection_close).not.toBeNull();
    expect(connection_close).toHaveBeenCalledTimes(1);
  });

  it("事务失败时回滚已排队写入", async () => {
    const database = create_database();
    const lg_path = project_path("rollback.lg");
    await database.create_project(lg_path, "rollback");

    await expect(
      database.transaction(lg_path, (database) => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("rollback");
      }),
    ).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ message: "rollback" }) }),
    );

    expect(await read_meta(database, lg_path, "target_language", "missing")).toBe("missing");
  });

  it("创建工程事务失败时先结束 scoped 连接再删除新文件", async () => {
    const database = create_database();
    const lg_path = project_path("create-rollback.lg");

    await expect(
      (async () =>
        await database.create_project(lg_path, "create-rollback", (database) => {
          database.set_meta(lg_path, "target_language", "ZH");
          throw new Error("rollback");
        }))(),
    ).rejects.toThrow(
      expect.objectContaining({ cause: expect.objectContaining({ message: "rollback" }) }),
    );

    expect(fs.existsSync(lg_path)).toBe(false);
    expect(has_project_sidecar(lg_path)).toBe(false);
  });

  it("回滚失败时保留两个原因并关闭失效连接", async () => {
    const { database, lg_path } = await create_database_project("rollback-failed");
    const original = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return original.call(this, sql);
    });
    let failure: unknown;
    try {
      await database.transaction(lg_path, (database) => {
        database.set_meta(lg_path, "target_language", "ZH");
        throw new Error("write failed");
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toHaveProperty("cause.errors", [
      expect.objectContaining({ message: "write failed" }),
      expect.objectContaining({ message: "rollback failed" }),
    ]);
    expect(has_project_sidecar(lg_path)).toBe(false);
    expect(await read_meta(database, lg_path, "target_language", "missing")).toBe("missing");
  });
});
