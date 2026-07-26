import type { DatabaseSync } from "node:sqlite";

import { read_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";
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
  file_key: string; // 对应 .trans project.files 的键
  row_index: number; // 对应该 file_key 下 data 数组的行号
}

/**
 * asset 索引内部使用的引用，额外保存旧 item 可匹配的全局行号和源文。
 */
interface TransAssetRowReference extends TransItemReference {
  global_row: number; // 对应旧 item.row 的跨文件累计行号
  src: string; // 用于确认旧 item 没有被用户改写到其它行
}

export const trans_item_metadata_migration: MigrationDescriptor = {
  id: "trans-item-metadata",
  order: 400,
  /**
   * TRANS 私有 metadata 依赖 item 公共字段和 asset sort_order 已归一。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    run_trans_item_metadata_migration(context.db);
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
 * 遍历持久 item，并用原始 TRANS asset 的精确索引补齐可证明的 metadata。
 */
export function run_trans_item_metadata_migration(db: DatabaseSync): void {
  const asset_index = build_trans_item_metadata_asset_index(db);
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
      if (normalize_trans_item_metadata(parsed, file_type, asset_index)) {
        update.run(JsonTool.stringifyStrict(parsed), row_number(row, "id"));
      }
    } catch {
      // 损坏 item 不阻塞工程打开；无法解析的原文留给后续人工处理
    }
  }
}

/**
 * 按 asset 稳定顺序构建 TRANS 行索引；单个损坏资源不阻塞其它文件迁移。
 */
function build_trans_item_metadata_asset_index(db: DatabaseSync): TransItemMetadataAssetIndex {
  const refs_by_asset_path = new Map<string, TransAssetRowReference[]>();
  const rows = db.prepare("SELECT path, data FROM assets ORDER BY sort_order ASC, id ASC").all();
  for (const row of rows) {
    const asset_path = row_text(row, "path");
    if (!asset_path.toLowerCase().endsWith(".trans")) {
      continue;
    }
    try {
      const original = ZstdTool.decompress(bytes_from_blob(row["data"]));
      refs_by_asset_path.set(asset_path, read_asset_row_refs(original));
    } catch {
      // 单个损坏 asset 不阻塞工程打开；对应旧 item 会保持缺失 trans_ref 并在导出时暴露明确错误
    }
  }
  return new TransItemMetadataAssetIndex(refs_by_asset_path);
}

/**
 * 保留已有当前事实，只补 aqua 强制翻译语义和可唯一定位的 trans_ref。
 */
export function normalize_trans_item_metadata(
  item_data: TransMetadataRecord,
  file_type: string,
  asset_index: TransItemMetadataAssetIndex = new TransItemMetadataAssetIndex(),
): boolean {
  let changed = normalize_skip_internal_filter(item_data, file_type);
  if (file_type !== "TRANS" || has_valid_trans_ref(item_data["extra_field"])) {
    return changed;
  }
  const resolved_ref = asset_index.resolve(item_data);
  if (resolved_ref === null) {
    return changed;
  }
  const extra_field = { ...read_json_record(item_data["extra_field"]) };
  extra_field["trans_ref"] = {
    file_key: resolved_ref.file_key,
    row_index: resolved_ref.row_index,
  };
  item_data["extra_field"] = extra_field;
  changed = true;
  return changed;
}

/**
 * 旧 aqua 标签只在 TRANS item 上迁为布尔跳过内部过滤字段。
 */
function normalize_skip_internal_filter(
  item_data: TransMetadataRecord,
  file_type: string,
): boolean {
  const raw_skip_internal_filter = item_data["skip_internal_filter"];
  if (typeof raw_skip_internal_filter === "boolean") {
    return false;
  }
  if (is_trans_aqua_item(item_data, file_type)) {
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
 * 从原始 `.trans` 的 files/data 顺序生成全局行号与精确文件内定位。
 */
function read_asset_row_refs(content: Uint8Array): TransAssetRowReference[] {
  const root = JsonTool.parseStrict<unknown>(content);
  const project = read_json_record(read_json_record(root)["project"]);
  const files = read_json_record(project["files"]);
  const index_original = non_negative_index(project["indexOriginal"], 0);
  const refs: TransAssetRowReference[] = [];
  for (const [file_key, entry_raw] of Object.entries(files)) {
    const entry = read_json_record(entry_raw);
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
 * aqua 是 TRANS 专用强制翻译标签，非 TRANS 文件不能借此改变过滤语义。
 */
function is_trans_aqua_item(item_data: TransMetadataRecord, file_type: string): boolean {
  if (file_type !== "TRANS") {
    return false;
  }
  const tag = read_json_record(item_data["extra_field"])["tag"];
  return Array.isArray(tag) && tag.some((value) => value === "aqua");
}

/**
 * 当前 trans_ref 必须同时含文件键和非负整数行号。
 */
function has_valid_trans_ref(value: unknown): boolean {
  const trans_ref = read_json_record(read_json_record(value)["trans_ref"]);
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
 * .trans indexOriginal 只能使用非负整数，非法值回落到原文第一列。
 */
function non_negative_index(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
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
