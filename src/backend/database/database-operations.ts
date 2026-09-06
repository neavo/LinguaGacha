import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  build_current_project_database_meta,
  migration_orchestrator,
} from "../migration/migration-orchestrator";
import { ZstdTool } from "../../shared/utils/zstd-tool";
import { JsonTool } from "../../shared/utils/json-tool";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import { normalize_project_item_field_patch } from "../../shared/project/project-item-update";
import {
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";

type DatabaseRow = Record<string, unknown>;

// SQLite 的 IN 参数统一在数据库边界分块；业务批量大小不应复用这个存储安全值。
const SQLITE_IN_CLAUSE_CHUNK_SIZE = 500;
const SQLITE_AUTO_VACUUM_FULL = 1; // SQLite PRAGMA 用 1 表示 FULL，文件头查询与设置共享该协议值

/** 让所有 IN 查询共享同一存储分块边界，避免调用方各自猜测 SQLite 参数容量。 */
function for_each_sqlite_in_clause_chunk<T>(
  values: readonly T[],
  callback: (chunk: readonly T[]) => void,
): void {
  for (let index = 0; index < values.length; index += SQLITE_IN_CLAUSE_CHUNK_SIZE) {
    callback(values.slice(index, index + SQLITE_IN_CLAUSE_CHUNK_SIZE));
  }
}

export type ProjectDatabaseWrite = (database: ProjectDatabase) => void;

/**
 * 单个 .lg 当前打开连接的生命周期记录，只表达 scoped 使用和显式租约
 */
interface ProjectDatabaseConnectionRecord {
  readonly normalized_path: string; // 连接表的唯一键，避免同一 .lg 因相对路径重复打开
  readonly db: DatabaseSync;
  lease_count: number; // 任务等长流程正在显式保留连接
  scoped_use_count: number; // 当前同步 workflow 正在使用连接，归零后才能收尾
  closed: boolean; // 隔离已关闭记录，保证迟到租约释放不会二次操作 SQLite 句柄
}

const CURRENT_NONE = "NONE";

/**
 * 将 SQLite 文本列按严格 JSON 协议解析，非文本空值统一为 null。
 */
function json_parse(raw_value: unknown): JsonValue {
  if (typeof raw_value !== "string") {
    return null;
  }
  return JsonTool.parseStrict<JsonValue>(raw_value);
}

/**
 * 将 SQLite 行字段收窄为稳定文本。
 */
function row_text(row: DatabaseRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * 将 SQLite number、bigint 或文本数字统一为 JavaScript number。
 */
function row_number(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number(value ?? 0);
}

/**
 * 将 SQLite blob 复制为 Buffer，异常值返回空字节。
 */
function bytes_from_blob(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
}

/**
 * 在创建数据库门面时提前确认 asset 压缩运行时可用。
 */
function ensure_database_runtime_available(): void {
  if (!ZstdTool.isRuntimeAvailable()) {
    throw new AppErrors.AppError("runtime.capability_missing");
  }
}

/**
 * Backend 内部 .lg 物理读写入口，集中持有 SQLite、事务和 asset 压缩格式
 */
export class ProjectDatabase {
  private readonly connection_records = new Map<string, ProjectDatabaseConnectionRecord>(); // 只保存当前活跃连接，不再表达永久缓存
  private readonly storage_maintenance_deferred_paths = new Set<string>(); // 当前实例内暂缓物理整理的工程路径
  private readonly native_fs: NativeFs; // 统一 .lg 文件、源 asset 和 SQLite 路径的原生 IO 策略

  /**
   * 初始化 ProjectDatabase 依赖，保持外部写入口清晰
   */
  public constructor(native_fs: NativeFs = default_native_fs) {
    this.native_fs = native_fs;
    ensure_database_runtime_available();
  }

  /**
   * 关闭底层资源，确保数据库句柄不会跨工程泄漏
   */
  public close(): void {
    const records = [...this.connection_records.values()];
    this.connection_records.clear();
    this.storage_maintenance_deferred_paths.clear();
    const errors: unknown[] = [];
    for (const record of records) {
      try {
        this.close_connection_record(record);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to close project database connections.");
    }
  }

  /**
   * 重建目标 .lg，并让可选领域初始化在同一连接的事务内完成；领域初始化失败时清理半成品。
   */
  public create_project(project_path: string, name: string, initialize?: () => void): void {
    let initialized = false;
    try {
      this.initialize_project(project_path, name);
      initialized = true;
      if (initialize !== undefined) {
        this.transaction(project_path, initialize);
      }
    } catch (error) {
      if (initialized) {
        this.close_project_connection(project_path);
        this.native_fs.remove(project_path, { force: true });
      }
      throw error;
    } finally {
      this.close_connection_if_idle_path(project_path);
    }
  }

  /**
   * 工程卸载时强制释放该路径的连接与租约。
   */
  public close_project(project_path: string): void {
    this.close_project_connection(project_path);
  }

  /**
   * 以 BEGIN IMMEDIATE 执行同步回调；回调内的 typed 方法复用当前 scoped 连接。
   */
  public transaction<T>(project_path: string, callback: () => T): T {
    return this.with_project_connection(project_path, (db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = callback();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  /**
   * 以下公开 typed 方法只负责 scoped 连接复用；SQL 语义集中在对应私有读写实现。
   */
  public set_meta(project_path: string, key: string, value: JsonValue): void {
    this.with_project_connection(project_path, () => this.write_meta(project_path, key, value));
  }

  public upsert_meta_entries(project_path: string, meta: JsonRecord): void {
    this.with_project_connection(project_path, () => this.write_meta_entries(project_path, meta));
  }

  public get_all_meta(project_path: string): JsonValue {
    return this.with_project_connection(project_path, () => this.read_all_meta(project_path));
  }

  public bump_section_revisions(project_path: string, sections: string[]): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.advance_section_revisions(project_path, sections),
    );
  }

  public add_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
    sort_order: number | null = null,
  ): void {
    this.with_project_connection(project_path, () =>
      this.insert_asset_from_source(project_path, asset_path, source_path, sort_order),
    );
  }

  public update_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
  ): void {
    this.with_project_connection(project_path, () =>
      this.replace_asset_from_source(project_path, asset_path, source_path),
    );
  }

  public delete_asset(project_path: string, asset_path: string): void {
    this.with_project_connection(project_path, () => this.remove_asset(project_path, asset_path));
  }

  public get_all_asset_records(project_path: string): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_all_asset_records(project_path),
    );
  }

  public get_asset_count(project_path: string): number {
    return this.with_project_connection(project_path, () => this.read_asset_count(project_path));
  }

  public update_asset_sort_orders(project_path: string, ordered_paths: string[]): void {
    this.with_project_connection(project_path, () =>
      this.write_asset_sort_orders(project_path, ordered_paths),
    );
  }

  public get_all_items(project_path: string): JsonValue {
    return this.with_project_connection(project_path, () => this.read_all_items(project_path));
  }

  public get_item_count(project_path: string): number {
    return this.with_project_connection(project_path, () => this.read_item_count(project_path));
  }

  public get_item_status_summary(project_path: string): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_item_status_summary(project_path),
    );
  }

  public get_items_by_ids(project_path: string, item_ids: number[]): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_items_by_ids(project_path, item_ids),
    );
  }

  public get_item_write_facts_by_ids(project_path: string, item_ids: number[]): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_item_write_facts_by_ids(project_path, item_ids),
    );
  }

  public set_items(project_path: string, items: JsonValue[]): number[] {
    return this.with_project_connection(project_path, () =>
      this.replace_items(project_path, items),
    );
  }

  public patch_item_fields_by_ids(
    project_path: string,
    item_ids: number[],
    patch: JsonRecord,
  ): void {
    this.with_project_connection(project_path, () =>
      this.write_item_fields_by_ids(project_path, item_ids, patch),
    );
  }

  public patch_item_translation_fields(project_path: string, patches: JsonValue[]): void {
    this.with_project_connection(project_path, () =>
      this.write_item_translation_fields(project_path, patches),
    );
  }

  public get_rules(project_path: string, rule_type: string): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_rules(project_path, rule_type),
    );
  }

  public set_rules(project_path: string, rule_type: string, rules: JsonValue[]): void {
    this.with_project_connection(project_path, () =>
      this.write_rules(project_path, rule_type, rules),
    );
  }

  public get_rule_text(project_path: string, rule_type: string): string {
    return this.with_project_connection(project_path, () =>
      this.read_rule_text(project_path, rule_type),
    );
  }

  public set_rule_text(project_path: string, rule_type: string, text: string): void {
    this.with_project_connection(project_path, () =>
      this.write_rule_text(project_path, rule_type, text),
    );
  }

  public get_project_summary(project_path: string): JsonValue {
    return this.with_project_connection(project_path, () =>
      this.read_project_summary(project_path),
    );
  }

  /**
   * 按 asset 路径读取解压后的内容，隐藏 .lg 内部压缩格式
   */
  public read_asset_content(project_path: string, asset_path: string): Buffer | null {
    return this.with_project_connection(project_path, (db) => {
      const row = db.prepare("SELECT data FROM assets WHERE path = ?").get(asset_path); // 调用方只消费解压后的原始 bytes，Zstd 格式细节留在 Backend 内部
      if (row === undefined) {
        return null;
      }
      return ZstdTool.decompress(bytes_from_blob(row["data"]));
    });
  }

  /**
   * 为任务等可预见长流程保留 SQLite 连接，释放函数幂等且不暴露 SQL 句柄
   */
  public acquire_project_lease(project_path: string, _owner: string): () => void {
    const record = this.open_project_record(path.resolve(project_path));
    record.lease_count += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      record.lease_count = Math.max(0, record.lease_count - 1);
      this.close_connection_if_idle(record);
    };
  }

  /**
   * 打开并迁移工程数据库，确保后续读写看到当前 schema
   */
  private open_project(project_path: string): DatabaseSync {
    return this.open_project_record(path.resolve(project_path)).db;
  }

  /**
   * 取得连接记录；默认 operation 由外层 scoped 使用计数决定何时关闭
   */
  private open_project_record(normalized_path: string): ProjectDatabaseConnectionRecord {
    const cached = this.connection_records.get(normalized_path);
    if (cached !== undefined) {
      return cached;
    }
    this.native_fs.make_dir(path.dirname(normalized_path));
    const db = new DatabaseSync(this.native_fs.to_native_path(normalized_path));
    try {
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA synchronous=NORMAL");
      db.exec("PRAGMA busy_timeout=5000");
      this.apply_project_storage_mode(normalized_path, db);
      // 每次首次打开都先跑 schema/writeback 迁移，让业务读写只面对当前 .lg 物理契约
      migration_orchestrator.run_project_database_migrations(db);
    } catch (open_error) {
      try {
        db.close();
      } catch (close_error) {
        throw new AggregateError(
          [open_error, close_error],
          "Project database initialization and connection cleanup both failed.",
        );
      }
      throw open_error;
    }
    const record: ProjectDatabaseConnectionRecord = {
      normalized_path,
      db,
      lease_count: 0,
      scoped_use_count: 0,
      closed: false,
    };
    this.connection_records.set(normalized_path, record);
    return record;
  }

  /**
   * 将 .lg 物理回收模式统一为 FULL；整理暂缓不影响数据库事实读取，由后续实例重新尝试。
   */
  private apply_project_storage_mode(normalized_path: string, db: DatabaseSync): void {
    if (this.storage_maintenance_deferred_paths.has(normalized_path)) {
      return;
    }
    try {
      const row = this.value_record(db.prepare("PRAGMA auto_vacuum").get());
      if (row_number(row, "auto_vacuum") === SQLITE_AUTO_VACUUM_FULL) {
        return;
      }
      db.exec("PRAGMA auto_vacuum=FULL");
      db.exec("VACUUM");
    } catch {
      // 物理回收不改变业务数据语义；当前实例暂缓后续整理，让正常迁移继续判断工程是否可用。
      this.storage_maintenance_deferred_paths.add(normalized_path);
    }
  }

  /**
   * 关闭指定工程连接并清空租约计数，用于工程卸载和文件重建收尾
   */
  private close_project_connection(project_path: string): void {
    const normalized_path = path.resolve(project_path);
    const record = this.connection_records.get(normalized_path);
    if (record === undefined) {
      return;
    }
    record.lease_count = 0;
    record.scoped_use_count = 0;
    this.close_connection_record(record);
  }

  /**
   * 默认数据库 workflow 使用 scoped connection，完成后在无租约时立即 checkpoint/close
   */
  private with_project_connection<T>(project_path: string, callback: (db: DatabaseSync) => T): T {
    const record = this.open_project_record(path.resolve(project_path));
    record.scoped_use_count += 1;
    try {
      return callback(record.db);
    } finally {
      record.scoped_use_count -= 1;
      this.close_connection_if_idle(record);
    }
  }

  /**
   * 无长租约且无 scoped workflow 时收尾连接，让稳定态回到单个 .lg 文件
   */
  private close_connection_if_idle(record: ProjectDatabaseConnectionRecord): void {
    if (record.closed) {
      return;
    }
    if (record.lease_count > 0 || record.scoped_use_count > 0) {
      return;
    }
    this.close_connection_record(record);
  }

  /**
   * 按路径查找连接记录并尝试空闲收尾，供 createProject 特例使用
   */
  private close_connection_if_idle_path(project_path: string): void {
    const record = this.connection_records.get(path.resolve(project_path));
    if (record !== undefined) {
      this.close_connection_if_idle(record);
    }
  }

  /**
   * SQLite 正常 checkpoint 后关闭连接；不手动删除 -wal / -shm 副文件
   */
  private close_connection_record(record: ProjectDatabaseConnectionRecord): void {
    if (record.closed) {
      return;
    }
    record.closed = true;
    this.connection_records.delete(record.normalized_path);
    const errors: unknown[] = [];
    try {
      record.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      errors.push(error);
    }
    try {
      record.db.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, "Failed to close a project database connection.");
    }
  }

  /**
   * 创建新 .lg 数据库并初始化 schema，作为工程落盘入口
   */
  private initialize_project(project_path: string, name: string): null {
    const normalized_path = path.resolve(project_path);
    this.close_project(normalized_path);
    this.storage_maintenance_deferred_paths.delete(normalized_path);
    if (this.native_fs.exists(normalized_path)) {
      this.native_fs.unlink(normalized_path);
    }
    const db = this.open_project(normalized_path);
    const now = new Date().toISOString();
    this.upsert_meta_entries_with_db(db, {
      ...build_current_project_database_meta(),
      name,
      created_at: now,
      updated_at: now,
    });
    return null;
  }

  /**
   * 写入单个 meta 值，维持 meta 更新的统一序列化方式
   */
  private write_meta(project_path: string, key: string, value: JsonValue): void {
    this.upsert_meta_entries(project_path, { [key]: value });
  }

  /**
   * 批量写入 meta 项，减少跨边界多次 database workflow
   */
  private write_meta_entries(project_path: string, meta: DatabaseRow): void {
    this.upsert_meta_entries_with_db(this.open_project(project_path), meta);
  }

  /**
   * 在既有事务连接内写入 meta，避免事务中重新取句柄
   */
  private upsert_meta_entries_with_db(db: DatabaseSync, meta: DatabaseRow): void {
    const statement = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(meta)) {
      statement.run(key, JsonTool.stringifyStrict(value));
    }
  }

  /**
   * 读取完整 meta 快照，供运行态编码一次性构建事实
   */
  private read_all_meta(project_path: string): JsonValue {
    const db = this.open_project(project_path);
    const result: MutableJsonRecord = {};
    for (const row of db.prepare("SELECT key, value FROM meta").all()) {
      result[row_text(row, "key")] = json_parse(row["value"]);
    }
    return result;
  }

  /**
   * 由内部任务数据路由调用的窄 revision 推进入口；公开读取和 ack 仍由 项目域计算
   */
  private advance_section_revisions(project_path: string, sections: string[]): JsonValue {
    const db = this.open_project(project_path);
    const supported_sections = new Set(["files", "items"]);
    const next_revisions: Record<string, number> = {};
    for (const section of sections) {
      if (!supported_sections.has(section) || section in next_revisions) {
        continue;
      }
      const key = `project_runtime_revision.${section}`;
      const current = this.normalize_revision_value(this.get_meta_from_db(db, key, 0));
      const next = current + 1;
      this.upsert_meta_entries_with_db(db, { [key]: next });
      next_revisions[section] = next;
    }
    return next_revisions;
  }

  /**
   * 在调用方已持有的事务连接内读取单个 meta，避免重新取得 scoped 连接。
   */
  private get_meta_from_db(db: DatabaseSync, key: string, default_value: JsonValue): JsonValue {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row === undefined ? default_value : json_parse(row["value"]);
  }

  /**
   * 将旧 revision meta 归一为非负整数基线。
   */
  private normalize_revision_value(value: JsonValue): number {
    const revision = Number(value ?? 0);
    return Number.isFinite(revision) && revision > 0 ? Math.trunc(revision) : 0;
  }

  /**
   * 计算下一个 asset 排序位，保持文件列表顺序稳定
   */
  private get_next_asset_sort_order(db: DatabaseSync): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM assets")
      .get();
    return row === undefined ? 0 : row_number(row, "next_sort_order");
  }

  /**
   * 从源文件导入 asset，统一压缩和排序字段写入
   */
  private insert_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
    sort_order: number | null,
  ): void {
    const original_data = this.native_fs.read_file(source_path);
    const compressed = ZstdTool.compress(original_data);
    this.add_asset_buffer(
      project_path,
      asset_path,
      compressed,
      original_data.byteLength,
      sort_order,
    );
  }

  /**
   * 写入 asset buffer，集中处理压缩和记录插入
   */
  private add_asset_buffer(
    project_path: string,
    asset_path: string,
    compressed: Buffer,
    original_size: number,
    sort_order: number | null,
  ): void {
    const db = this.open_project(project_path);
    const effective_sort_order = sort_order ?? this.get_next_asset_sort_order(db);
    db.prepare(
      `INSERT INTO assets (path, sort_order, data, original_size, compressed_size)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(asset_path, effective_sort_order, compressed, original_size, compressed.byteLength);
  }

  /**
   * 用源文件更新 asset 内容，保持路径记录不被调用方重建
   */
  private replace_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
  ): void {
    const original_data = this.native_fs.read_file(source_path);
    const compressed = ZstdTool.compress(original_data);
    const result = this.open_project(project_path)
      .prepare(
        `UPDATE assets
         SET data = ?, original_size = ?, compressed_size = ?
         WHERE path = ?`,
      )
      .run(compressed, original_data.byteLength, compressed.byteLength, asset_path);
    if (Number(result.changes) === 0) {
      throw new AppErrors.AppError("database.conflict", {
        diagnostic_context: { reason: "Asset does not exist and cannot be updated." },
      });
    }
  }

  /**
   * 删除 asset 记录，保持文件移除只走存储入口
   */
  private remove_asset(project_path: string, asset_path: string): void {
    this.open_project(project_path).prepare("DELETE FROM assets WHERE path = ?").run(asset_path);
  }

  /**
   * 读取 asset 记录快照，供运行态排序与导出使用
   */
  private read_all_asset_records(project_path: string): JsonValue {
    return this.open_project(project_path)
      .prepare("SELECT path, sort_order FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => ({ path: row_text(row, "path"), sort_order: row_number(row, "sort_order") }));
  }

  /**
   * 文件数量直接由 SQL 聚合读取，manifest 不为计数预热 files section
   */
  private read_asset_count(project_path: string): number {
    const row = this.open_project(project_path)
      .prepare("SELECT COUNT(*) AS count FROM assets")
      .get();
    return row === undefined ? 0 : row_number(row, "count");
  }

  /**
   * 批量更新 asset 顺序，保证文件重排一次事务完成
   */
  private write_asset_sort_orders(project_path: string, ordered_paths: string[]): void {
    const statement = this.open_project(project_path).prepare(
      "UPDATE assets SET sort_order = ? WHERE path = ?",
    );
    for (const [sort_order, asset_path] of ordered_paths.entries()) {
      statement.run(sort_order, asset_path);
    }
  }

  /**
   * 读取全部条目事实，供项目数据读取和任务快照重建
   */
  private read_all_items(project_path: string): JsonValue {
    return this.open_project(project_path)
      .prepare("SELECT id, data FROM items ORDER BY id")
      .all()
      .map((row) => ({ ...this.value_record(json_parse(row["data"])), id: row_number(row, "id") }));
  }

  /**
   * 条目数量直接由 SQL 聚合读取，manifest 不为计数扫描完整 item payload
   */
  private read_item_count(project_path: string): number {
    const row = this.open_project(project_path)
      .prepare("SELECT COUNT(*) AS count FROM items")
      .get();
    return row === undefined ? 0 : row_number(row, "count");
  }

  /**
   * 翻译统计口径由 status 决定，SQL 聚合为缺失 meta 的校对保存提供低成本基线。
   */
  private read_item_status_summary(project_path: string): JsonValue {
    const row = this.open_project(project_path)
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('NONE', 'PROCESSED', 'ERROR') THEN 1 ELSE 0 END), 0)
             AS total_line,
           COALESCE(SUM(CASE WHEN status = 'PROCESSED' THEN 1 ELSE 0 END), 0)
             AS processed_line,
           COALESCE(SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END), 0)
             AS error_line
         FROM (
           SELECT json_extract(data, '$.status') AS status
           FROM items
         )`,
      )
      .get();
    const processed_line = row === undefined ? 0 : row_number(row, "processed_line");
    const error_line = row === undefined ? 0 : row_number(row, "error_line");
    return {
      total_line: row === undefined ? 0 : row_number(row, "total_line"),
      processed_line,
      error_line,
      line: processed_line + error_line,
    };
  }

  /**
   * 按 id 读取条目，减少校对和任务提交后的回查范围
   */
  private read_items_by_ids(project_path: string, item_ids: number[]): JsonValue {
    const normalized_ids = [
      ...new Set(
        item_ids.map((item_id) => Number(item_id)).filter((item_id) => Number.isFinite(item_id)),
      ),
    ];
    if (normalized_ids.length === 0) {
      return [];
    }
    const rows_by_id = new Map<number, DatabaseRow>();
    const db = this.open_project(project_path);
    for_each_sqlite_in_clause_chunk(normalized_ids, (chunk) => {
      const placeholders = chunk.map(() => "?").join(",");
      for (const row of db
        .prepare(`SELECT id, data FROM items WHERE id IN (${placeholders})`)
        .all(...chunk)) {
        const item_id = row_number(row, "id");
        rows_by_id.set(item_id, { ...this.value_record(json_parse(row["data"])), id: item_id });
      }
    });
    return normalized_ids
      .map((item_id) => rows_by_id.get(item_id))
      .filter((item): item is DatabaseRow => item !== undefined) as JsonValue;
  }

  /**
   * 校对统一字段写入只需要少量事实，避免为状态设置解析完整 item JSON。
   */
  private read_item_write_facts_by_ids(project_path: string, item_ids: number[]): JsonValue {
    const normalized_ids = [
      ...new Set(
        item_ids
          .map((item_id) => Number(item_id))
          .filter((item_id) => Number.isInteger(item_id) && item_id > 0),
      ),
    ];
    if (normalized_ids.length === 0) {
      return [];
    }
    const rows_by_id = new Map<number, DatabaseRow>();
    const db = this.open_project(project_path);
    for_each_sqlite_in_clause_chunk(normalized_ids, (chunk) => {
      const placeholders = chunk.map(() => "?").join(",");
      for (const row of db
        .prepare(
          `SELECT
             id,
             json_extract(data, '$.dst') AS dst,
             json_extract(data, '$.name_dst') AS name_dst,
             json_type(data, '$.name_dst') AS name_dst_type,
             json_extract(data, '$.status') AS status,
             json_extract(data, '$.retry_count') AS retry_count
           FROM items
           WHERE id IN (${placeholders})`,
        )
        .all(...chunk)) {
        const item_id = row_number(row, "id");
        rows_by_id.set(item_id, {
          id: item_id,
          dst: row_text(row, "dst"),
          name_dst: this.read_item_name_value(row, "name_dst", "name_dst_type"),
          status: row_text(row, "status"),
          retry_count: row_number(row, "retry_count"),
        });
      }
    });
    return normalized_ids
      .map((item_id) => rows_by_id.get(item_id))
      .filter((item): item is DatabaseRow => item !== undefined) as JsonValue;
  }

  /**
   * 根据 SQLite json_type 恢复 name 字段的 null、string 或 array 形状。
   */
  private read_item_name_value(row: DatabaseRow, value_key: string, type_key: string): JsonValue {
    const value_type = row_text(row, type_key);
    if (value_type === "" || value_type === "null") {
      return null;
    }
    const value = row[value_key];
    if (value_type === "array") {
      return json_parse(value);
    }
    return typeof value === "string" ? value : String(value ?? "");
  }

  /**
   * 批量写入条目事实，确保导入和重置链路高效落盘
   */
  private replace_items(project_path: string, items: JsonValue[]): number[] {
    const db = this.open_project(project_path);
    db.prepare("DELETE FROM items").run();
    const insert_with_id = db.prepare("INSERT INTO items (id, data) VALUES (?, ?)");
    const insert = db.prepare("INSERT INTO items (data) VALUES (?)");
    const ids: number[] = [];
    for (const raw_item of items) {
      const item = this.value_record(raw_item);
      const item_id = item["id"];
      const data = { ...item };
      delete data["id"];
      if (item_id !== undefined && item_id !== null && item_id !== "") {
        insert_with_id.run(Number(item_id), JsonTool.stringifyStrict(data));
        ids.push(Number(item_id));
      } else {
        ids.push(Number(insert.run(JsonTool.stringifyStrict(data)).lastInsertRowid));
      }
    }
    return ids;
  }

  /**
   * 将公开 item 字段 patch 编译为 SQLite json_set 路径和值。
   */
  private build_item_field_patch_entries(
    patch: DatabaseRow,
    options: { clamp_retry_count: boolean },
  ): Array<{
    path: string;
    value: JsonValue;
    json: boolean;
  }> {
    const normalized_patch = normalize_project_item_field_patch(patch);
    if (normalized_patch === null) {
      return [];
    }
    const patch_entries: Array<{
      path: string;
      value: JsonValue;
      json: boolean;
    }> = [];
    if (normalized_patch.dst !== undefined) {
      patch_entries.push({ path: "$.dst", value: normalized_patch.dst, json: false });
    }
    if (Object.hasOwn(normalized_patch, "name_dst")) {
      patch_entries.push({
        path: "$.name_dst",
        value: normalized_patch.name_dst as JsonValue,
        json: true,
      });
    }
    if (normalized_patch.status !== undefined) {
      patch_entries.push({ path: "$.status", value: normalized_patch.status, json: false });
    }
    if (normalized_patch.retry_count !== undefined) {
      patch_entries.push({
        path: "$.retry_count",
        value: options.clamp_retry_count
          ? Math.max(0, normalized_patch.retry_count)
          : normalized_patch.retry_count,
        json: false,
      });
    }
    return patch_entries;
  }

  /**
   * 用 SQLite JSON patch 写入同一个字段增量，避免校对批量状态修改重写完整 DTO。
   */
  private write_item_fields_by_ids(
    project_path: string,
    item_ids: number[],
    patch: DatabaseRow,
  ): void {
    const normalized_ids = [
      ...new Set(
        item_ids
          .map((item_id) => Number(item_id))
          .filter((item_id) => Number.isInteger(item_id) && item_id > 0),
      ),
    ];
    if (normalized_ids.length === 0) {
      return;
    }
    const patch_entries = this.build_item_field_patch_entries(patch, { clamp_retry_count: false });
    if (patch_entries.length === 0) {
      return;
    }
    const json_set_args = patch_entries
      .map((patch_entry) => (patch_entry.json ? "?, json(?)" : "?, ?"))
      .join(", ");
    const patch_values = patch_entries.flatMap((patch_entry) => [
      patch_entry.path,
      patch_entry.json || typeof patch_entry.value !== "number"
        ? String(
            patch_entry.json
              ? JsonTool.stringifyStrict(patch_entry.value)
              : (patch_entry.value ?? ""),
          )
        : patch_entry.value,
    ]);
    const db = this.open_project(project_path);
    for_each_sqlite_in_clause_chunk(normalized_ids, (chunk) => {
      const placeholders = chunk.map(() => "?").join(",");
      db.prepare(
        `UPDATE items SET data = json_set(data, ${json_set_args}) WHERE id IN (${placeholders})`,
      ).run(...patch_values, ...chunk);
    });
  }

  /**
   * 按 item 逐条局部更新翻译字段，任务结果不能覆盖完整持久 item。
   */
  private write_item_translation_fields(project_path: string, patches: JsonValue[]): void {
    const db = this.open_project(project_path);
    for (const raw_patch of patches) {
      const entry = this.value_record(raw_patch);
      const item_id = Number(entry["id"]);
      if (!Number.isInteger(item_id) || item_id <= 0) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "invalid_translation_patch_item_id" },
        });
      }
      const patch = this.value_record(entry["patch"]);
      const patch_entries = this.build_item_field_patch_entries(patch, {
        clamp_retry_count: true,
      });
      if (patch_entries.length === 0) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "empty_translation_patch" },
        });
      }
      const json_set_args = patch_entries
        .map((patch_entry) => (patch_entry.json ? "?, json(?)" : "?, ?"))
        .join(", ");
      const patch_values = patch_entries.flatMap((patch_entry) => [
        patch_entry.path,
        patch_entry.json || typeof patch_entry.value !== "number"
          ? String(
              patch_entry.json
                ? JsonTool.stringifyStrict(patch_entry.value)
                : (patch_entry.value ?? ""),
            )
          : patch_entry.value,
      ]);
      const result = db
        .prepare(`UPDATE items SET data = json_set(data, ${json_set_args}) WHERE id = ?`)
        .run(...patch_values, item_id);
      if (Number(result.changes) !== 1) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "translation_patch_item_not_found", item_id },
        });
      }
    }
  }

  /**
   * 读取指定规则集合，保持质量规则运行时只看数据库事实
   */
  private read_rules(project_path: string, rule_type: string): JsonValue {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM rules WHERE type = ? ORDER BY id")
      .get(rule_type);
    if (row === undefined) {
      return [];
    }
    try {
      const data = json_parse(row["data"]);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * 写入指定规则集合，统一 revision 与 payload 维护
   */
  private write_rules(project_path: string, rule_type: string, rules: JsonValue[]): void {
    this.set_rules_with_db(this.open_project(project_path), rule_type, rules);
  }

  /**
   * 在既有事务连接内写入规则，避免规则和 meta 分离提交
   */
  private set_rules_with_db(db: DatabaseSync, rule_type: string, rules: JsonValue[]): void {
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JsonTool.stringifyStrict(rules),
    );
  }

  /**
   * 读取提示词或规则文本，统一文本规则落点
   */
  private read_rule_text(project_path: string, rule_type: string): string {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM rules WHERE type = ? LIMIT 1")
      .get(rule_type);
    if (row === undefined) {
      return "";
    }
    return this.deserialize_rule_text_payload(row_text(row, "data"));
  }

  /**
   * 保存文本规则内容，保持 prompt 与规则文本写入一致
   */
  private write_rule_text(project_path: string, rule_type: string, text: string): void {
    const db = this.open_project(project_path);
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JsonTool.stringifyStrict({ text }),
    );
  }

  /**
   * 解析当前文本规则对象载荷
   */
  private deserialize_rule_text_payload(raw_data: string): string {
    try {
      const text = read_json_record(JsonTool.parseStrict(raw_data))["text"];
      return typeof text === "string" ? text : String(text ?? "");
    } catch {
      return "";
    }
  }

  /**
   * 读取工程摘要，供打开预览和运行态快速判断使用
   */
  private read_project_summary(project_path: string): JsonValue {
    const meta = this.value_record(this.get_all_meta(project_path));
    const db = this.open_project(project_path);
    const file_count_row = db.prepare("SELECT COUNT(*) AS count FROM assets").get();
    const item_rows = db.prepare("SELECT data FROM items").all();
    let completed_count = 0;
    let failed_count = 0;
    let pending_count = 0;
    let skipped_count = 0;
    for (const row of item_rows) {
      let status = CURRENT_NONE;
      try {
        const item = this.value_record(json_parse(row["data"]));
        status = String(item["status"] ?? CURRENT_NONE);
      } catch {
        status = CURRENT_NONE;
      }
      if (status === "PROCESSED") {
        completed_count += 1;
      } else if (status === "ERROR") {
        failed_count += 1;
      } else if (status === "NONE") {
        pending_count += 1;
      } else {
        skipped_count += 1;
      }
    }
    const total_items = item_rows.length;
    return {
      name: String(meta["name"] ?? path.parse(project_path).name),
      source_language: String(meta["source_language"] ?? ""),
      target_language: String(meta["target_language"] ?? ""),
      created_at: String(meta["created_at"] ?? ""),
      updated_at: String(meta["updated_at"] ?? ""),
      file_count: file_count_row === undefined ? 0 : row_number(file_count_row, "count"),
      translation_stats: {
        total_items,
        completed_count,
        failed_count,
        pending_count,
        skipped_count,
        completion_percent:
          total_items > 0 ? ((completed_count + skipped_count) / total_items) * 100 : 0,
      },
    };
  }

  /**
   * 把 JSON 值收窄为对象，保留数据库 payload 的类型边界
   */
  private value_record(value: JsonValue | unknown): DatabaseRow {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as DatabaseRow;
  }
}
