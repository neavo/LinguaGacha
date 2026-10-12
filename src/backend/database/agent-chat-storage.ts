import { AgentDatabaseAccess } from "./agent-database-access";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { AgentFileAttachment } from "../../shared/agent";
import { normalize_agent_message_input } from "../../shared/agent";
import { AppError } from "../../shared/error";

export const ACTIVE_AGENT_CHAT_KEY = "active_chat";

export type AgentChatRecord = { id: string; data: { uploads: AgentFileAttachment[] } };

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

/** 工程上的产品登记与 SDK 存储。访问入口由服务关闭，不由 Harness 关闭。 */
export class AgentChatStorage {
  constructor(private readonly database: AgentDatabaseAccess) {}

  /** 批次只包含直接存储访问，防止持有连接等待 SDK 会话队列。 */
  public read_batch<T>(callback: () => Promise<T>): Promise<T> {
    return this.database.read_batch(callback);
  }

  /** 从激活指针恢复登记，并校验工程文件携带的上传路径。 */
  public read(): Promise<AgentChatRecord | null> {
    return this.read_batch(() => this.read_record());
  }

  private async read_record(): Promise<AgentChatRecord | null> {
    const active = await this.database.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = ?",
      ACTIVE_AGENT_CHAT_KEY,
    );
    if (active === undefined) return null;
    const id: unknown = JSON.parse(active.value);
    if (typeof id !== "string" || id === "") throw new AppError("file.invalid_structure");
    const row = await this.database.get<{ data: string }>(
      "SELECT data FROM agent_chats WHERE id = ?",
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
  public async create(id: string): Promise<AgentChatRecord> {
    const data: AgentChatRecord["data"] = { uploads: [] };
    await this.database.transaction(async (tx) => {
      await tx.run("INSERT INTO agent_chats (id, data) VALUES (?, ?)", id, JSON.stringify(data));
      await tx.run(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ACTIVE_AGENT_CHAT_KEY,
        JSON.stringify(id),
      );
    });
    return { id, data };
  }

  /** 上传登记在同一事务内读改写，并发上传不会覆盖彼此。 */
  public async save_upload(id: string, file: AgentFileAttachment): Promise<void> {
    await this.database.transaction(async (tx) => {
      const row = await tx.get<{ data: string }>("SELECT data FROM agent_chats WHERE id = ?", id);
      if (row === undefined) throw new AppError("runtime.cancelled");
      const data = JSON.parse(row.data) as AgentChatRecord["data"];
      data.uploads = [...(data.uploads ?? []), file];
      await tx.run("UPDATE agent_chats SET data = ? WHERE id = ?", JSON.stringify(data), id);
    });
  }

  /** SDK 借用同一工程队列，由产品 Store 统一收尾。 */
  public async open_storage(): Promise<SqliteStorage> {
    // SDK 关闭后仍允许产品层重置和上传收尾。
    const storage = await this.read_batch(() =>
      SqliteStorage.open({
        exec: (sql) => this.database.exec(sql),
        run: (sql, ...params) => this.database.run(sql, ...params),
        get: (sql, ...params) => this.database.get(sql, ...params),
        all: (sql, ...params) => this.database.all(sql, ...params),
        transaction: (callback) => this.database.transaction(callback),
        close: async () => {},
      }),
    );
    // 先进入 SDK 的串行队列，再批量读取数据库，避免两条队列反向等待。
    const batch =
      <Args extends unknown[], Result>(read: (...args: Args) => Promise<Result>) =>
      (...args: Args): Promise<Result> =>
        this.read_batch(() => read(...args));
    storage.scanEntries = batch(storage.scanEntries.bind(storage));
    storage.findLatestHeadMarker = batch(storage.findLatestHeadMarker.bind(storage));
    storage.findDocument = batch(storage.findDocument.bind(storage));
    storage.document = batch(storage.document.bind(storage));
    return storage;
  }

  /** 只能在 Harness 关闭后执行。原稿和其它工程事实不参与会话重置。 */
  public async reset(): Promise<void> {
    await this.database.transaction(async (tx) => {
      for (const table of SDK_TABLES) await tx.exec("DROP TABLE IF EXISTS " + table);
      await tx.run("DELETE FROM agent_chats");
      await tx.run("DELETE FROM meta WHERE key = ?", ACTIVE_AGENT_CHAT_KEY);
    });
  }

  /** 拒绝新访问并等待已经接受的操作完成。 */
  public close(): Promise<void> {
    return this.database.close();
  }
}
