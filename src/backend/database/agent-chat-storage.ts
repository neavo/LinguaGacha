import { AgentDatabaseAccess } from "./agent-database-access";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { AgentFileAttachment } from "../../shared/agent";
import { normalize_agent_message_input } from "../../shared/agent";
import { AppError } from "../../shared/error";

export const ACTIVE_AGENT_CHAT_KEY = "active_chat";

export type AgentChatRecord = {
  id: string;
  data: {
    documentKey: string;
    rootConversationId: number | null;
    title: string;
    uploads: AgentFileAttachment[];
  };
};

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

  public async list(): Promise<{ chats: AgentChatRecord[]; activeChatId: string | null }> {
    return this.read_batch(async () => {
      const rows = await this.database.all<{ id: string; data: string }>(
        "SELECT id, data FROM agent_chats ORDER BY rowid",
      );
      const active = await this.database.get<{ value: string }>(
        "SELECT value FROM meta WHERE key = ?",
        ACTIVE_AGENT_CHAT_KEY,
      );
      const activeChatId: unknown = active === undefined ? null : JSON.parse(active.value);
      if (
        active !== undefined &&
        (typeof activeChatId !== "string" || !rows.some((row) => row.id === activeChatId))
      )
        throw new AppError("file.invalid_structure");
      return {
        chats: rows.map((row) => this.read_record(row)),
        activeChatId: typeof activeChatId === "string" ? activeChatId : null,
      };
    });
  }

  private read_record(row: { id: string; data: string }): AgentChatRecord {
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
    const values = data as Partial<AgentChatRecord["data"]>;
    return {
      id: row.id,
      data: {
        documentKey: values.documentKey ?? row.id,
        rootConversationId: values.rootConversationId ?? null,
        title: values.title ?? "",
        uploads: message.attachments as AgentFileAttachment[],
      },
    };
  }

  public new_record(id: string): AgentChatRecord {
    return {
      id,
      data: {
        documentKey: id,
        rootConversationId: null,
        title: "",
        uploads: [],
      },
    };
  }

  /** 登记、替换或移除记录与活跃指针在同一事务提交。 */
  public async update_records(change: {
    put?: AgentChatRecord;
    remove?: string;
    active?: string;
  }): Promise<void> {
    await this.database.transaction(async (tx) => {
      if (change.put)
        await tx.run(
          "INSERT INTO agent_chats (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
          change.put.id,
          JSON.stringify(change.put.data),
        );
      if (change.remove) await tx.run("DELETE FROM agent_chats WHERE id = ?", change.remove);
      if (change.active)
        await tx.run(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          ACTIVE_AGENT_CHAT_KEY,
          JSON.stringify(change.active),
        );
    });
  }

  /** 标题更新保留并发上传已经登记的事实。 */
  public async update_title(id: string, title: string): Promise<void> {
    await this.database.run(
      "UPDATE agent_chats SET data = json_set(data, '$.title', ?) WHERE id = ?",
      title,
      id,
    );
  }

  /** 仅在 SDK 缓存关闭以后使用，保留全库的身份计数器；无孤立记录时不开启写事务。 */
  public async collect_deleted_chats(records: readonly AgentChatRecord[]): Promise<void> {
    const roots = JSON.stringify(
      records.map((record) => record.data.rootConversationId).filter((id) => id !== null),
    );
    const keys = JSON.stringify(records.map((record) => record.data.documentKey));
    const live = `WITH RECURSIVE live(id) AS (
      SELECT value FROM json_each(?)
      UNION SELECT c.id FROM conversations c JOIN live p
      ON json_extract(c.record, '$.parent.conversationId') = p.id OR c.owner_conversation_id = p.id
    )`;
    const has_orphan = await this.read_batch(async () => {
      const conversation = await this.database.get<{ found: number }>(
        `${live} SELECT 1 AS found FROM conversations WHERE id NOT IN (SELECT id FROM live) LIMIT 1`,
        roots,
      );
      if (conversation !== undefined) return true;
      const doc = await this.database.get<{ found: number }>(
        "SELECT 1 AS found FROM documents WHERE json_extract(kind, '$') = 'linguagacha.chat' AND json_extract(key_value, '$') NOT IN (SELECT value FROM json_each(?)) LIMIT 1",
        keys,
      );
      return doc !== undefined;
    });
    if (!has_orphan) return;
    await this.database.transaction(async (tx) => {
      await tx.run(
        `${live} DELETE FROM documents WHERE
        (scope_kind = 'conversation' AND owner_id NOT IN (SELECT id FROM live)) OR
        (scope_kind = 'task' AND owner_id IN (SELECT id FROM tasks WHERE conversation_id NOT IN (SELECT id FROM live))) OR
        (json_extract(kind, '$') = 'linguagacha.chat' AND json_extract(key_value, '$') NOT IN (SELECT value FROM json_each(?)))`,
        roots,
        keys,
      );
      await tx.exec(
        "DELETE FROM document_revisions WHERE document_id NOT IN (SELECT id FROM documents)",
      );
      for (const table of ["entries", "submissions", "tasks"])
        await tx.run(
          `${live} DELETE FROM ${table} WHERE conversation_id NOT IN (SELECT id FROM live)`,
          roots,
        );
      await tx.run(
        `${live} DELETE FROM conversations WHERE id NOT IN (SELECT id FROM live)`,
        roots,
      );
      await tx.exec(`DELETE FROM record_ids WHERE id NOT IN (
        SELECT id FROM conversations UNION ALL SELECT id FROM entries UNION ALL SELECT id FROM tasks
        UNION ALL SELECT id FROM submissions UNION ALL SELECT id FROM documents
      )`);
    });
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
        runCounted: (sql, ...params) => this.database.runCounted(sql, ...params),
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
