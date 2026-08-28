import type { DatabaseSync } from "node:sqlite";

import { Item, is_item_file_type, is_item_status, is_item_text_type } from "../../../domain/item";
import { JsonTool } from "../../../shared/utils/json-tool";
import { row_number, row_text } from "../migration-row";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type ItemMigrationRow = Record<string, unknown>;
type ItemMigrationPayload = Record<string, unknown>;

// item 持久状态的旧值与当前稳定值映射，迁移后业务层不再过滤旧运行态。
const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST";
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED";
const CURRENT_NONE = "NONE";
const LEGACY_MARKDOWN_FILE_TYPE = "MD";
// 这些文件类型在旧工程缺失 text_type 时仍可从 src 推导文本语义。
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set(["XLSX", "KVJSON", "MESSAGEJSON"]);

/**
 * 迁移背景：
 * 早期 item JSON 混入过运行中状态、`row_number` 字段、缺省 file/text 类型和非数值重试次数。
 * 当前 item 持久事实只允许稳定状态和值域，任务运行态不能继续从旧 payload 中临时过滤。
 *
 * 生效场景：
 * `.lg` schema 可用后，打开旧工程时归一所有可解析 item payload。
 *
 * 不处理范围：
 * TRANS 私有定位字段和 `aqua` 强制翻译语义由 `trans-item-metadata-migration` 处理；
 * 损坏 JSON 保留原文，避免迁移阶段静默丢失无法解析的用户数据。
 */
export const project_item_stable_metadata_migration: MigrationDescriptor = {
  id: "project-item-stable-metadata",
  order: 300,
  /**
   * item 基础 metadata 必须早于 TRANS 私有 metadata 迁移，先稳定 file_type/row 等公共字段。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    run_project_item_stable_metadata_migration(context.db);
  },
};

/**
 * 遍历所有可解析 item JSON，损坏行保留原文，不阻塞项目打开。
 */
export function run_project_item_stable_metadata_migration(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
  const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
  for (const row of rows) {
    const raw = row_text(row, "data");
    try {
      const parsed = JsonTool.parseStrict<ItemMigrationRow>(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      const normalized = normalize_item_payload(parsed);
      if (normalized.changed) {
        update.run(JsonTool.stringifyStrict(normalized.data), row_number(row, "id"));
      }
    } catch {
      // 旧工程中损坏的单行 item 不阻塞打开；坏数据仍保留原样等待人工处理
    }
  }
}

/**
 * 单个 item 只归一持久公共字段；格式私有 metadata 留给对应迁移处理。
 */
function normalize_item_payload(item_data: ItemMigrationRow): {
  data: ItemMigrationRow;
  changed: boolean;
} {
  const normalized: ItemMigrationPayload = { ...item_data };
  let changed = false;

  const raw_status = normalized["status"];
  const normalized_status = normalize_item_status_value(raw_status);
  if (raw_status !== normalized_status) {
    normalized["status"] = normalized_status;
    changed = true;
  }

  if (normalized["row"] === undefined && normalized["row_number"] !== undefined) {
    normalized["row"] = row_value_number(normalized["row_number"], 0);
    changed = true;
  }
  if (normalized["row_number"] !== undefined) {
    delete normalized["row_number"];
    changed = true;
  }

  const raw_file_type = normalized["file_type"];
  const normalized_file_type = normalize_migration_file_type(raw_file_type);
  if (raw_file_type !== normalized_file_type) {
    normalized["file_type"] = normalized_file_type;
    changed = true;
  }

  const raw_text_type = normalized["text_type"];
  const normalized_text_type = normalize_item_text_type_value(
    raw_text_type,
    normalized_file_type,
    row_value_text(normalized["src"]),
  );
  if (raw_text_type !== normalized_text_type) {
    normalized["text_type"] = normalized_text_type;
    changed = true;
  }

  const raw_row = normalized["row"];
  const normalized_row = row_value_number(raw_row, 0);
  if (raw_row !== normalized_row) {
    normalized["row"] = normalized_row;
    changed = true;
  }

  const raw_retry_count = normalized["retry_count"];
  const normalized_retry_count = row_value_number(raw_retry_count, 0);
  if (raw_retry_count !== normalized_retry_count) {
    normalized["retry_count"] = normalized_retry_count;
    changed = true;
  }

  return { data: normalized, changed };
}

/** 写回迁移先保留历史 Markdown 类型，交给后续 project-open 文件迁移消费。 */
function normalize_migration_file_type(value: unknown): string {
  if (value === LEGACY_MARKDOWN_FILE_TYPE) {
    return LEGACY_MARKDOWN_FILE_TYPE;
  }
  return typeof value === "string" && is_item_file_type(value) ? value : "NONE";
}

/**
 * 旧运行中状态不能进入持久事实，统一折叠到当前稳定 item 状态。
 */
function normalize_item_status_value(value: unknown): string {
  const raw_value = String(value ?? "");
  if (raw_value === LEGACY_PROCESSED_IN_PAST) {
    return CURRENT_PROCESSED;
  }
  if (raw_value === LEGACY_PROCESSING) {
    return CURRENT_NONE;
  }
  return is_item_status(raw_value) ? raw_value : CURRENT_NONE;
}

/**
 * text_type 缺失时只对历史可推断格式从源文恢复语义。
 */
function normalize_item_text_type_value(value: unknown, file_type: string, src: string): string {
  const raw_value = typeof value === "string" && is_item_text_type(value) ? value : "NONE";
  if (raw_value === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
    return Item.infer_text_type_from_source(src);
  }
  return raw_value;
}

/**
 * item 字段归一读取文本值，缺失字段按空字符串处理。
 */
function row_value_text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * item 数值字段写回整数，非法值回落到调用方给出的默认值。
 */
function row_value_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
