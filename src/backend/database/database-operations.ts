import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import { database_error, database_cleanup_error } from "./database-error";
import { run_project_database_migrations } from "../migration/database-migrations";
import { ZstdTool } from "./zstd-tool";
import { AgentChatStorage } from "./agent-chat-storage";
import { ProjectDatabaseAccess } from "./project-database-access";
import { AgentDatabaseAccess } from "./agent-database-access";
export { ProjectDatabaseAccess } from "./project-database-access";
export type {
  ProjectDatabaseWrite,
  ProjectAssetRecord,
  ProjectItemTranslationWrite,
} from "./project-database-access";
const SQLITE_AUTO_VACUUM_FULL = 1; // SQLite 的 FULL 物理回收模式。
const SQLITE_BUSY_TIMEOUT_MS = 5000; // 首次 WAL 配置也受等待上限约束。
/** 关闭失败的连接仍由数据库层持有，以便再次回收。 */
interface ProjectDatabaseConnectionRecord {
  readonly normalized_path: string;
  readonly db: DatabaseSync;
  readonly access: NodeSqliteDatabase;
}
/** 工程队列独立于物理连接，等待中的工作不会提前打开 SQLite。 */
export class ProjectDatabase {
  private readonly connection_records = new Map<string, ProjectDatabaseConnectionRecord>(); // 保存在途及关闭失败的连接。
  private readonly queues = new Map<string, Promise<void>>(); // 完成屏障独立于连接寿命。
  private readonly storage_maintenance_deferred_paths = new Set<string>(); // 整理失败在当前实例内暂缓。
  /** 提前核对资产压缩能力，使工程入口及时报告运行环境缺失。 */
  public constructor(private readonly native_fs: NativeFs = default_native_fs) {
    if (!ZstdTool.isRuntimeAvailable()) throw new AppErrors.AppError("runtime.capability_missing");
  }
  /** 失败交给调用者，队列保留完成屏障，让后续批次仍可执行。 */
  private async schedule<T>(project_path: string, operation: () => Promise<T>): Promise<T> {
    const normalized = path.resolve(project_path);
    const previous = this.queues.get(normalized) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.queues.set(normalized, tail);
    try {
      return await result;
    } finally {
      if (this.queues.get(normalized) === tail) this.queues.delete(normalized);
    }
  }
  /** 等待已受理批次后，重试回收关闭失败留下的连接。 */
  public async close(): Promise<void> {
    await Promise.all(this.queues.values());
    const errors: unknown[] = [];
    for (const record of this.connection_records.values()) {
      try {
        this.close_connection_record(record);
      } catch (error) {
        errors.push(error);
      }
    }
    this.storage_maintenance_deferred_paths.clear();
    if (errors.length)
      throw new AggregateError(errors, "Failed to close project database connections.");
  }
  /** 排在工程在途操作之后关闭，避免卸载截断事务。 */
  public async close_project(project_path: string): Promise<void> {
    await this.schedule(project_path, async () => {
      const record = this.connection_records.get(path.resolve(project_path));
      if (record) this.close_connection_record(record);
    });
  }
  /** 迁移与物理整理属于工程准备阶段，避免每次短连接重复执行。 */
  public async prepare(project_path: string): Promise<void> {
    await this.use_connection(project_path, async (record) => {
      this.apply_project_storage_mode(record.normalized_path, record.db);
      try {
        run_project_database_migrations(record.db);
      } catch (error) {
        throw database_error(error, project_path, "migration");
      }
    });
  }
  /** 排他创建文件，失败时按提交状态决定是否删除本次新文件。 */
  public async create_project(
    project_path: string,
    name: string,
    initialize?: (writer: ProjectDatabaseAccess) => void,
  ): Promise<void> {
    await this.schedule(project_path, async () => {
      const normalized = path.resolve(project_path);
      try {
        this.native_fs.create_file_exclusive(normalized);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST")
          throw new AppErrors.AppError("project.already_exists", { cause: error });
        throw database_error(error, normalized, "create_file");
      }
      this.storage_maintenance_deferred_paths.delete(normalized);
      try {
        await this.execute_connection(
          normalized,
          async (record) => {
            this.apply_project_storage_mode(normalized, record.db);
            run_project_database_migrations(record.db);
            return this.execute_transaction(record, (writer) => {
              const now = new Date().toISOString();
              writer.upsert_meta_entries(normalized, { name, created_at: now, updated_at: now });
              initialize?.(writer);
            });
          },
          true,
        );
      } catch (error) {
        if (AppErrors.is_app_error(error) && error.code === "data.committed_sync_failed")
          throw error;
        try {
          const record = this.connection_records.get(normalized);
          if (record) this.close_connection_record(record);
          this.native_fs.unlink(normalized, { force: true });
        } catch (cleanup) {
          throw database_cleanup_error(
            error,
            database_error(cleanup, normalized, "remove_created_file"),
          );
        }
        throw error;
      }
    });
  }
  /** 批次结束撤销句柄，阻止异步延续跨批次访问。 */
  public read<T>(project_path: string, callback: (reader: ProjectDatabaseAccess) => T): Promise<T> {
    return this.use_connection(project_path, async (record) => {
      const reader = new ProjectDatabaseAccess(record.normalized_path, record.db);
      try {
        return await callback(reader);
      } finally {
        reader.active = false;
      }
    });
  }
  /** 工程写入与 SDK 共用调度，事务内显式传递写入句柄。 */
  public transaction<T>(
    project_path: string,
    callback: (writer: ProjectDatabaseAccess) => T,
  ): Promise<T> {
    return this.use_connection(
      project_path,
      (record) => this.execute_transaction(record, callback),
      true,
    );
  }
  /** 复用 SDK 的提交与回滚协议，领域 SQL 保持同步。 */
  private async execute_transaction<T>(
    record: ProjectDatabaseConnectionRecord,
    callback: (writer: ProjectDatabaseAccess) => T,
  ): Promise<T> {
    const writer = new ProjectDatabaseAccess(record.normalized_path, record.db);
    try {
      return await record.access.transaction(async () => callback(writer));
    } catch (error) {
      throw database_error(error, record.normalized_path, "transaction");
    } finally {
      writer.active = false;
    }
  }
  public get_all_meta(
    ...args: Parameters<ProjectDatabaseAccess["get_all_meta"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_all_meta"]>> {
    return this.read(args[0], (reader) => reader.get_all_meta(...args));
  }
  public read_pdf_document(
    ...args: Parameters<ProjectDatabaseAccess["read_pdf_document"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["read_pdf_document"]>> {
    return this.read(args[0], (reader) => reader.read_pdf_document(...args));
  }
  public read_pdf_documents(
    ...args: Parameters<ProjectDatabaseAccess["read_pdf_documents"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["read_pdf_documents"]>> {
    return this.read(args[0], (reader) => reader.read_pdf_documents(...args));
  }
  public read_file_counts(
    ...args: Parameters<ProjectDatabaseAccess["read_file_counts"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["read_file_counts"]>> {
    return this.read(args[0], (reader) => reader.read_file_counts(...args));
  }
  public read_pdf_summaries(
    ...args: Parameters<ProjectDatabaseAccess["read_pdf_summaries"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["read_pdf_summaries"]>> {
    return this.read(args[0], (reader) => reader.read_pdf_summaries(...args));
  }
  public get_all_asset_records(
    ...args: Parameters<ProjectDatabaseAccess["get_all_asset_records"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_all_asset_records"]>> {
    return this.read(args[0], (reader) => reader.get_all_asset_records(...args));
  }
  public get_asset_count(
    ...args: Parameters<ProjectDatabaseAccess["get_asset_count"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_asset_count"]>> {
    return this.read(args[0], (reader) => reader.get_asset_count(...args));
  }
  public get_all_items(
    ...args: Parameters<ProjectDatabaseAccess["get_all_items"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_all_items"]>> {
    return this.read(args[0], (reader) => reader.get_all_items(...args));
  }
  public get_item_count(
    ...args: Parameters<ProjectDatabaseAccess["get_item_count"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_item_count"]>> {
    return this.read(args[0], (reader) => reader.get_item_count(...args));
  }
  public get_items_by_ids(
    ...args: Parameters<ProjectDatabaseAccess["get_items_by_ids"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_items_by_ids"]>> {
    return this.read(args[0], (reader) => reader.get_items_by_ids(...args));
  }
  public get_rules(
    ...args: Parameters<ProjectDatabaseAccess["get_rules"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_rules"]>> {
    return this.read(args[0], (reader) => reader.get_rules(...args));
  }
  public get_rule_text(
    ...args: Parameters<ProjectDatabaseAccess["get_rule_text"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_rule_text"]>> {
    return this.read(args[0], (reader) => reader.get_rule_text(...args));
  }
  public get_project_summary(
    ...args: Parameters<ProjectDatabaseAccess["get_project_summary"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["get_project_summary"]>> {
    return this.read(args[0], (reader) => reader.get_project_summary(...args));
  }
  public read_asset_content(
    ...args: Parameters<ProjectDatabaseAccess["read_asset_content"]>
  ): Promise<ReturnType<ProjectDatabaseAccess["read_asset_content"]>> {
    return this.read(args[0], (reader) => reader.read_asset_content(...args));
  }
  /** 会话只持有访问入口，实际连接由工程队列按批次取得。 */
  public open_agent_store(project_path: string): AgentChatStorage {
    const access = new AgentDatabaseAccess((callback, write) =>
      this.use_connection(project_path, (record) => callback(record.access), write),
    );
    return new AgentChatStorage(access);
  }
  /** 调度到当前批次时才打开连接，等待本身不持有文件。 */
  private use_connection<T>(
    project_path: string,
    callback: (record: ProjectDatabaseConnectionRecord) => Promise<T>,
    write: boolean | (() => boolean) = false,
  ): Promise<T> {
    return this.schedule(project_path, () =>
      this.execute_connection(project_path, callback, write),
    );
  }
  /** 先完成操作，再关闭连接。已提交的收尾失败不能被当作可重试写入。 */
  private async execute_connection<T>(
    project_path: string,
    callback: (record: ProjectDatabaseConnectionRecord) => Promise<T>,
    write: boolean | (() => boolean) = false,
  ): Promise<T> {
    const record = this.open_project_record(path.resolve(project_path));
    let result: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      result = { ok: true, value: await callback(record) };
    } catch (error) {
      result = { ok: false, error };
    }
    try {
      this.close_connection_record(record);
    } catch (cleanup) {
      if (!result.ok) throw database_cleanup_error(result.error, cleanup);
      if (typeof write === "function" ? write() : write)
        throw this.committed_error(cleanup, project_path);
      throw cleanup;
    }
    if (!result.ok) throw result.error;
    return result.value;
  }
  /** 提交后关闭失败沿用已提交错误协议，调用者只能重载，不能重放写入。 */
  private committed_error(cause: unknown, project_path: string): AppErrors.AppError {
    if (AppErrors.is_app_error(cause) && cause.code === "data.committed_sync_failed") return cause;
    return new AppErrors.AppError("data.committed_sync_failed", {
      cause,
      public_details: { committed: true, action: "reload_project" },
      diagnostic_context: {
        operation: "close_after_commit",
        project: AppErrors.summarize_log_error_path(project_path),
      },
    });
  }

  /**
   * 取得可用连接，失败连接先关闭再重新初始化
   */
  private open_project_record(normalized_path: string): ProjectDatabaseConnectionRecord {
    const cached = this.connection_records.get(normalized_path);
    if (cached !== undefined) this.close_connection_record(cached);
    let record: ProjectDatabaseConnectionRecord | undefined;
    let operation = "open"; // 记录首个失败的连接初始化阶段。
    try {
      this.native_fs.make_dir(path.dirname(normalized_path));
      const db = new DatabaseSync(this.native_fs.to_native_path(normalized_path), {
        timeout: SQLITE_BUSY_TIMEOUT_MS,
      });
      record = {
        normalized_path,
        db,
        access: new NodeSqliteDatabase(db),
      };
      // 登记后再初始化，关闭失败仍由本实例持有并回收。
      this.connection_records.set(normalized_path, record);
      operation = "journal_mode";
      db.exec("PRAGMA journal_mode=WAL");
      operation = "synchronous";
      db.exec("PRAGMA synchronous=NORMAL");
      return record;
    } catch (error) {
      const failure = database_error(error, normalized_path, operation);
      if (record !== undefined) {
        try {
          this.close_connection_record(record);
        } catch (cleanup) {
          throw database_cleanup_error(failure, cleanup);
        }
      }
      throw failure;
    }
  }

  /**
   * 将 .lg 物理回收模式统一为 FULL。整理暂缓不影响数据库事实读取，由后续实例重新尝试。
   */
  private apply_project_storage_mode(normalized_path: string, db: DatabaseSync): void {
    if (this.storage_maintenance_deferred_paths.has(normalized_path)) {
      return;
    }
    try {
      const row = db.prepare("PRAGMA auto_vacuum").get();
      if (Number(row?.["auto_vacuum"]) === SQLITE_AUTO_VACUUM_FULL) {
        return;
      }
      db.exec("PRAGMA auto_vacuum=FULL");
      db.exec("VACUUM");
    } catch {
      // 物理回收不改变业务数据语义。当前实例暂缓后续整理，让正常迁移继续判断工程是否可用。
      this.storage_maintenance_deferred_paths.add(normalized_path);
    }
  }

  /** 最后一个连接的 checkpoint 与副文件清理由 SQLite 正常关闭完成。 */
  private close_connection_record(record: ProjectDatabaseConnectionRecord): void {
    if (!record.db.isOpen) return;
    try {
      record.db.close();
    } catch (error) {
      throw database_error(error, record.normalized_path, "close");
    } finally {
      if (!record.db.isOpen) {
        this.connection_records.delete(record.normalized_path);
      }
    }
  }
}
