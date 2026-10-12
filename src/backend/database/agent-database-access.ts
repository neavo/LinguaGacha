import { AsyncLocalStorage } from "node:async_hooks";
import type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite";
import { AppError } from "../../shared/error";

/** 批次结束时读取提交标记，覆盖 SDK 初始化中的自动提交写入。 */
type DatabaseOperation = <T>(
  callback: (database: SqliteDatabase) => Promise<T>,
  write?: boolean | (() => boolean),
) => Promise<T>;
/** SDK 连续读取使用异步上下文复用本批连接，无关访问仍进入工程队列。 */
export class AgentDatabaseAccess implements SqliteDatabase {
  private readonly scope = new AsyncLocalStorage<{
    database: SqliteDatabase;
    active: boolean;
    written: boolean;
  }>(); // 上下文只沿本批异步调用传播。
  private readonly pending = new Set<Promise<unknown>>(); // 关闭仅等待已受理操作，错误由原调用者消费。
  private closed = false; // 拒绝新入口，已受理批次仍可完成。
  /** 数据库层注入统一调度，适配器负责 SDK 批次和访问有效期。 */
  public constructor(private readonly operation: DatabaseOperation) {}
  /** 批次内复用句柄，无关调用回到工程队列。 */
  private run_operation<T>(
    callback: (database: SqliteDatabase) => Promise<T>,
    write: boolean | (() => boolean) = false,
  ): Promise<T> {
    const current = this.scope.getStore();
    if (current) {
      if (!current.active) return Promise.reject(new AppError("runtime.cancelled"));
      return callback(current.database).then((result) => {
        if (typeof write === "function" ? write() : write) current.written = true;
        return result;
      });
    }
    if (this.closed) return Promise.reject(new AppError("runtime.cancelled"));
    const result = this.operation(callback, write);
    this.pending.add(result);
    void result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
    return result;
  }
  /** 关闭异步上下文时撤销访问，防止派生任务在批次后继续写入。 */
  public read_batch<T>(callback: () => Promise<T>): Promise<T> {
    let written = false;
    return this.run_operation(
      async (database) => {
        const scope = { database, active: true, written: false };
        try {
          return await this.scope.run(scope, callback);
        } finally {
          scope.active = false;
          written = scope.written;
        }
      },
      () => written,
    );
  }
  public exec(sql: string): Promise<void> {
    return this.run_operation((db) => db.exec(sql), true);
  }
  public run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.run_operation((db) => db.run(sql, ...params), true);
  }
  public get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.run_operation((db) => db.get<T>(sql, ...params));
  }
  public all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.run_operation((db) => db.all<T>(sql, ...params));
  }
  /** 回调使用 SDK 专属事务句柄，避免再次排队造成自锁。 */
  public transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.run_operation((db) => db.transaction(callback), true);
  }
  /** 先关闭入口，再等待已受理操作收尾。 */
  public async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.pending);
  }
}
