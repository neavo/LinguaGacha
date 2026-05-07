import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabaseMigrationService,
} from "../migration/project-database-migration-service";
import { ZstdTool } from "../utils/zstd-tool";
import type { DatabaseJsonValue, DatabaseOperation } from "./database-types";

type DatabaseRow = Record<string, unknown>;

const CURRENT_NONE = "NONE";

function json_parse(raw_value: unknown): DatabaseJsonValue {
  if (typeof raw_value !== "string") {
    return null;
  }
  return JSON.parse(raw_value) as DatabaseJsonValue;
}

function json_stringify(value: DatabaseJsonValue): string {
  return JSON.stringify(value);
}

function row_text(row: DatabaseRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

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

function bytes_from_blob(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.alloc(0);
}

function ensure_database_runtime_available(): void {
  if (typeof DatabaseSync !== "function") {
    throw new Error("当前 Electron / Node runtime 缺少 node:sqlite DatabaseSync。");
  }
  if (!ZstdTool.isRuntimeAvailable()) {
    throw new Error("当前 Electron / Node runtime 缺少 node:zlib Zstd API。");
  }
}

// 用独立错误类型把可恢复的 database 冲突映射成稳定 HTTP 错误码。
export class DatabaseConflictError extends Error {}

// Electron main 内部 .lg 物理读写入口，集中持有 SQLite、事务和 asset 压缩格式。
export class ProjectDatabase {
  private readonly open_databases = new Map<string, DatabaseSync>();

  public constructor() {
    ensure_database_runtime_available();
  }

  public close(): void {
    for (const db of this.open_databases.values()) {
      db.close();
    }
    this.open_databases.clear();
  }

  public execute(operation: DatabaseOperation): DatabaseJsonValue {
    // DatabaseGateway 只发送窄操作名，TS 侧集中校验参数并保护 SQL 边界。
    const args = this.normalize_args(operation.args);
    switch (operation.name) {
      case "closeProject":
        this.close_project(this.require_string(args, "projectPath"));
        return null;
      case "createProject":
        return this.create_project(
          this.require_string(args, "projectPath"),
          this.require_string(args, "name"),
        );
      case "getMeta":
        return this.get_meta(
          this.require_string(args, "projectPath"),
          this.require_string(args, "key"),
          args["default"] ?? null,
        );
      case "setMeta":
        this.set_meta(
          this.require_string(args, "projectPath"),
          this.require_string(args, "key"),
          args["value"] ?? null,
        );
        return null;
      case "upsertMetaEntries":
        this.upsert_meta_entries(
          this.require_string(args, "projectPath"),
          this.require_record(args, "meta"),
        );
        return null;
      case "getAllMeta":
        return this.get_all_meta(this.require_string(args, "projectPath"));
      case "getAnalysisItemCheckpoints":
        return this.get_analysis_item_checkpoints(this.require_string(args, "projectPath"));
      case "upsertAnalysisItemCheckpoints":
        this.upsert_analysis_item_checkpoints(
          this.require_string(args, "projectPath"),
          this.require_array(args, "checkpoints"),
        );
        return null;
      case "deleteAnalysisItemCheckpoints":
        return this.delete_analysis_item_checkpoints(
          this.require_string(args, "projectPath"),
          this.optional_string(args, "status"),
        );
      case "getAnalysisCandidateAggregates":
        return this.get_analysis_candidate_aggregates(this.require_string(args, "projectPath"));
      case "getAnalysisCandidateAggregatesBySrcs":
        return this.get_analysis_candidate_aggregates_by_srcs(
          this.require_string(args, "projectPath"),
          this.require_string_array(args, "srcs"),
        );
      case "upsertAnalysisCandidateAggregates":
        this.upsert_analysis_candidate_aggregates(
          this.require_string(args, "projectPath"),
          this.require_array(args, "aggregates"),
        );
        return null;
      case "clearAnalysisCandidateAggregates":
        this.clear_analysis_candidate_aggregates(this.require_string(args, "projectPath"));
        return null;
      case "addAssetFromSource":
        this.add_asset_from_source(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
          this.require_string(args, "sourcePath"),
          this.optional_number(args, "sortOrder"),
        );
        return null;
      case "addAssetCompressedBase64":
        this.add_asset_compressed_base64(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
          this.require_string(args, "compressedBase64"),
          this.require_number(args, "originalSize"),
          this.optional_number(args, "sortOrder"),
        );
        return null;
      case "updateAssetFromSource":
        this.update_asset_from_source(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
          this.require_string(args, "sourcePath"),
        );
        return null;
      case "updateAssetPath":
        this.update_asset_path(
          this.require_string(args, "projectPath"),
          this.require_string(args, "oldPath"),
          this.require_string(args, "newPath"),
        );
        return null;
      case "getAssetCompressedBase64":
        return this.get_asset_compressed_base64(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
        );
      case "deleteAsset":
        this.delete_asset(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
        );
        return null;
      case "assetPathExists":
        return this.asset_path_exists(
          this.require_string(args, "projectPath"),
          this.require_string(args, "path"),
        );
      case "getAllAssetPaths":
        return this.get_all_asset_paths(this.require_string(args, "projectPath"));
      case "getAllAssetRecords":
        return this.get_all_asset_records(this.require_string(args, "projectPath"));
      case "updateAssetSortOrders":
        this.update_asset_sort_orders(
          this.require_string(args, "projectPath"),
          this.require_string_array(args, "orderedPaths"),
        );
        return null;
      case "getAllItems":
        return this.get_all_items(this.require_string(args, "projectPath"));
      case "getItemsByIds":
        return this.get_items_by_ids(
          this.require_string(args, "projectPath"),
          this.require_number_array(args, "itemIds"),
        );
      case "deleteItemsByFilePath":
        return this.delete_items_by_file_path(
          this.require_string(args, "projectPath"),
          this.require_string(args, "filePath"),
        );
      case "setItem":
        return this.set_item(
          this.require_string(args, "projectPath"),
          this.require_record(args, "item"),
        );
      case "setItems":
        return this.set_items(
          this.require_string(args, "projectPath"),
          this.require_array(args, "items"),
        ) as DatabaseJsonValue;
      case "previewReplaceAllItemIds":
        return this.preview_replace_all_item_ids(
          this.require_string(args, "projectPath"),
          this.require_array(args, "items"),
        ) as DatabaseJsonValue;
      case "updateBatch":
        this.update_batch(
          this.require_string(args, "projectPath"),
          this.optional_array(args, "items"),
          this.optional_record(args, "rules"),
          this.optional_record(args, "meta"),
        );
        return null;
      case "getRules":
        return this.get_rules(
          this.require_string(args, "projectPath"),
          this.require_string(args, "ruleType"),
        );
      case "setRules":
        this.set_rules(
          this.require_string(args, "projectPath"),
          this.require_string(args, "ruleType"),
          this.require_array(args, "rules"),
        );
        return null;
      case "getRuleText":
        return this.get_rule_text(
          this.require_string(args, "projectPath"),
          this.require_string(args, "ruleType"),
        );
      case "getRuleTextByName":
        return this.get_rule_text_by_name(
          this.require_string(args, "projectPath"),
          this.require_string(args, "ruleTypeName"),
        );
      case "setRuleText":
        this.set_rule_text(
          this.require_string(args, "projectPath"),
          this.require_string(args, "ruleType"),
          this.require_string(args, "text"),
        );
        return null;
      case "getProjectSummary":
        return this.get_project_summary(this.require_string(args, "projectPath"));
      default:
        throw new Error(`未知 database 操作：${operation.name}`);
    }
  }

  public execute_transaction(operations: DatabaseOperation[]): null {
    if (operations.length === 0) {
      return null;
    }
    // 单个事务只允许绑定一个工程文件，避免跨 .lg 写入出现半提交语义。
    const first_args = this.normalize_args(operations[0]?.args);
    const project_path = this.require_string(first_args, "projectPath");
    const db = this.open_project(project_path);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const operation of operations) {
        this.execute(operation);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return null;
  }

  public read_asset_content(project_path: string, asset_path: string): Buffer | null {
    // Python Core 只消费解压后的原始 bytes，Zstd 格式细节留在 main 进程。
    const db = this.open_project(project_path);
    const row = db.prepare("SELECT data FROM assets WHERE path = ?").get(asset_path);
    if (row === undefined) {
      return null;
    }
    return ZstdTool.decompress(bytes_from_blob(row["data"]));
  }

  private normalize_args(
    args: Record<string, DatabaseJsonValue> | undefined,
  ): Record<string, DatabaseJsonValue> {
    return args ?? {};
  }

  private open_project(project_path: string): DatabaseSync {
    const normalized_path = path.resolve(project_path);
    const cached = this.open_databases.get(normalized_path);
    if (cached !== undefined) {
      return cached;
    }
    fs.mkdirSync(path.dirname(normalized_path), { recursive: true });
    const db = new DatabaseSync(normalized_path);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec("PRAGMA busy_timeout=5000");
    // 每次首次打开都先跑幂等迁移，兼容旧 .lg，同时让业务读到当前 schema。
    ProjectDatabaseMigrationService.migrate(db);
    this.open_databases.set(normalized_path, db);
    return db;
  }

  private close_project(project_path: string): void {
    const normalized_path = path.resolve(project_path);
    const db = this.open_databases.get(normalized_path);
    if (db === undefined) {
      return;
    }
    db.close();
    this.open_databases.delete(normalized_path);
  }

  private create_project(project_path: string, name: string): null {
    const normalized_path = path.resolve(project_path);
    this.close_project(normalized_path);
    if (fs.existsSync(normalized_path)) {
      fs.unlinkSync(normalized_path);
    }
    const db = this.open_project(normalized_path);
    const now = new Date().toISOString();
    this.upsert_meta_entries_with_db(db, {
      schema_version: PROJECT_DATABASE_SCHEMA_VERSION,
      name,
      created_at: now,
      updated_at: now,
    });
    return null;
  }

  private get_meta(
    project_path: string,
    key: string,
    default_value: DatabaseJsonValue,
  ): DatabaseJsonValue {
    const db = this.open_project(project_path);
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row === undefined ? default_value : json_parse(row["value"]);
  }

  private set_meta(project_path: string, key: string, value: DatabaseJsonValue): void {
    this.upsert_meta_entries(project_path, { [key]: value });
  }

  private upsert_meta_entries(project_path: string, meta: DatabaseRow): void {
    this.upsert_meta_entries_with_db(this.open_project(project_path), meta);
  }

  private upsert_meta_entries_with_db(db: DatabaseSync, meta: DatabaseRow): void {
    const statement = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(meta)) {
      statement.run(key, JSON.stringify(value));
    }
  }

  private get_all_meta(project_path: string): DatabaseJsonValue {
    const db = this.open_project(project_path);
    const result: Record<string, DatabaseJsonValue> = {};
    for (const row of db.prepare("SELECT key, value FROM meta").all()) {
      result[row_text(row, "key")] = json_parse(row["value"]);
    }
    return result;
  }

  private get_analysis_item_checkpoints(project_path: string): DatabaseJsonValue {
    const db = this.open_project(project_path);
    return db
      .prepare(
        `SELECT item_id, status, updated_at, error_count
         FROM analysis_item_checkpoint
         ORDER BY item_id`,
      )
      .all()
      .map((row) => ({
        item_id: row_number(row, "item_id"),
        status: row_text(row, "status"),
        updated_at: row_text(row, "updated_at"),
        error_count: row_number(row, "error_count"),
      }));
  }

  private upsert_analysis_item_checkpoints(
    project_path: string,
    checkpoints: DatabaseJsonValue[],
  ): void {
    const db = this.open_project(project_path);
    const statement = db.prepare(
      `INSERT INTO analysis_item_checkpoint (item_id, status, updated_at, error_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at,
         error_count = excluded.error_count`,
    );
    for (const checkpoint of checkpoints) {
      const row = this.value_record(checkpoint);
      statement.run(
        Number(row["item_id"] ?? 0),
        String(row["status"] ?? ""),
        String(row["updated_at"] ?? ""),
        Number(row["error_count"] ?? 0),
      );
    }
  }

  private delete_analysis_item_checkpoints(project_path: string, status: string | null): number {
    const db = this.open_project(project_path);
    if (status === null) {
      return Number(db.prepare("DELETE FROM analysis_item_checkpoint").run().changes);
    }
    return Number(
      db.prepare("DELETE FROM analysis_item_checkpoint WHERE status = ?").run(status).changes,
    );
  }

  private normalize_candidate_rows(rows: DatabaseRow[]): DatabaseJsonValue {
    return rows.map((row) => ({
      src: row_text(row, "src"),
      dst_votes: json_parse(row["dst_votes"]),
      info_votes: json_parse(row["info_votes"]),
      observation_count: row_number(row, "observation_count"),
      first_seen_at: row_text(row, "first_seen_at"),
      last_seen_at: row_text(row, "last_seen_at"),
      case_sensitive: Boolean(row_number(row, "case_sensitive")),
    }));
  }

  private get_analysis_candidate_aggregates(project_path: string): DatabaseJsonValue {
    const db = this.open_project(project_path);
    return this.normalize_candidate_rows(
      db
        .prepare(
          `SELECT src, dst_votes, info_votes, observation_count, first_seen_at, last_seen_at, case_sensitive
           FROM analysis_candidate_aggregate
           ORDER BY src`,
        )
        .all(),
    );
  }

  private get_analysis_candidate_aggregates_by_srcs(
    project_path: string,
    srcs: string[],
  ): DatabaseJsonValue {
    const normalized_srcs = srcs.map((src) => src.trim()).filter((src) => src !== "");
    if (normalized_srcs.length === 0) {
      return [];
    }
    const placeholders = normalized_srcs.map(() => "?").join(",");
    const db = this.open_project(project_path);
    return this.normalize_candidate_rows(
      db
        .prepare(
          `SELECT src, dst_votes, info_votes, observation_count, first_seen_at, last_seen_at, case_sensitive
           FROM analysis_candidate_aggregate
           WHERE src IN (${placeholders})
           ORDER BY src`,
        )
        .all(...normalized_srcs),
    );
  }

  private upsert_analysis_candidate_aggregates(
    project_path: string,
    aggregates: DatabaseJsonValue[],
  ): void {
    const db = this.open_project(project_path);
    const statement = db.prepare(
      `INSERT INTO analysis_candidate_aggregate (
         src, dst_votes, info_votes, observation_count, first_seen_at, last_seen_at, case_sensitive
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(src) DO UPDATE SET
         dst_votes = excluded.dst_votes,
         info_votes = excluded.info_votes,
         observation_count = excluded.observation_count,
         last_seen_at = excluded.last_seen_at,
         case_sensitive = excluded.case_sensitive`,
    );
    for (const aggregate of aggregates) {
      const row = this.value_record(aggregate);
      statement.run(
        String(row["src"] ?? ""),
        json_stringify((row["dst_votes"] ?? {}) as DatabaseJsonValue),
        json_stringify((row["info_votes"] ?? {}) as DatabaseJsonValue),
        Number(row["observation_count"] ?? 0),
        String(row["first_seen_at"] ?? ""),
        String(row["last_seen_at"] ?? ""),
        row["case_sensitive"] === true ? 1 : 0,
      );
    }
  }

  private clear_analysis_candidate_aggregates(project_path: string): void {
    this.open_project(project_path).prepare("DELETE FROM analysis_candidate_aggregate").run();
  }

  private get_next_asset_sort_order(db: DatabaseSync): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM assets")
      .get();
    return row === undefined ? 0 : row_number(row, "next_sort_order");
  }

  private add_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
    sort_order: number | null,
  ): void {
    const original_data = fs.readFileSync(source_path);
    const compressed = ZstdTool.compress(original_data);
    this.add_asset_buffer(
      project_path,
      asset_path,
      compressed,
      original_data.byteLength,
      sort_order,
    );
  }

  private add_asset_compressed_base64(
    project_path: string,
    asset_path: string,
    compressed_base64: string,
    original_size: number,
    sort_order: number | null,
  ): void {
    this.add_asset_buffer(
      project_path,
      asset_path,
      Buffer.from(compressed_base64, "base64"),
      original_size,
      sort_order,
    );
  }

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

  private update_asset_from_source(
    project_path: string,
    asset_path: string,
    source_path: string,
  ): void {
    const original_data = fs.readFileSync(source_path);
    const compressed = ZstdTool.compress(original_data);
    const result = this.open_project(project_path)
      .prepare(
        `UPDATE assets
         SET data = ?, original_size = ?, compressed_size = ?
         WHERE path = ?`,
      )
      .run(compressed, original_data.byteLength, compressed.byteLength, asset_path);
    if (Number(result.changes) === 0) {
      throw new DatabaseConflictError("资产不存在，无法更新。");
    }
  }

  private update_asset_path(project_path: string, old_path: string, new_path: string): void {
    const result = this.open_project(project_path)
      .prepare("UPDATE assets SET path = ? WHERE path = ?")
      .run(new_path, old_path);
    if (Number(result.changes) === 0) {
      throw new DatabaseConflictError("资产不存在，无法重命名。");
    }
  }

  private get_asset_compressed_base64(project_path: string, asset_path: string): DatabaseJsonValue {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM assets WHERE path = ?")
      .get(asset_path);
    return row === undefined ? null : bytes_from_blob(row["data"]).toString("base64");
  }

  private delete_asset(project_path: string, asset_path: string): void {
    this.open_project(project_path).prepare("DELETE FROM assets WHERE path = ?").run(asset_path);
  }

  private asset_path_exists(project_path: string, asset_path: string): boolean {
    const row = this.open_project(project_path)
      .prepare("SELECT 1 FROM assets WHERE path = ? LIMIT 1")
      .get(asset_path);
    return row !== undefined;
  }

  private get_all_asset_paths(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT path FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => row_text(row, "path"));
  }

  private get_all_asset_records(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT path, sort_order FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => ({ path: row_text(row, "path"), sort_order: row_number(row, "sort_order") }));
  }

  private update_asset_sort_orders(project_path: string, ordered_paths: string[]): void {
    const statement = this.open_project(project_path).prepare(
      "UPDATE assets SET sort_order = ? WHERE path = ?",
    );
    for (const [sort_order, asset_path] of ordered_paths.entries()) {
      statement.run(sort_order, asset_path);
    }
  }

  private get_all_items(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT id, data FROM items ORDER BY id")
      .all()
      .map((row) => ({ ...this.value_record(json_parse(row["data"])), id: row_number(row, "id") }));
  }

  private get_items_by_ids(project_path: string, item_ids: number[]): DatabaseJsonValue {
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
    for (let index = 0; index < normalized_ids.length; index += 500) {
      const chunk = normalized_ids.slice(index, index + 500);
      const placeholders = chunk.map(() => "?").join(",");
      for (const row of db
        .prepare(`SELECT id, data FROM items WHERE id IN (${placeholders})`)
        .all(...chunk)) {
        const item_id = row_number(row, "id");
        rows_by_id.set(item_id, { ...this.value_record(json_parse(row["data"])), id: item_id });
      }
    }
    return normalized_ids
      .map((item_id) => rows_by_id.get(item_id))
      .filter((item): item is DatabaseRow => item !== undefined) as DatabaseJsonValue;
  }

  private delete_items_by_file_path(project_path: string, file_path: string): number {
    const db = this.open_project(project_path);
    try {
      return Number(
        db.prepare("DELETE FROM items WHERE json_extract(data, '$.file_path') = ?").run(file_path)
          .changes,
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("json_extract")) {
        throw error;
      }
      // 某些运行时可能没有 JSON1，退回逐行解析以保持删除语义可用。
      const ids: number[] = [];
      for (const row of db.prepare("SELECT id, data FROM items").all()) {
        const data = this.value_record(json_parse(row["data"]));
        if (data["file_path"] === file_path) {
          ids.push(row_number(row, "id"));
        }
      }
      let deleted = 0;
      for (let index = 0; index < ids.length; index += 500) {
        const chunk = ids.slice(index, index + 500);
        const placeholders = chunk.map(() => "?").join(",");
        deleted += Number(
          db.prepare(`DELETE FROM items WHERE id IN (${placeholders})`).run(...chunk).changes,
        );
      }
      return deleted;
    }
  }

  private set_item(project_path: string, item: DatabaseRow): number {
    const db = this.open_project(project_path);
    const item_id = item["id"];
    const data = { ...item };
    delete data["id"];
    if (item_id === undefined || item_id === null || item_id === "") {
      return Number(
        db.prepare("INSERT INTO items (data) VALUES (?)").run(JSON.stringify(data)).lastInsertRowid,
      );
    }
    db.prepare("UPDATE items SET data = ? WHERE id = ?").run(JSON.stringify(data), Number(item_id));
    return Number(item_id);
  }

  private set_items(project_path: string, items: DatabaseJsonValue[]): number[] {
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
        insert_with_id.run(Number(item_id), JSON.stringify(data));
        ids.push(Number(item_id));
      } else {
        ids.push(Number(insert.run(JSON.stringify(data)).lastInsertRowid));
      }
    }
    return ids;
  }

  private preview_replace_all_item_ids(project_path: string, items: DatabaseJsonValue[]): number[] {
    const db = this.open_project(project_path);
    // 前端预演需要稳定 id，但不能为了预览提前改动 sqlite_sequence。
    const sequence_row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'items'").get();
    const max_row = db.prepare("SELECT MAX(id) AS max_id FROM items").get();
    let current_max_id = Math.max(
      sequence_row === undefined ? 0 : row_number(sequence_row, "seq"),
      max_row === undefined ? 0 : row_number(max_row, "max_id"),
    );
    const preview_ids: number[] = [];
    for (const raw_item of items) {
      const item = this.value_record(raw_item);
      const raw_item_id = item["id"];
      const item_id =
        raw_item_id === undefined || raw_item_id === null || raw_item_id === ""
          ? null
          : Number(raw_item_id);
      if (item_id === null || !Number.isFinite(item_id)) {
        current_max_id += 1;
        preview_ids.push(current_max_id);
      } else {
        current_max_id = Math.max(current_max_id, item_id);
        preview_ids.push(item_id);
      }
    }
    return preview_ids;
  }

  private update_batch(
    project_path: string,
    items: DatabaseJsonValue[] | null,
    rules: DatabaseRow | null,
    meta: DatabaseRow | null,
  ): void {
    const db = this.open_project(project_path);
    if (items !== null) {
      const update_item = db.prepare("UPDATE items SET data = ? WHERE id = ?");
      for (const raw_item of items) {
        const item = this.value_record(raw_item);
        if (typeof item["id"] !== "number") {
          continue;
        }
        const data = { ...item };
        delete data["id"];
        update_item.run(JSON.stringify(data), item["id"]);
      }
    }
    if (rules !== null) {
      for (const [rule_type, rule_data] of Object.entries(rules)) {
        this.set_rules_with_db(db, rule_type, Array.isArray(rule_data) ? rule_data : []);
      }
    }
    if (meta !== null) {
      this.upsert_meta_entries_with_db(db, meta);
    }
  }

  private get_rules(project_path: string, rule_type: string): DatabaseJsonValue {
    const rows = this.open_project(project_path)
      .prepare("SELECT data FROM rules WHERE type = ? ORDER BY id")
      .all(rule_type);
    if (rows.length === 0) {
      return [];
    }
    try {
      const first_data = json_parse(rows[0]?.["data"]);
      if (Array.isArray(first_data)) {
        // 当前规则以单行数组存储；旧工程多行对象会在后续分支平铺兼容。
        return first_data;
      }
    } catch {
      return [];
    }
    const result: DatabaseJsonValue[] = [];
    for (const row of rows) {
      try {
        const data = json_parse(row["data"]);
        if (Array.isArray(data)) {
          result.push(...data);
        } else if (typeof data === "object" && data !== null) {
          result.push(data);
        }
      } catch {
        continue;
      }
    }
    return result;
  }

  private set_rules(project_path: string, rule_type: string, rules: DatabaseJsonValue[]): void {
    this.set_rules_with_db(this.open_project(project_path), rule_type, rules);
  }

  private set_rules_with_db(db: DatabaseSync, rule_type: string, rules: DatabaseJsonValue[]): void {
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JSON.stringify(rules),
    );
  }

  private get_rule_text(project_path: string, rule_type: string): string {
    return this.get_rule_text_by_name(project_path, rule_type);
  }

  private get_rule_text_by_name(project_path: string, rule_type_name: string): string {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM rules WHERE type = ? LIMIT 1")
      .get(rule_type_name);
    if (row === undefined) {
      return "";
    }
    return this.deserialize_rule_text_payload(row_text(row, "data"));
  }

  private set_rule_text(project_path: string, rule_type: string, text: string): void {
    const db = this.open_project(project_path);
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JSON.stringify({ text }),
    );
  }

  private deserialize_rule_text_payload(raw_data: string): string {
    try {
      const data = JSON.parse(raw_data) as unknown;
      if (typeof data === "string") {
        return data;
      }
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        const text = (data as DatabaseRow)["text"];
        return typeof text === "string" ? text : String(text ?? "");
      }
    } catch {
      return "";
    }
    return "";
  }

  private get_project_summary(project_path: string): DatabaseJsonValue {
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

  private require_string(args: Record<string, DatabaseJsonValue>, key: string): string {
    const value = args[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`database 参数 ${key} 必须是非空字符串。`);
    }
    return value;
  }

  private optional_string(args: Record<string, DatabaseJsonValue>, key: string): string | null {
    const value = args[key];
    return typeof value === "string" && value !== "" ? value : null;
  }

  private require_number(args: Record<string, DatabaseJsonValue>, key: string): number {
    const value = args[key];
    if (typeof value !== "number") {
      throw new Error(`database 参数 ${key} 必须是数字。`);
    }
    return value;
  }

  private optional_number(args: Record<string, DatabaseJsonValue>, key: string): number | null {
    const value = args[key];
    return typeof value === "number" ? value : null;
  }

  private require_record(args: Record<string, DatabaseJsonValue>, key: string): DatabaseRow {
    return this.value_record(args[key]);
  }

  private optional_record(
    args: Record<string, DatabaseJsonValue>,
    key: string,
  ): DatabaseRow | null {
    const value = args[key];
    if (value === undefined || value === null) {
      return null;
    }
    return this.value_record(value);
  }

  private require_array(args: Record<string, DatabaseJsonValue>, key: string): DatabaseJsonValue[] {
    const value = args[key];
    if (!Array.isArray(value)) {
      throw new Error(`database 参数 ${key} 必须是数组。`);
    }
    return value;
  }

  private optional_array(
    args: Record<string, DatabaseJsonValue>,
    key: string,
  ): DatabaseJsonValue[] | null {
    const value = args[key];
    return Array.isArray(value) ? value : null;
  }

  private require_string_array(args: Record<string, DatabaseJsonValue>, key: string): string[] {
    return this.require_array(args, key).map((value) => String(value));
  }

  private require_number_array(args: Record<string, DatabaseJsonValue>, key: string): number[] {
    return this.require_array(args, key).map((value) => Number(value));
  }

  private value_record(value: DatabaseJsonValue | unknown): DatabaseRow {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as DatabaseRow;
  }
}
