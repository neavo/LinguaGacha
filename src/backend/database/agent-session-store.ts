import { SqliteStorage, type SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite";
import type { AgentFileAttachment } from "../../shared/agent";
import { normalize_agent_message_input } from "../../shared/agent";
import { AppError } from "../../shared/error";

export const ACTIVE_AGENT_SESSION_KEY = "active_session";

export type AgentSessionData = { uploads: AgentFileAttachment[] };
export type AgentSessionRecord = { id: string; data: AgentSessionData };

// ponytail: 首版每个工程只保留一个产品对话。多对话删除上线时改为按会话树回收 SDK 记录。
const SDK_TABLES = [
  "document_revisions",
  "documents",
  "submissions",
  "tasks",
  "entries",
  "conversations",
  "record_ids",
  "durable_metadata",
  "durable_schema",
] as const;

/** 同一工程连接上的产品登记与 SDK 存储。使用权由服务关闭，不由 Harness 关闭。 */
export class AgentSessionStore {
  /** 借用工程连接，保存其使用权释放入口。 */
  constructor(
    private readonly database: SqliteDatabase,
    private readonly release: () => void,
  ) {}

  /** 从激活指针恢复登记，并校验工程文件携带的上传路径。 */
  public async read(): Promise<AgentSessionRecord | null> {
    const active = await this.database.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      ACTIVE_AGENT_SESSION_KEY,
    );
    if (active === undefined) return null;
    const id: unknown = JSON.parse(active.value);
    if (typeof id !== "string" || id === "") throw new AppError("file.invalid_structure");
    const row = await this.database.get<{ data: string }>(
      "SELECT data FROM agent_sessions WHERE id = ?",
      id,
    );
    if (row === undefined) throw new AppError("file.invalid_structure");
    const data: unknown = JSON.parse(row.data);
    if (typeof data !== "object" || data === null || Array.isArray(data))
      throw new AppError("file.invalid_structure");
    const uploads = "uploads" in data ? data.uploads : [];
    if (!Array.isArray(uploads)) throw new AppError("file.invalid_structure");
    const message = normalize_agent_message_input({ text: "uploads", attachments: uploads });
    if (
      message === null ||
      message.attachments.some(
        (file) =>
          file.kind !== "file" ||
          !/^uploads\/[^/\\:]+$/u.test(file.path) ||
          file.path.includes("\0"),
      )
    )
      throw new AppError("file.invalid_structure");
    return { id, data: { uploads: message.attachments as AgentFileAttachment[] } };
  }

  /** 登记工作区已生成的身份，与激活指针一起提交，上传可先于第一条模型消息发生。 */
  public async create(id: string): Promise<AgentSessionRecord> {
    const data: AgentSessionData = { uploads: [] };
    await this.database.transaction(async (tx) => {
      await tx.run("INSERT INTO agent_sessions (id, data) VALUES (?, ?)", id, JSON.stringify(data));
      await tx.run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ACTIVE_AGENT_SESSION_KEY,
        JSON.stringify(id),
      );
    });
    return { id, data };
  }

  /** 上传登记在同一事务内读改写，并发上传不会覆盖彼此。 */
  public async save_upload(id: string, file: AgentFileAttachment): Promise<void> {
    await this.database.transaction(async (tx) => {
      const row = await tx.get<{ data: string }>(
        "SELECT data FROM agent_sessions WHERE id = ?",
        id,
      );
      if (row === undefined) throw new AppError("runtime.cancelled");
      const data = JSON.parse(row.data) as AgentSessionData;
      data.uploads = [...(data.uploads ?? []), file];
      await tx.run("UPDATE agent_sessions SET data = ? WHERE id = ?", JSON.stringify(data), id);
    });
  }

  /** SDK 借用同一事务队列，由产品 Store 统一释放连接。 */
  public open_storage(): Promise<SqliteStorage> {
    // SDK 负责自己的任务收尾。数据库连接仍被本 Store 持有，供重置和上传登记使用。
    return SqliteStorage.open({
      exec: (sql) => this.database.exec(sql),
      run: (sql, ...params) => this.database.run(sql, ...params),
      get: (sql, ...params) => this.database.get(sql, ...params),
      all: (sql, ...params) => this.database.all(sql, ...params),
      transaction: (callback) => this.database.transaction(callback),
      close: async () => {},
    });
  }

  /** 只能在 Harness 关闭后执行。原稿和其它工程事实不参与会话重置。 */
  public async reset(): Promise<void> {
    await this.database.transaction(async (tx) => {
      for (const table of SDK_TABLES) await tx.exec("DROP TABLE IF EXISTS " + table);
      await tx.run("DELETE FROM agent_sessions");
      await tx.run("DELETE FROM meta WHERE key = ?", ACTIVE_AGENT_SESSION_KEY);
    });
  }

  /** 等待排队访问结束后释放工程使用权。 */
  public async close(): Promise<void> {
    try {
      await this.database.get("SELECT 1");
    } finally {
      this.release();
    }
  }
}
