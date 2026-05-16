import type { DatabaseSync } from "node:sqlite";

import { JsonTool } from "../../../shared/utils/json-tool";
import { ZstdTool } from "../../../shared/utils/zstd-tool";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

/**
 * 本文件只处理旧 .lg 中 TRANS 条目的持久 metadata 归一，不是运行期兼容层。
 *
 * 前因：
 * - 早期 TS 版本从 .trans 导入 item 时，导出写回仍可在缺少精确定位信息时按 tag / row 重建局部文件。
 * - 当前 TRANS writer 已收紧为只消费 `extra_field.trans_ref`，用原始 `project.files[file_key].data[row_index]`
 *   做最小补丁，避免导出阶段再猜测行归属、重排 data/tags/context/parameters 或误写重复文本。
 * - 旧工程里已经落库的 TRANS item 可能没有 `trans_ref`，但 `.lg` assets 表仍保存原始 .trans 文件；
 *   因此正确的全局修复点是打开期写回迁移，而不是把旧重建逻辑塞回 writer。
 *
 * 同时修正的历史语义：
 * - Python TRANS/NONE.check 中 `aqua` 标签表示“强制翻译”：item 保持 `status=NONE`，
 *   但后续规则/语言内部过滤必须跳过短路判断。
 * - 早期 TS 项目只把 `aqua` 保存在 `extra_field.tag`，没有独立 `skip_internal_filter` 字段；
 *   工程重开后 worker、reset、prefilter 只能读取 item JSON，无法可靠恢复这层语义。
 *
 * 生效场景：
 * - `.lg` schema 和 item 基础 metadata 已归一后执行。
 * - 仅处理 `file_type === "TRANS"` 的 item；非 TRANS 条目不会从 `aqua` 推导强制过滤字段。
 * - 仅当旧 item 的 `file_path + tag + row + src` 与原始 .trans asset 中某一行完全一致时补写
 *   `extra_field.trans_ref`；任何缺 asset、asset 损坏、字段不一致或行已被用户改写的情况都不猜测。
 * - 已存在合法 `trans_ref` 或布尔 `skip_internal_filter` 时视为当前项目事实，不覆盖用户后续改动。
 *
 * 迁移后边界：
 * - 干净项目的 TRANS writer 只按 `trans_ref` 写回；仍缺失定位的旧脏数据会在导出时暴露明确错误。
 * - 本文件可以读取 `.lg` 物理 asset 来清理历史数据，但不能承接新格式解析或导出回退职责。
 */
type TransMetadataRecord = Record<string, unknown>;

/**
 * 当前 TRANS writer 需要的稳定行定位，只包含原始 file_key 和行内 row_index。
 */
export interface TransItemReference {
  file_key: string; // file_key 对应 .trans project.files 的键
  row_index: number; // row_index 对应该 file_key 下 data 数组的行号
}

/**
 * asset 索引内部使用的引用，额外保存旧 item 可匹配的全局行号和源文。
 */
interface TransAssetRowReference extends TransItemReference {
  global_row: number; // global_row 对应旧 item.row 的跨文件累计行号
  src: string; // src 用于确认旧 item 没有被用户改写到其它行
}

