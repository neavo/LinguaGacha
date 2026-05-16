import type { DatabaseSync } from "node:sqlite";

import { Item, is_item_file_type, is_item_status, is_item_text_type } from "../../../base/item";
import { JsonTool } from "../../../shared/utils/json-tool";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type ItemMigrationRow = Record<string, unknown>;
type ItemMigrationPayload = Record<string, unknown>;

// item 持久状态的旧值与当前稳定值映射，迁移后业务层不再过滤旧运行态。
const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST";
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED";
const CURRENT_NONE = "NONE";
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
    ProjectItemStableMetadataMigration.run(context.db);
  },
};

/**
 * 负责清洗 items 表中的通用 item payload，让后续迁移和业务读取只面对当前字段和值域。
 */
export class ProjectItemStableMetadataMigration {
  /**
   * 遍历所有可解析 item JSON，损坏行保留原文，不阻塞项目打开。
   */
  public static run(db: DatabaseSync): void {
    const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
    const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = row_text(row, "data");
      try {
        const parsed = JsonTool.parseStrict<ItemMigrationRow>(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          continue;
        }
        const normalized = this.normalize_item_payload(parsed);
        if (normalized.changed) {
          update.run(JsonTool.stringifyStrict(normalized.data), row_number(row, "id"));
        }
      } catch {
        // 旧工程中损坏的单行 item 不阻塞打开；坏数据仍保留原样等待人工处理
      }
    }
  }

  /**
   * 归一 item 公共字段：状态、行号、文件类型、文本类型和重试次数。
   */
  public static normalize_item_payload(item_data: ItemMigrationRow): {
    data: ItemMigrationRow;
    changed: boolean;
  } {
    const normalized: ItemMigrationPayload = { ...item_data };
    let changed = false;

    const raw_status = normalized["status"];
    const normalized_status = this.normalize_item_status_value(raw_status);
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
    const normalized_file_type =
      typeof raw_file_type === "string" && is_item_file_type(raw_file_type)
        ? raw_file_type
        : "NONE";
    if (raw_file_type !== normalized_file_type) {
      normalized["file_type"] = normalized_file_type;
      changed = true;
    }

    const raw_text_type = normalized["text_type"];
    const normalized_text_type = this.normalize_item_text_type_value(
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

  /**
   * 旧运行中状态不能进入当前持久事实，统一折回稳定三态。
   */
  private static normalize_item_status_value(value: unknown): string {
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
   * 缺失 text_type 时只对能从 src 推导的文件类型补写文本语义。
   */
  private static normalize_item_text_type_value(
    value: unknown,
    file_type: string,
    src: string,
  ): string {
    const raw_value = typeof value === "string" && is_item_text_type(value) ? value : "NONE";
    if (raw_value === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
      return Item.infer_text_type_from_source(src);
    }
    return raw_value;
  }
}

/**
 * items 表读取文本统一收窄，损坏 JSON 判断依赖原始字符串。
 */
function row_text(row: ItemMigrationRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * items 表 id 写回前统一转 number，兼容 bigint 返回。
 */
function row_number(row: ItemMigrationRow, key: string): number {
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
