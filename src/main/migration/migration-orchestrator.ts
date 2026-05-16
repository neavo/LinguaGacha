import type { DatabaseSync } from "node:sqlite";

import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { MIGRATIONS, PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS } from "./migration-registry";
import type {
  MigrationDescriptor,
  ProjectDatabaseMigrationContext,
  ProjectOpenMigrationContext,
  StartupMigrationContext,
} from "./migration-types";
import { PROJECT_DATABASE_SCHEMA_VERSION } from "./migrations/project-schema-migration";

export { PROJECT_DATABASE_SCHEMA_VERSION } from "./migrations/project-schema-migration";
export { PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS };

/**
 * `.lg` meta 中记录已完成写回迁移的当前键名；schema 迁移不写入这里。
 */
export const PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY =
  "applied_writeback_migrations";

type MetaRow = Record<string, unknown>;

/**
 * 统一迁移编排器只暴露生命周期 hook，具体历史语义留在单场景 migration 文件中。
 */
export class MigrationOrchestrator {
  /**
   * migrations 在测试中可注入，生产态只使用 registry 中的当前迁移集合。
   */
  public constructor(private readonly migrations: readonly MigrationDescriptor[] = MIGRATIONS) {}

  /**
   * Core 启动期迁移只处理 userdata/resource 文件落点，必须早于设置读取和 Gateway 启动。
   */
  public run_startup_migrations(context: StartupMigrationContext): void {
    for (const migration of this.by_order((item) => item.run_startup !== undefined)) {
      migration.run_startup?.(context);
    }
  }

  /**
   * `.lg` 首次打开时先补 schema，再跑写回迁移，保证后续业务读写只看到当前物理契约。
   */
  public run_project_database_migrations(db: DatabaseSync): void {
    const context = { db };
    this.run_project_database_schema(context);
    this.run_project_database_writebacks(context);
  }

  /**
   * 项目打开期迁移只收集 operation，调用方负责把它们与 updated_at 放进同一个事务。
   */
  public async build_project_open_operations(
    context: ProjectOpenMigrationContext,
  ): Promise<DatabaseOperation[]> {
    const operations: DatabaseOperation[] = [];
    for (const migration of this.by_order(
      (item) => item.build_project_open_operations !== undefined,
    )) {
      const next_operations = await migration.build_project_open_operations?.(context);
      operations.push(...(next_operations ?? []));
    }
    return operations;
  }

  /**
   * schema hook 每次都执行幂等建表/加列逻辑，不使用写回 id 跳过。
   */
  private run_project_database_schema(context: ProjectDatabaseMigrationContext): void {
    for (const migration of this.by_order(
      (item) => item.run_project_database_schema !== undefined,
    )) {
      this.run_in_transaction(context.db, () => migration.run_project_database_schema?.(context));
    }
  }

  /**
   * writeback hook 按迁移 id 跳过已完成场景，每个场景单独事务提交自己的标记。
   */
  private run_project_database_writebacks(context: ProjectDatabaseMigrationContext): void {
    const applied_ids = this.read_applied_writeback_migration_ids(context.db);
    for (const migration of this.by_order(
      (item) => item.run_project_database_writeback !== undefined,
    )) {
      if (applied_ids.has(migration.id)) {
        continue;
      }
      this.run_in_transaction(context.db, () => {
        migration.run_project_database_writeback?.(context);
        applied_ids.add(migration.id);
        this.write_applied_writeback_migration_ids(context.db, applied_ids);
      });
    }
  }

  /**
   * 读取已完成迁移 id；损坏或旧格式值视为未执行，让幂等迁移重新修正项目事实。
   */
  private read_applied_writeback_migration_ids(db: DatabaseSync): Set<string> {
    const row = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY);
    if (row === undefined) {
      return new Set<string>();
    }
    try {
      const value = JsonTool.parseStrict<unknown>(row_text(row, "value"));
      return Array.isArray(value)
        ? new Set(value.filter((entry): entry is string => typeof entry === "string"))
        : new Set<string>();
    } catch {
      return new Set<string>();
    }
  }

  /**
   * 写入 registry 顺序下的迁移 id，避免 Set 插入顺序影响 meta 可读性。
   */
  private write_applied_writeback_migration_ids(db: DatabaseSync, applied_ids: Set<string>): void {
    const ordered_ids = this.writeback_migration_ids().filter((id) => applied_ids.has(id));
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY,
      JsonTool.stringifyStrict(ordered_ids),
    );
  }

  /**
   * 单个 schema/writeback hook 必须原子提交，失败时保留原始异常并回滚该场景。
   */
  private run_in_transaction(db: DatabaseSync, callback: () => void): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      callback();
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 回滚失败时保留原始异常，避免掩盖真正的迁移错误
      }
      throw error;
    }
  }

  /**
   * 每个 hook 都使用同一排序规则，避免注册表位置成为隐式顺序来源。
   */
  private by_order(predicate: (migration: MigrationDescriptor) => boolean): MigrationDescriptor[] {
    return this.migrations.filter(predicate).sort((left, right) => left.order - right.order);
  }

  /**
   * 当前编排器实例的写回 id 集合，测试注入 registry 时不能读取生产常量。
   */
  private writeback_migration_ids(): string[] {
    return this.by_order((item) => item.run_project_database_writeback !== undefined).map(
      (migration) => migration.id,
    );
  }
}

export const migration_orchestrator = new MigrationOrchestrator(); // 生产态共享编排器，避免各入口重复装配 registry

/**
 * 新建工程的 meta 必须与当前 registry 对齐，避免新工程再次执行旧写回迁移。
 */
export function build_current_project_database_meta(): Record<string, DatabaseJsonValue> {
  return {
    schema_version: PROJECT_DATABASE_SCHEMA_VERSION,
    [PROJECT_DATABASE_APPLIED_WRITEBACK_MIGRATIONS_META_KEY]:
      PROJECT_DATABASE_WRITEBACK_MIGRATION_IDS,
  };
}

/**
 * SQLite meta 行可能来自不同底层类型，读取 JSON 前统一收窄为字符串。
 */
function row_text(row: MetaRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}