export const trans_item_metadata_migration: MigrationDescriptor = {
  id: "trans-item-metadata",
  order: 400,
  /**
   * TRANS 私有 metadata 依赖 item 公共字段和 asset sort_order 已归一。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    TransItemMetadataMigration.run(context.db);
  },
};

/**
 * TRANS asset 索引只服务打开期写回迁移，把旧 item metadata 一次性归正为当前持久契约。
 */
export class TransItemMetadataAssetIndex {
  /**
   * refs_by_asset_path 以 `.lg` asset path 为键，保存原始 .trans 每一行的稳定定位。
   */
  public constructor(
    private readonly refs_by_asset_path: Map<string, TransAssetRowReference[]> = new Map(),
  ) {}

  /**
   * 旧 item 只有 file_path/tag/row/src 时，必须四项同时命中才补 trans_ref。
   */
  public resolve(item_data: TransMetadataRecord): TransItemReference | null {
    const file_path = this.read_string(item_data["file_path"]);
    if (file_path === "") {
      return null;
    }
    const refs = this.refs_by_asset_path.get(file_path);
    if (refs === undefined) {
      return null;
    }
    const row = this.read_non_negative_integer(item_data["row"]);
    if (row === null) {
      return null;
    }
    const tag = this.read_string(item_data["tag"]);
    const src = this.read_string(item_data["src"]);
    const ref = refs.find(
      (candidate) =>
        candidate.global_row === row && candidate.file_key === tag && candidate.src === src,
    );
    return ref === undefined ? null : { file_key: ref.file_key, row_index: ref.row_index };
  }

  /**
   * 旧 item 字段缺失时按空字符串参与匹配，避免 undefined 误命中。
   */
  private read_string(value: unknown): string {
    return typeof value === "string" ? value : String(value ?? "");
  }

  /**
   * row 必须是非负整数；非法 row 不参与 asset 定位推断。
   */
  private read_non_negative_integer(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const integer = Math.trunc(parsed);
    return integer >= 0 ? integer : null;
  }
}

/**
 * 负责写回 TRANS item 的 trans_ref 与 skip_internal_filter，不承担导出期回退逻辑。
 */
export class TransItemMetadataMigration {
  /**
   * 建立 asset 索引后遍历 item 表，仅写回确定可迁的 TRANS metadata。
   */
  public static run(db: DatabaseSync): void {
    const asset_index = this.build_asset_index(db);
    const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
    const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = row_text(row, "data");
      try {
        const parsed = JsonTool.parseStrict<TransMetadataRecord>(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          continue;
        }
        const file_type = typeof parsed["file_type"] === "string" ? parsed["file_type"] : "NONE";
        if (this.normalize_item_payload(parsed, file_type, asset_index)) {
          update.run(JsonTool.stringifyStrict(parsed), row_number(row, "id"));
        }
      } catch {
        // 损坏 item 不阻塞工程打开；无法解析的原文留给后续人工处理
      }
    }
  }

  /**
   * 从压缩 asset 中读取原始 .trans 内容，损坏 asset 只影响对应旧 item。
   */
  public static build_asset_index(db: DatabaseSync): TransItemMetadataAssetIndex {
    const refs_by_asset_path = new Map<string, TransAssetRowReference[]>();
    const rows = db.prepare("SELECT path, data FROM assets ORDER BY sort_order ASC, id ASC").all();
    for (const row of rows) {
      const asset_path = row_text(row, "path");
      if (!asset_path.toLowerCase().endsWith(".trans")) {
        continue;
      }
      try {
        const original = ZstdTool.decompress(bytes_from_blob(row["data"]));
        refs_by_asset_path.set(asset_path, this.read_asset_row_refs(original));
      } catch {
        // 单个损坏 asset 不阻塞工程打开；对应旧 item 会保持缺失 trans_ref 并在导出时暴露明确错误
      }
    }
    return new TransItemMetadataAssetIndex(refs_by_asset_path);
  }

  /**
   * 单个 item 的纯归一逻辑，供数据库迁移和单测复用。
   */
  public static normalize_item_payload(
    item_data: TransMetadataRecord,
    file_type: string,
    asset_index: TransItemMetadataAssetIndex = new TransItemMetadataAssetIndex(),
  ): boolean {
    let changed = this.normalize_skip_internal_filter(item_data, file_type);
    if (file_type !== "TRANS" || this.has_valid_trans_ref(item_data["extra_field"])) {
      return changed;
    }
    const resolved_ref = asset_index.resolve(item_data);
    if (resolved_ref === null) {
      return changed;
    }
    const extra_field = this.to_mutable_extra_field(item_data["extra_field"]);
    extra_field["trans_ref"] = {
      file_key: resolved_ref.file_key,
      row_index: resolved_ref.row_index,
    };
    item_data["extra_field"] = extra_field;
    changed = true;
    return changed;
  }

  /**
   * skip_internal_filter 是当前布尔事实；旧 aqua 标签只在字段缺失时推导 true。
   */
  private static normalize_skip_internal_filter(
    item_data: TransMetadataRecord,
    file_type: string,
  ): boolean {
    const raw_skip_internal_filter = item_data["skip_internal_filter"];
    if (typeof raw_skip_internal_filter === "boolean") {
      return false;
    }
    if (this.is_trans_aqua_item(item_data, file_type)) {
      item_data["skip_internal_filter"] = true;
      return true;
    }
    if (raw_skip_internal_filter !== undefined) {
      delete item_data["skip_internal_filter"];
      return true;
    }
    return false;
  }

  /**
   * 解析 .trans project.files，按全局行号建立 file_key/row_index/src 三元定位。
   */
  private static read_asset_row_refs(content: Uint8Array): TransAssetRowReference[] {
    const root = JsonTool.parseStrict<unknown>(content);
    const project = read_record(read_record(root)["project"]);
    const files = read_record(project["files"]);
    const index_original = non_negative_index(project["indexOriginal"], 0);
    const refs: TransAssetRowReference[] = [];
    for (const [file_key, entry_raw] of Object.entries(files)) {
      const entry = read_record(entry_raw);
      const data_list = Array.isArray(entry["data"]) ? entry["data"] : [];
      for (const [row_index, data_raw] of data_list.entries()) {
        const data_row = Array.isArray(data_raw) ? data_raw : [];
        refs.push({
          file_key,
          row_index,
          global_row: refs.length,
          src: typeof data_row[index_original] === "string" ? data_row[index_original] : "",
        });
      }
    }
    return refs;
  }

  /**
   * 只有 TRANS 条目且旧 tag 数组包含 aqua，才表示强制跳过内部过滤。
   */
  private static is_trans_aqua_item(item_data: TransMetadataRecord, file_type: string): boolean {
    if (file_type !== "TRANS") {
      return false;
    }
    const extra_field = read_record(item_data["extra_field"]);
    const tag = extra_field["tag"];
    return Array.isArray(tag) && tag.some((value) => value === "aqua");
  }

  /**
   * 已有合法 trans_ref 是当前项目事实，迁移不能覆盖。
   */
  private static has_valid_trans_ref(value: unknown): boolean {
    const extra_field = read_record(value);
    const trans_ref = read_record(extra_field["trans_ref"]);
    const file_key = trans_ref["file_key"];
    const row_index = trans_ref["row_index"];
    return (
      typeof file_key === "string" &&
      typeof row_index === "number" &&
      Number.isInteger(row_index) &&
      row_index >= 0
    );
  }

  /**
   * extra_field 缺失或损坏时从空对象开始补字段，不复用可变外部引用。
   */
  private static to_mutable_extra_field(value: unknown): TransMetadataRecord {
    const record = read_record(value);
    return { ...record };
  }
}

/**
 * JSON record 读取统一收窄，数组和 null 都视为空对象。
 */
function read_record(value: unknown): TransMetadataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as TransMetadataRecord)
    : {};
}

/**
 * .trans indexOriginal 只能使用非负整数，非法值回落到原文第一列。
 */
function non_negative_index(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * SQLite 行文本读取统一收窄，服务 asset path 和 item data 读取。
 */
function row_text(row: TransMetadataRecord, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * SQLite id 写回前统一转 number，兼容 bigint 返回。
 */
function row_number(row: TransMetadataRecord, key: string): number {
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
 * node:sqlite BLOB 在不同运行时可能是 Buffer 或 Uint8Array，统一转 Buffer 给 Zstd。
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
