import type { DatabaseSync } from "node:sqlite";

import { read_json_record } from "../../../domain/json";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_text } from "../migration-row";
import { write_item_migration } from "./item-migration";
import { ZstdTool } from "../../database/zstd-tool";

type TransMetadataRecord = Record<string, unknown>;

/**
 * 当前 TRANS writer 需要的稳定行定位，只包含原始 file_key 和行内 row_index。
 */
interface TransItemReference {
  file_key: string; // 对应 .trans project.files 的键
  row_index: number; // 对应该 file_key 下 data 数组的行号
}

/**
 * asset 索引数组以全局行号定位，引用额外保存用于核验的源文。
 */
interface TransAssetRowReference extends TransItemReference {
  src: string; // 用于确认旧 item 没有被用户改写到其它行
}

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
    const file_path = String(item_data["file_path"] ?? "");
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
    const tag = String(item_data["tag"] ?? "");
    const src = String(item_data["src"] ?? "");
    // 生产索引按每一原始行连续建立，全局行号即数组下标。
    const ref = refs[row];
    return ref === undefined || ref.file_key !== tag || ref.src !== src
      ? null
      : { file_key: ref.file_key, row_index: ref.row_index };
  }

  /**
   * row 必须是非负整数。非法 row 不参与 asset 定位推断。
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
 * 迁移背景：
 * 旧 TRANS 条目仅保存文件、标签和全局行号。当前 writer 依赖 `extra_field.trans_ref` 精确修改原资产。
 * 旧 `aqua` 标签还承载强制翻译语义，当前过滤链通过 `skip_internal_filter` 消费这一事实。
 *
 * 生效场景：
 * Schema 和基础 Item 迁移完成后，用原资产的文件路径、文件键、全局行号和原文共同核验定位。
 * 为匹配的 TRANS 条目补齐引用，为 TRANS 的 `aqua` 条目补 true，清理其它条目中非法的非布尔过滤字段。
 * 已有合法引用和布尔选择优先。独立完成标记与写回数据在同一事务保存。
 *
 * 不处理范围：
 * 缺失或损坏资产、原文已变和定位不符的条目保留原定位事实，缺失引用由导出入口报告。
 * 格式解析与导出回退由文件域负责。单行失败沿用历史容错边界，原文留存。
 */
export function run_trans_item_metadata_migration(db: DatabaseSync): void {
  const asset_index = build_trans_item_metadata_asset_index(db);
  write_item_migration(db, (item) => {
    const file_type = typeof item["file_type"] === "string" ? item["file_type"] : "NONE";
    return { data: item, changed: normalize_trans_item_metadata(item, file_type, asset_index) };
  });
}

/**
 * 按 asset 稳定顺序构建 TRANS 行索引。单个损坏资源不阻塞其它文件迁移。
 */
function build_trans_item_metadata_asset_index(db: DatabaseSync): TransItemMetadataAssetIndex {
  const refs_by_asset_path = new Map<string, TransAssetRowReference[]>();
  const rows = db
    .prepare(
      "SELECT path, data FROM assets WHERE lower(substr(path, -6)) = '.trans' ORDER BY sort_order ASC, id ASC",
    )
    .iterate();
  for (const row of rows) {
    const asset_path = row_text(row, "path");
    try {
      const original = ZstdTool.decompress(bytes_from_blob(row["data"]));
      refs_by_asset_path.set(asset_path, read_asset_row_refs(original));
    } catch {
      // 单个损坏 asset 不阻塞工程打开。对应旧 item 会保持缺失 trans_ref 并在导出时暴露明确错误
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
