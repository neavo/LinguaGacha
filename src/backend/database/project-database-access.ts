import { database_error } from "./database-error";
import type { ProjectPreview } from "../../shared/project-preview";
import { read_project_revision } from "../../domain/project-revision";
import { build_project_translation_stats } from "../../shared/project-translation-stats";
import type { PDFDocument, PDFDocumentRecord, PDFPage, PDFSummary } from "../../shared/pdf";
import { read_pdf_document } from "../../shared/pdf-schema";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { ZstdTool } from "./zstd-tool";
import { JsonTool } from "../../shared/utils/json-tool";
import * as AppErrors from "../../shared/error";
import type { ProjectItemWriteFields } from "../../shared/project/project-item-update";
import { normalize_project_item_field_patch } from "../../shared/project/project-item-update";

import {
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";

/** 事务规划完成后的三个可写字段，格式私有数据仍留在原 JSON 中。 */
export type ProjectItemTranslationWrite = Readonly<{
  item_id: number;
  next: Readonly<ProjectItemWriteFields>;
}>;
type DatabaseRow = Record<string, unknown>;

// SQLite 的 IN 参数统一在数据库边界分块。业务批量大小不应复用这个存储安全值。
const SQLITE_IN_CLAUSE_CHUNK_SIZE = 500;

/** 让所有 IN 查询共享同一存储分块边界，避免调用方各自猜测 SQLite 参数容量。 */
function for_each_sqlite_in_clause_chunk<T>(
  values: readonly T[],
  callback: (chunk: readonly T[]) => void,
): void {
  for (let index = 0; index < values.length; index += SQLITE_IN_CLAUSE_CHUNK_SIZE) {
    callback(values.slice(index, index + SQLITE_IN_CLAUSE_CHUNK_SIZE));
  }
}

export type ProjectDatabaseWrite = (database: ProjectDatabaseAccess) => void;

/** 资产路径与顺序由数据库读取入口提供，消费者使用明确字段。 */
export type ProjectAssetRecord = Readonly<{
  path: string; // 工程内的资产路径
  sort_order: number; // 资产表中的排序位
  file_type: string; // 资产拥有格式身份，零条目文件也保留。
}>;

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

/** 单次数据库批次的同步读写对象，结束后失效。 */
export class ProjectDatabaseAccess {
  public active = true; // 由拥有连接的批次撤销，不能跨事务复用。
  /** 绑定本批工程路径与连接。 */
  public constructor(
    private readonly project_path: string,
    private readonly db: DatabaseSync,
  ) {}
  /** 同步读写只接受仍有效且属于本工程的作用域。 */
  private with_project_connection<T>(project_path: string, callback: (db: DatabaseSync) => T): T {
    if (!this.active || path.resolve(project_path) !== this.project_path)
      throw new AppErrors.AppError("runtime.cancelled");
    try {
      return callback(this.db);
    } catch (error) {
      throw database_error(error, project_path, "operation");
    }
  }
  /**
   * 在连接作用域内写入单个元数据字段。
   */
  public set_meta(project_path: string, key: string, value: JsonValue): void {
    this.with_project_connection(project_path, (db) =>
      this.upsert_meta_entries_with_db(db, { [key]: value }),
    );
  }

  /** 合并提交的 meta 键，保留其它工程元数据。 */
  public upsert_meta_entries(project_path: string, meta: JsonRecord): void {
    this.with_project_connection(project_path, (db) => this.upsert_meta_entries_with_db(db, meta));
  }

  /** 读取工程元数据，供上层一次组装设置与 revision。 */
  public get_all_meta(project_path: string): JsonRecord {
    return this.with_project_connection(project_path, (db) => this.read_all_meta(db));
  }

  /** 推进 files/items revision，重复 section 在同次调用中只计一次。 */
  public bump_section_revisions(project_path: string, sections: string[]): JsonRecord {
    return this.with_project_connection(project_path, (db) =>
      this.advance_section_revisions(db, sections),
    );
  }

  /** 资产和 PDF 元数据同属一次导入，由调用方事务保证一起提交。 */
  public add_asset(
    project_path: string,
    asset_path: string,
    source: Uint8Array,
    file_type: string,
    document: PDFDocument | null,
    sort_order: number | null = null,
  ): void {
    this.with_project_connection(project_path, (db) => {
      this.insert_asset(db, asset_path, source, file_type, sort_order);
      this.replace_pdf_source(db, asset_path, document);
    });
  }

  /** 替换资产同时更新 PDF 来源。摘要不符时由外层事务回滚两者。 */
  public update_asset(
    project_path: string,
    asset_path: string,
    source: Uint8Array,
    file_type: string,
    document: PDFDocument | null,
  ): void {
    this.with_project_connection(project_path, (db) => {
      this.replace_asset(db, asset_path, source, file_type);
      this.replace_pdf_source(db, asset_path, document);
    });
  }

  /** 导入准备与资产写入之间源文件可能变化。摘要校验与文档替换共用外层事务。 */
  private replace_pdf_source(
    db: DatabaseSync,
    file_path: string,
    document: PDFDocument | null,
  ): void {
    db.prepare("DELETE FROM pdf_pages WHERE file_path = ?").run(file_path);
    if (document === null) {
      db.prepare("DELETE FROM pdf_documents WHERE file_path = ?").run(file_path);
      return;
    }
    read_pdf_document(document);
    const row = db.prepare("SELECT data FROM assets WHERE path = ?").get(file_path);
    const bytes = row === undefined ? null : ZstdTool.decompress(bytes_from_blob(row["data"]));
    if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== document.digest)
      throw new AppErrors.AppError("file.parse_failed", {
        diagnostic_context: { reason: "source_changed_after_parse", file_path },
      });
    db.prepare(
      "INSERT INTO pdf_documents(file_path, data) VALUES (?, ?) ON CONFLICT(file_path) DO UPDATE SET data = excluded.data",
    ).run(file_path, JSON.stringify({ digest: document.digest }));
    const insert = db.prepare("INSERT INTO pdf_pages(file_path, page, data) VALUES (?, ?, ?)");
    for (const page of document.pages) insert.run(file_path, page.page, JSON.stringify(page));
  }

  /** 按工程相对路径读取并校验文档，缺失用 null 表达。 */
  public read_pdf_document(project_path: string, file_path: string): PDFDocument | null {
    return this.with_project_connection(project_path, (db) => {
      const row = db.prepare("SELECT data FROM pdf_documents WHERE file_path = ?").get(file_path);
      return row
        ? read_pdf_document({
            ...(json_parse(row["data"]) as JsonRecord),
            pages: db
              .prepare("SELECT data FROM pdf_pages WHERE file_path = ? ORDER BY page")
              .all(file_path)
              .map((page) => json_parse(page["data"])),
          })
        : null;
    });
  }

  /** 快照按 asset 顺序组合文档，页面正文按原页顺序读取。 */
  public read_pdf_documents(project_path: string): PDFDocumentRecord[] {
    return this.with_project_connection(project_path, (db) =>
      db
        .prepare(
          "SELECT p.file_path FROM pdf_documents p JOIN assets a ON a.path = p.file_path ORDER BY a.sort_order, a.id",
        )
        .all()
        .map((row) => {
          const file_path = row_text(row, "file_path");
          return { file_path, document: this.read_pdf_document(project_path, file_path)! };
        }),
    );
  }

  /** 文件菜单只读取分组计数，避免加载正文和原始资产。 */
  public read_file_counts(project_path: string): Map<string, number> {
    return this.with_project_connection(
      project_path,
      (db) =>
        new Map(
          db
            .prepare(
              `SELECT json_extract(data, '$.file_path') AS path, COUNT(*) AS count FROM items GROUP BY path UNION ALL SELECT file_path AS path, COUNT(*) AS count FROM pdf_pages GROUP BY file_path`,
            )
            .all()
            .map((row) => [String(row["path"]), Number(row["count"])]),
        ),
    );
  }

  /** 列表按页面处置统计，正文按单文档读取。 */
  public read_pdf_summaries(project_path: string): Record<string, PDFSummary> {
    return this.with_project_connection(project_path, (db) =>
      Object.fromEntries(
        db
          .prepare(
            `SELECT p.file_path, COUNT(*) AS pages,
             SUM(CASE WHEN json_extract(p.data, '$.translation.kind') = 'translate' THEN 1 ELSE 0 END) AS translated_pages,
             SUM(CASE WHEN json_extract(p.data, '$.translation.kind') = 'keep' THEN 1 ELSE 0 END) AS kept_pages,
             SUM(CASE WHEN json_extract(p.data, '$.translation.kind') = 'omit' THEN 1 ELSE 0 END) AS omitted_pages
           FROM pdf_pages p JOIN assets a ON a.path = p.file_path
           GROUP BY p.file_path ORDER BY a.sort_order, a.id`,
          )
          .all()
          .map((row) => [
            row_text(row, "file_path"),
            {
              pages: Number(row["pages"]),
              translated_pages: Number(row["translated_pages"]),
              kept_pages: Number(row["kept_pages"]),
              omitted_pages: Number(row["omitted_pages"]),
            },
          ]),
      ),
    );
  }

  /** 页级正式写入仅由 ProjectWriteStore 在复验后调用，事务负责整体回滚。 */
  public write_pdf_page(project_path: string, file_path: string, page: PDFPage): void {
    this.with_project_connection(project_path, (db) => {
      db.prepare("UPDATE pdf_pages SET data = ? WHERE file_path = ? AND page = ?").run(
        JSON.stringify(page),
        file_path,
        page.page,
      );
    });
  }

  /** 重置清空各页译稿、核对与续做记录，保留原稿身份与页面信息。 */
  public reset_pdf_translations(project_path: string, file_paths: readonly string[]): void {
    this.with_project_connection(project_path, (db) => {
      const statement = db.prepare(
        "UPDATE pdf_pages SET data = json_set(data, '$.translation', NULL, '$.reviewed', json('false'), '$.notes', '') WHERE file_path = ?",
      );
      for (const file_path of file_paths) statement.run(file_path);
    });
  }

  /** PDF 文档与源资产一起删除，调用方负责整个项目写入的事务。 */
  public delete_asset(project_path: string, asset_path: string): void {
    this.with_project_connection(project_path, (db) => {
      db.prepare("DELETE FROM pdf_pages WHERE file_path = ?").run(asset_path);
      db.prepare("DELETE FROM pdf_documents WHERE file_path = ?").run(asset_path);
      this.remove_asset(db, asset_path);
    });
  }

  /** 按持久化顺序返回路径与排序位，不读取资产正文。 */
  public get_all_asset_records(project_path: string): ProjectAssetRecord[] {
    return this.with_project_connection(project_path, (db) => this.read_all_asset_records(db));
  }

  /** 直接统计资产数量，避免文件列表全量读取。 */
  public get_asset_count(project_path: string): number {
    return this.with_project_connection(project_path, (db) => this.read_asset_count(db));
  }

  /** 按调用方顺序重排资产，多步写入由调用方事务包裹。 */
  public update_asset_sort_orders(project_path: string, ordered_paths: string[]): void {
    this.with_project_connection(project_path, (db) =>
      this.write_asset_sort_orders(db, ordered_paths),
    );
  }

  /** 按数据库 id 顺序返回条目及其持久身份。 */
  public get_all_items(project_path: string): JsonRecord[] {
    return this.with_project_connection(project_path, (db) => this.read_all_items(db));
  }

  /** 直接统计条目数量，避免解析 JSON 正文。 */
  public get_item_count(project_path: string): number {
    return this.with_project_connection(project_path, (db) => this.read_item_count(db));
  }

  /** 通过 SQL 聚合条目状态，供进度统计读取。 */
  public get_item_status_summary(project_path: string): JsonRecord {
    return this.with_project_connection(project_path, (db) => this.read_item_status_summary(db));
  }

  /** 按请求 id 顺序回查存在的条目，并去重请求。 */
  public get_items_by_ids(project_path: string, item_ids: number[]): JsonRecord[] {
    return this.with_project_connection(project_path, (db) => this.read_items_by_ids(db, item_ids));
  }

  /** 替换整个条目集合，调用方事务负责与相关工程事实一起提交。 */
  public set_items(project_path: string, items: JsonValue[]): number[] {
    return this.with_project_connection(project_path, (db) => this.replace_items(db, items));
  }

  /** 批量更新译文字段，保持条目原文与定位信息。 */
  public patch_item_translation_fields(
    project_path: string,
    patches: readonly ProjectItemTranslationWrite[],
  ): void {
    this.with_project_connection(project_path, (db) =>
      this.write_item_translation_fields(db, patches),
    );
  }

  /** 读取指定规则类型的持久载荷，由领域层校验内容。 */
  public get_rules(project_path: string, rule_type: string): JsonValue[] {
    return this.with_project_connection(project_path, (db) => this.read_rules(db, rule_type));
  }

  /** 替换指定类型的规则载荷，其它规则类型继续保留。 */
  public set_rules(project_path: string, rule_type: string, rules: JsonValue[]): void {
    this.with_project_connection(project_path, (db) =>
      this.set_rules_with_db(db, rule_type, rules),
    );
  }

  /** 无记录返回 null，已存空字符串保留为显式覆盖。 */
  public get_rule_text(project_path: string, rule_type: string): string | null {
    return this.with_project_connection(project_path, (db) => this.read_rule_text(db, rule_type));
  }

  /** null 删除覆盖，字符串以现有文本规则形状保存。 */
  public set_rule_text(project_path: string, rule_type: string, text: string | null): void {
    this.with_project_connection(project_path, (db) => this.write_rule_text(db, rule_type, text));
  }

  /** 聚合工程元数据和条目进度，供列表与状态读取。 */
  public get_project_summary(project_path: string): ProjectPreview {
    return this.with_project_connection(project_path, (db) => this.read_project_summary(db));
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
  private read_all_meta(db: DatabaseSync): JsonRecord {
    const result: MutableJsonRecord = {};
    for (const row of db.prepare("SELECT key, value FROM meta").all()) {
      result[row_text(row, "key")] = json_parse(row["value"]);
    }
    return result;
  }

  /**
   * 由内部任务数据路由调用的窄 revision 推进入口。公开读取和 ack 仍由 项目域计算
   */
  private advance_section_revisions(db: DatabaseSync, sections: string[]): JsonRecord {
    const supported_sections = new Set(["files", "items"]);
    const next_revisions: Record<string, number> = {};
    for (const section of sections) {
      if (!supported_sections.has(section) || section in next_revisions) {
        continue;
      }
      const key = `project_runtime_revision.${section}`;
      const current = read_project_revision(this.get_meta_from_db(db, key, 0));
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
   * 计算下一个 asset 排序位，保持文件列表顺序稳定
   */
  private get_next_asset_sort_order(db: DatabaseSync): number {
    const row = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM assets")
      .get();
    return row === undefined ? 0 : row_number(row, "next_sort_order");
  }

  /**
   * 将解析时固定的原始字节压缩后写入资产，保持定位与原稿一致
   */
  private insert_asset(
    db: DatabaseSync,
    asset_path: string,
    source: Uint8Array,
    file_type: string,
    sort_order: number | null,
  ): void {
    const original_data = Buffer.from(source);
    const compressed = ZstdTool.compress(original_data);
    const effective_sort_order = sort_order ?? this.get_next_asset_sort_order(db);
    db.prepare(
      `INSERT INTO assets (path, sort_order, data, original_size, compressed_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      asset_path,
      effective_sort_order,
      compressed,
      original_data.byteLength,
      compressed.byteLength,
      file_type,
    );
  }

  /**
   * 更新资产内容与格式身份，保持已有路径和顺序
   */
  private replace_asset(
    db: DatabaseSync,
    asset_path: string,
    source: Uint8Array,
    file_type: string,
  ): void {
    const original_data = Buffer.from(source);
    const compressed = ZstdTool.compress(original_data);
    const result = db
      .prepare(
        `UPDATE assets
         SET data = ?, original_size = ?, compressed_size = ?, file_type = ?
         WHERE path = ?`,
      )
      .run(compressed, original_data.byteLength, compressed.byteLength, file_type, asset_path);
    if (Number(result.changes) === 0) {
      throw new AppErrors.AppError("database.conflict", {
        diagnostic_context: { reason: "Asset does not exist and cannot be updated." },
      });
    }
  }

  /**
   * 删除 asset 记录，保持文件移除只走存储入口
   */
  private remove_asset(db: DatabaseSync, asset_path: string): void {
    db.prepare("DELETE FROM assets WHERE path = ?").run(asset_path);
  }

  /**
   * 读取 asset 记录快照，供运行态排序与导出使用
   */
  private read_all_asset_records(db: DatabaseSync): ProjectAssetRecord[] {
    return db
      .prepare("SELECT path, sort_order, file_type FROM assets ORDER BY sort_order ASC, id ASC")
      .all()
      .map((row) => ({
        path: row_text(row, "path"),
        sort_order: row_number(row, "sort_order"),
        file_type: row_text(row, "file_type"),
      }));
  }

  /**
   * 文件数量直接由 SQL 聚合读取，manifest 不为计数预热 files section
   */
  private read_asset_count(db: DatabaseSync): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM assets").get();
    return row === undefined ? 0 : row_number(row, "count");
  }

  /**
   * 批量更新 asset 顺序，保证文件重排一次事务完成
   */
  private write_asset_sort_orders(db: DatabaseSync, ordered_paths: string[]): void {
    const statement = db.prepare("UPDATE assets SET sort_order = ? WHERE path = ?");
    for (const [sort_order, asset_path] of ordered_paths.entries()) {
      statement.run(sort_order, asset_path);
    }
  }

  /**
   * 读取全部条目事实，供项目数据读取和任务快照重建
   */
  private read_all_items(db: DatabaseSync): JsonRecord[] {
    const file_types = new Map(
      this.read_all_asset_records(db).map((asset) => [asset.path, asset.file_type]),
    );
    return db
      .prepare("SELECT id, data FROM items ORDER BY id")
      .all()
      .map((row) => this.read_item_record(row, file_types));
  }

  /**
   * 条目数量直接由 SQL 聚合读取，manifest 不为计数扫描完整 item payload
   */
  private read_item_count(db: DatabaseSync): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM items").get();
    return row === undefined ? 0 : row_number(row, "count");
  }

  /**
   * 翻译统计口径由 status 决定，SQL 聚合为缺失 meta 的校对保存提供低成本基线。
   */
  private read_item_status_summary(db: DatabaseSync): JsonRecord {
    const row = db
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
  private read_items_by_ids(db: DatabaseSync, item_ids: number[]): JsonRecord[] {
    const normalized_ids = [
      ...new Set(
        item_ids.map((item_id) => Number(item_id)).filter((item_id) => Number.isFinite(item_id)),
      ),
    ];
    if (normalized_ids.length === 0) {
      return [];
    }
    const file_types = new Map(
      this.read_all_asset_records(db).map((asset) => [asset.path, asset.file_type]),
    );
    const rows_by_id = new Map<number, JsonRecord>();
    for_each_sqlite_in_clause_chunk(normalized_ids, (chunk) => {
      const placeholders = chunk.map(() => "?").join(",");
      for (const row of db
        .prepare(`SELECT id, data FROM items WHERE id IN (${placeholders})`)
        .all(...chunk)) {
        const item_id = row_number(row, "id");
        rows_by_id.set(item_id, this.read_item_record(row, file_types));
      }
    });
    return normalized_ids
      .map((item_id) => rows_by_id.get(item_id))
      .filter((item): item is JsonRecord => item !== undefined);
  }

  /**
   * 批量写入条目事实，确保导入和重置链路高效落盘
   */
  private replace_items(db: DatabaseSync, items: JsonValue[]): number[] {
    db.prepare("DELETE FROM items").run();
    const insert_with_id = db.prepare("INSERT INTO items (id, data) VALUES (?, ?)");
    const insert = db.prepare("INSERT INTO items (data) VALUES (?)");
    const ids: number[] = [];
    for (const raw_item of items) {
      const item = this.value_record(raw_item);
      const item_id = item["id"];
      const data = { ...item };
      delete data["id"];
      delete data["file_type"];
      delete data["text_type"];
      if (item_id !== undefined && item_id !== null && item_id !== "") {
        insert_with_id.run(Number(item_id), JsonTool.stringifyStrict(data));
        ids.push(Number(item_id));
      } else {
        ids.push(Number(insert.run(JsonTool.stringifyStrict(data)).lastInsertRowid));
      }
    }
    return ids;
  }

  /** 事务提供最终译文字段，固定语句保留格式私有 JSON。 */
  private write_item_translation_fields(
    db: DatabaseSync,
    patches: readonly ProjectItemTranslationWrite[],
  ): void {
    const statement = db.prepare(
      "UPDATE items SET data = json_set(data, '$.dst', ?, '$.name_dst', json(?), '$.status', ?) WHERE id = ?",
    );
    for (const { item_id, next } of patches) {
      const fields = normalize_project_item_field_patch(next);
      if (
        !Number.isInteger(item_id) ||
        item_id <= 0 ||
        fields === null ||
        fields.dst === undefined ||
        !Object.hasOwn(fields, "name_dst") ||
        fields.status === undefined
      ) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "invalid_translation_fields", item_id },
        });
      }
      const result = statement.run(
        fields.dst,
        JsonTool.stringifyStrict(fields.name_dst),
        fields.status,
        item_id,
      );
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
  private read_rules(db: DatabaseSync, rule_type: string): JsonValue[] {
    const row = db.prepare("SELECT data FROM rules WHERE type = ? ORDER BY id").get(rule_type);
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
  private read_rule_text(db: DatabaseSync, rule_type: string): string | null {
    const row = db.prepare("SELECT data FROM rules WHERE type = ? LIMIT 1").get(rule_type);
    if (row === undefined) {
      return null;
    }
    return this.deserialize_rule_text_payload(row_text(row, "data"));
  }

  /**
   * 保存文本规则内容，保持 prompt 与规则文本写入一致
   */
  private write_rule_text(db: DatabaseSync, rule_type: string, text: string | null): void {
    db.prepare("DELETE FROM rules WHERE type = ?").run(rule_type);
    if (text === null) return;
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
  private read_project_summary(db: DatabaseSync): ProjectPreview {
    const meta = this.value_record(this.read_all_meta(db));
    const assets = db.prepare("SELECT path FROM assets ORDER BY sort_order ASC, id ASC").all();
    const items = db
      .prepare("SELECT data FROM items ORDER BY id ASC")
      .all()
      .map((row) => {
        const item = this.value_record(json_parse(row["data"]));
        return {
          file_path: String(item["file_path"] ?? ""),
          status: String(item["status"] ?? "NONE"),
        };
      });
    const file_paths = assets.map((asset) => row_text(asset, "path"));
    return {
      file_paths,
      created_at: String(meta["created_at"] ?? ""),
      updated_at: String(meta["updated_at"] ?? ""),
      translation_stats: build_project_translation_stats(items),
    };
  }

  /**
   * 把 JSON 值收窄为对象，保留数据库 payload 的类型边界
   */
  private value_record(value: unknown): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return value as JsonRecord;
  }

  /** 迁移在项目打开事务中更新资产身份。 */
  public set_asset_file_type(project_path: string, file_path: string, file_type: string): void {
    this.with_project_connection(project_path, (db) => {
      db.prepare("UPDATE assets SET file_type = ? WHERE path = ?").run(file_type, file_path);
    });
  }

  /** 解析正文一次后补齐资产身份，避免大工程逐行重复解析 JSON 做关联。 */
  private read_item_record(row: DatabaseRow, file_types: ReadonlyMap<string, string>): JsonRecord {
    const item = this.value_record(json_parse(row["data"]));
    return {
      ...item,
      id: row_number(row, "id"),
      file_type: file_types.get(String(item["file_path"] ?? "")) ?? "NONE",
    };
  }
}
