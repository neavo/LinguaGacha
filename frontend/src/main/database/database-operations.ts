import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  PROJECT_DATABASE_SCHEMA_VERSION,
  ProjectDatabaseMigrationService,
} from "../migration/project-database-migration-service";
import { ZstdTool } from "../../shared/utils/zstd-tool";
import { JsonTool } from "../../shared/utils/json-tool";
import type { DatabaseJsonValue, DatabaseOperation } from "./database-types";

type DatabaseRow = Record<string, unknown>;

const CURRENT_NONE = "NONE";

function json_parse(raw_value: unknown): DatabaseJsonValue {
  if (typeof raw_value !== "string") {
    return null;
  }
  return JsonTool.parseStrict<DatabaseJsonValue>(raw_value);
}

function json_stringify(value: DatabaseJsonValue): string {
  return JsonTool.stringifyStrict(value);
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

/**
 * 用独立错误类型把可恢复的 database 冲突映射成稳定 HTTP 错误码。
 */
export class DatabaseConflictError extends Error {}

/**
 * Electron main 内部 .lg 物理读写入口，集中持有 SQLite、事务和 asset 压缩格式。
 */
export class ProjectDatabase {
  private readonly open_databases = new Map<string, DatabaseSync>();

  /**
   * 初始化 ProjectDatabase 依赖，保持外部写入口清晰。
   */
  public constructor() {
    ensure_database_runtime_available();
  }

  /**
   * 关闭底层资源，确保数据库句柄不会跨工程泄漏。
   */
  public close(): void {
    for (const db of this.open_databases.values()) {
      db.close();
    }
    this.open_databases.clear();
  }

  /**
   * 执行受支持的数据库操作名，保持 Python 只能走窄 workflow。
   */
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
      case "bumpRuntimeSectionRevisions":
        return this.bump_runtime_section_revisions(
          this.require_string(args, "projectPath"),
          this.require_string_array(args, "sections"),
        );
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

  /**
   * 在单个 SQLite 事务内执行批量操作，保证跨步骤写入原子性。
   */
  public execute_transaction(operations: DatabaseOperation[]): null {
    if (operations.length === 0) {
      return null;
    }
    // 单个事务只允许绑定一个工程文件，避免跨 .lg 写入出现半提交语义。
    const first_args = this.normalize_args(operations[0]?.args);
    const project_path = this.require_string(first_args, "projectPath");
    const transaction_operations = [...operations];
    let should_remove_created_project_on_failure = false;
    if (transaction_operations[0]?.name === "createProject") {
      // createProject 需要关闭旧句柄并重建文件，必须先完成文件级初始化，再把后续写入包进事务。
      this.execute(transaction_operations.shift() as DatabaseOperation);
      should_remove_created_project_on_failure = true;
      if (transaction_operations.length === 0) {
        return null;
      }
    }
    const db = this.open_project(project_path);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const operation of transaction_operations) {
        this.execute(operation);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (should_remove_created_project_on_failure) {
        this.close_project(project_path);
        fs.rmSync(project_path, { force: true });
      }
      throw error;
    }
    return null;
  }

  /**
   * 按 asset 路径读取解压后的内容，隐藏 .lg 内部压缩格式。
   */
  public read_asset_content(project_path: string, asset_path: string): Buffer | null {
    // Python Core 只消费解压后的原始 bytes，Zstd 格式细节留在 main 进程。
    const db = this.open_project(project_path);
    const row = db.prepare("SELECT data FROM assets WHERE path = ?").get(asset_path);
    if (row === undefined) {
      return null;
    }
    return ZstdTool.decompress(bytes_from_blob(row["data"]));
  }

  /**
   * 把外部参数归一为对象，避免每个操作重复兜底。
   */
  private normalize_args(
    args: Record<string, DatabaseJsonValue> | undefined,
  ): Record<string, DatabaseJsonValue> {
    return args ?? {};
  }

  /**
   * 打开并迁移工程数据库，确保后续读写看到当前 schema。
   */
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

  /**
   * 关闭指定工程连接，释放 ProjectDatabase 缓存中的句柄。
   */
  private close_project(project_path: string): void {
    const normalized_path = path.resolve(project_path);
    const db = this.open_databases.get(normalized_path);
    if (db === undefined) {
      return;
    }
    db.close();
    this.open_databases.delete(normalized_path);
  }

  /**
   * 创建新 .lg 数据库并初始化 schema，作为工程落盘入口。
   */
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

  /**
   * 读取单个 meta 值，保持调用方不直接触碰 SQL。
   */
  private get_meta(
    project_path: string,
    key: string,
    default_value: DatabaseJsonValue,
  ): DatabaseJsonValue {
    const db = this.open_project(project_path);
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row === undefined ? default_value : json_parse(row["value"]);
  }

  /**
   * 写入单个 meta 值，维持 meta 更新的统一序列化方式。
   */
  private set_meta(project_path: string, key: string, value: DatabaseJsonValue): void {
    this.upsert_meta_entries(project_path, { [key]: value });
  }

  /**
   * 批量写入 meta 项，减少跨边界多次 database workflow。
   */
  private upsert_meta_entries(project_path: string, meta: DatabaseRow): void {
    this.upsert_meta_entries_with_db(this.open_project(project_path), meta);
  }

  /**
   * 在既有事务连接内写入 meta，避免事务中重新取句柄。
   */
  private upsert_meta_entries_with_db(db: DatabaseSync, meta: DatabaseRow): void {
    const statement = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(meta)) {
      statement.run(key, JsonTool.stringifyStrict(value));
    }
  }

  /**
   * 读取完整 meta 快照，供运行态编码一次性构建事实。
   */
  private get_all_meta(project_path: string): DatabaseJsonValue {
    const db = this.open_project(project_path);
    const result: Record<string, DatabaseJsonValue> = {};
    for (const row of db.prepare("SELECT key, value FROM meta").all()) {
      result[row_text(row, "key")] = json_parse(row["value"]);
    }
    return result;
  }

  /**
   * 由 Python 任务链路调用的窄 revision 推进入口；公开读取和 ack 仍由 TS 项目域计算。
   */
  private bump_runtime_section_revisions(
    project_path: string,
    sections: string[],
  ): DatabaseJsonValue {
    const db = this.open_project(project_path);
    const supported_sections = new Set(["files", "items", "analysis"]);
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

  private get_meta_from_db(
    db: DatabaseSync,
    key: string,
    default_value: DatabaseJsonValue,
  ): DatabaseJsonValue {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row === undefined ? default_value : json_parse(row["value"]);
  }

  private normalize_revision_value(value: DatabaseJsonValue): number {
    const revision = Number(value ?? 0);
    return Number.isFinite(revision) && revision > 0 ? Math.trunc(revision) : 0;
  }

  /**
   * 读取分析 checkpoint，保持断点续跑只依赖持久事实。
   */
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

  /**
   * 批量保存分析 checkpoint，保证任务提交进度可恢复。
   */
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

  /**
   * 删除指定 checkpoint，避免重置后残留旧分析状态。
   */
  private delete_analysis_item_checkpoints(project_path: string, status: string | null): number {
    const db = this.open_project(project_path);
    if (status === null) {
      return Number(db.prepare("DELETE FROM analysis_item_checkpoint").run().changes);
    }
    return Number(
      db.prepare("DELETE FROM analysis_item_checkpoint WHERE status = ?").run(status).changes,
    );
  }

  /**
   * 归一候选聚合行，保护旧数据和新写入共用同一返回形状。
   */
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

  /**
   * 读取分析候选聚合，供术语导入预演复用。
   */
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

  /**
   * 按原文批量读取候选聚合，减少分析辅助查询次数。
   */
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

  /**
   * 批量写入候选聚合，保持分析结果提交原子化。
   */
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

  /**
   * 清空候选聚合，确保分析重置不混入旧候选。
   */
  private clear_analysis_candidate_aggregates(project_path: string): void {
    this.open_project(project_path).prepare("DELETE FROM analysis_candidate_aggregate").run();
  }

  /**
   * 计算下一个 asset 排序位，保持文件列表顺序稳定。
   */
  private get_next_asset_sort_order(db: DatabaseSync): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM assets")
      .get();
    return row === undefined ? 0 : row_number(row, "next_sort_order");
  }

  /**
   * 从源文件导入 asset，统一压缩和排序字段写入。
   */
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

  /**
   * 导入已压缩 asset，避免跨边界传输二进制细节。
   */
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

  /**
   * 写入 asset buffer，集中处理压缩和记录插入。
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
   * 用源文件更新 asset 内容，保持路径记录不被调用方重建。
   */
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

  /**
   * 更新 asset 路径，保护路径唯一性由数据库入口维护。
   */
  private update_asset_path(project_path: string, old_path: string, new_path: string): void {
    const result = this.open_project(project_path)
      .prepare("UPDATE assets SET path = ? WHERE path = ?")
      .run(new_path, old_path);
    if (Number(result.changes) === 0) {
      throw new DatabaseConflictError("资产不存在，无法重命名。");
    }
  }

  /**
   * 读取压缩 asset 文本，供需要原始压缩载荷的旧接口兼容。
   */
  private get_asset_compressed_base64(project_path: string, asset_path: string): DatabaseJsonValue {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM assets WHERE path = ?")
      .get(asset_path);
    return row === undefined ? null : bytes_from_blob(row["data"]).toString("base64");
  }

  /**
   * 删除 asset 记录，保持文件移除只走存储入口。
   */
  private delete_asset(project_path: string, asset_path: string): void {
    this.open_project(project_path).prepare("DELETE FROM assets WHERE path = ?").run(asset_path);
  }

  /**
   * 检查 asset 路径是否占用，供导入链路生成稳定唯一名。
   */
  private asset_path_exists(project_path: string, asset_path: string): boolean {
    const row = this.open_project(project_path)
      .prepare("SELECT 1 FROM assets WHERE path = ? LIMIT 1")
      .get(asset_path);
    return row !== undefined;
  }

  /**
   * 读取所有 asset 路径，供工作台文件集合重建。
   */
  private get_all_asset_paths(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT path FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => row_text(row, "path"));
  }

  /**
   * 读取 asset 记录快照，供运行态排序与导出使用。
   */
  private get_all_asset_records(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT path, sort_order FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => ({ path: row_text(row, "path"), sort_order: row_number(row, "sort_order") }));
  }

  /**
   * 批量更新 asset 顺序，保证文件重排一次事务完成。
   */
  private update_asset_sort_orders(project_path: string, ordered_paths: string[]): void {
    const statement = this.open_project(project_path).prepare(
      "UPDATE assets SET sort_order = ? WHERE path = ?",
    );
    for (const [sort_order, asset_path] of ordered_paths.entries()) {
      statement.run(sort_order, asset_path);
    }
  }

  /**
   * 读取全部条目事实，供 bootstrap 和项目快照重建。
   */
  private get_all_items(project_path: string): DatabaseJsonValue {
    return this.open_project(project_path)
      .prepare("SELECT id, data FROM items ORDER BY id")
      .all()
      .map((row) => ({ ...this.value_record(json_parse(row["data"])), id: row_number(row, "id") }));
  }

  /**
   * 按 id 读取条目，减少校对和任务提交后的回查范围。
   */
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

  /**
   * 按文件删除条目，保证文件移除同步清理条目事实。
   */
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

  /**
   * 写入单条条目事实，统一 item payload 序列化规则。
   */
  private set_item(project_path: string, item: DatabaseRow): number {
    const db = this.open_project(project_path);
    const item_id = item["id"];
    const data = { ...item };
    delete data["id"];
    if (item_id === undefined || item_id === null || item_id === "") {
      return Number(
        db.prepare("INSERT INTO items (data) VALUES (?)").run(JsonTool.stringifyStrict(data))
          .lastInsertRowid,
      );
    }
    db.prepare("UPDATE items SET data = ? WHERE id = ?").run(
      JsonTool.stringifyStrict(data),
      Number(item_id),
    );
    return Number(item_id);
  }

  /**
   * 批量写入条目事实，确保导入和重置链路高效落盘。
   */
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
        insert_with_id.run(Number(item_id), JsonTool.stringifyStrict(data));
        ids.push(Number(item_id));
      } else {
        ids.push(Number(insert.run(JsonTool.stringifyStrict(data)).lastInsertRowid));
      }
    }
    return ids;
  }

  /**
   * 预览批量替换影响范围，避免页面直接拼 SQL 选择条目。
   */
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

  /**
   * 按受限字段批量更新条目，收口校对批量 mutation。
   */
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
        update_item.run(JsonTool.stringifyStrict(data), item["id"]);
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

  /**
   * 读取指定规则集合，保持质量规则运行时只看数据库事实。
   */
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

  /**
   * 写入指定规则集合，统一 revision 与 payload 维护。
   */
  private set_rules(project_path: string, rule_type: string, rules: DatabaseJsonValue[]): void {
    this.set_rules_with_db(this.open_project(project_path), rule_type, rules);
  }

  /**
   * 在既有事务连接内写入规则，避免规则和 meta 分离提交。
   */
  private set_rules_with_db(db: DatabaseSync, rule_type: string, rules: DatabaseJsonValue[]): void {
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JsonTool.stringifyStrict(rules),
    );
  }

  /**
   * 读取提示词或规则文本，统一文本规则落点。
   */
  private get_rule_text(project_path: string, rule_type: string): string {
    return this.get_rule_text_by_name(project_path, rule_type);
  }

  /**
   * 按规则名读取文本，兼容旧调用方的命名入口。
   */
  private get_rule_text_by_name(project_path: string, rule_type_name: string): string {
    const row = this.open_project(project_path)
      .prepare("SELECT data FROM rules WHERE type = ? LIMIT 1")
      .get(rule_type_name);
    if (row === undefined) {
      return "";
    }
    return this.deserialize_rule_text_payload(row_text(row, "data"));
  }

  /**
   * 保存文本规则内容，保持 prompt 与规则文本写入一致。
   */
  private set_rule_text(project_path: string, rule_type: string, text: string): void {
    const db = this.open_project(project_path);
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    db.prepare("INSERT INTO rules (type, data) VALUES (?, ?)").run(
      rule_type,
      JsonTool.stringifyStrict({ text }),
    );
  }

  /**
   * 解析文本规则载荷，兼容旧字符串和新对象格式。
   */
  private deserialize_rule_text_payload(raw_data: string): string {
    try {
      const data = JsonTool.parseStrict(raw_data) as unknown;
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

  /**
   * 读取工程摘要，供打开预览和运行态快速判断使用。
   */
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

  /**
   * 校验必填字符串，避免脏载荷进入数据库层。
   */
  private require_string(args: Record<string, DatabaseJsonValue>, key: string): string {
    const value = args[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`database 参数 ${key} 必须是非空字符串。`);
    }
    return value;
  }

  /**
   * 校验可选字符串，统一空值和类型错误语义。
   */
  private optional_string(args: Record<string, DatabaseJsonValue>, key: string): string | null {
    const value = args[key];
    return typeof value === "string" && value !== "" ? value : null;
  }

  /**
   * 校验必填数字，避免调用点散落类型断言。
   */
  private require_number(args: Record<string, DatabaseJsonValue>, key: string): number {
    const value = args[key];
    if (typeof value !== "number") {
      throw new Error(`database 参数 ${key} 必须是数字。`);
    }
    return value;
  }

  /**
   * 校验可选数字，统一空值和类型错误语义。
   */
  private optional_number(args: Record<string, DatabaseJsonValue>, key: string): number | null {
    const value = args[key];
    return typeof value === "number" ? value : null;
  }

  /**
   * 校验必填对象，保证 workflow 参数形状稳定。
   */
  private require_record(args: Record<string, DatabaseJsonValue>, key: string): DatabaseRow {
    return this.value_record(args[key]);
  }

  /**
   * 校验可选对象，减少调用点重复防御。
   */
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

  /**
   * 校验必填数组，避免数据库操作接收非数组载荷。
   */
  private require_array(args: Record<string, DatabaseJsonValue>, key: string): DatabaseJsonValue[] {
    const value = args[key];
    if (!Array.isArray(value)) {
      throw new Error(`database 参数 ${key} 必须是数组。`);
    }
    return value;
  }

  /**
   * 校验可选数组，统一空载荷处理。
   */
  private optional_array(
    args: Record<string, DatabaseJsonValue>,
    key: string,
  ): DatabaseJsonValue[] | null {
    const value = args[key];
    return Array.isArray(value) ? value : null;
  }

  /**
   * 校验字符串数组，保护批量路径和 id 操作。
   */
  private require_string_array(args: Record<string, DatabaseJsonValue>, key: string): string[] {
    return this.require_array(args, key).map((value) => String(value));
  }

  /**
   * 校验数字数组，保护批量序号操作。
   */
  private require_number_array(args: Record<string, DatabaseJsonValue>, key: string): number[] {
    return this.require_array(args, key).map((value) => Number(value));
  }

  /**
   * 把 JSON 值收窄为对象，保留数据库 payload 的类型边界。
   */
  private value_record(value: DatabaseJsonValue | unknown): DatabaseRow {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as DatabaseRow;
  }
}
