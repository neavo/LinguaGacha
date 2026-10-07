import type { ItemMigrationPayload } from "./item-migration";
import type { DatabaseSync } from "node:sqlite";

import { is_item_status } from "../../../domain/item";
import { read_json_integer } from "../../../domain/json";
import {
  write_item_migration,
  normalize_migration_file_type,
  normalize_migration_text_type,
} from "./item-migration";

// item 持久状态的旧值与当前稳定值映射，迁移后业务层不再过滤旧运行态。
const LEGACY_PROCESSED_IN_PAST = "PROCESSED_IN_PAST";
const LEGACY_PROCESSING = "PROCESSING";
const CURRENT_PROCESSED = "PROCESSED";
const CURRENT_NONE = "NONE";

/**
 * 迁移背景：
 * 早期 item JSON 混入过运行中状态、`row_number` 字段和缺省 file/text 类型。
 * 当前 item 持久事实只允许稳定状态和值域，任务运行态不能继续从旧 payload 中临时过滤。
 *
 * 生效场景：
 * `.lg` schema 可用后，打开旧工程时归一所有可解析 item payload。
 *
 * 不处理范围：
 * TRANS 私有定位字段和 `aqua` 强制翻译语义由 `trans-item-metadata-migration` 处理。
 * 损坏 JSON 保留原文，避免迁移阶段静默丢失无法解析的用户数据。
 */
export function run_project_item_stable_metadata_migration(db: DatabaseSync): void {
  write_item_migration(db, normalize_item_payload);
}

/**
 * 单个 item 只归一持久公共字段。格式私有 metadata 留给对应迁移处理。
 */
function normalize_item_payload(item_data: ItemMigrationPayload): {
  data: ItemMigrationPayload;
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
    normalized["row"] = read_json_integer(normalized["row_number"], 0);
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
  const normalized_text_type = normalize_migration_text_type(
    raw_text_type,
    normalized_file_type,
    String(normalized["src"] ?? ""),
  );
  if (raw_text_type !== normalized_text_type) {
    normalized["text_type"] = normalized_text_type;
    changed = true;
  }

  const raw_row = normalized["row"];
  const normalized_row = read_json_integer(raw_row, 0);
  if (raw_row !== normalized_row) {
    normalized["row"] = normalized_row;
    changed = true;
  }

  return { data: normalized, changed };
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
