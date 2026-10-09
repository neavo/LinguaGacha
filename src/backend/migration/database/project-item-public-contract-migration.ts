import type { ItemMigrationPayload } from "./item-migration";
import type { DatabaseSync } from "node:sqlite";

import { normalize_item_name_field, normalize_item_status } from "../../../domain/item";
import { JsonTool } from "../../../shared/utils/json-tool";
import { read_json_integer } from "../../../domain/json";
import {
  write_item_migration,
  normalize_migration_file_type,
  normalize_migration_text_type,
} from "./item-migration";

/**
 * 迁移背景：
 * 完整公开 item DTO 成为项目 query、预过滤、reset 和全量写回的唯一跨层形状。
 * 已执行过旧写回迁移的项目不会再进入旧迁移，因此公开 DTO 依赖字段必须由新的迁移 id 一次性补齐。
 *
 * 生效场景：
 * `.lg` schema、基础 Item 和 TRANS 迁移完成后补齐公开 DTO 字段，由独立完成标记避免重复执行。
 *
 * 不处理范围：
 * 不替代旧状态和 TRANS 定位迁移。格式私有字段及未知字段保留，逐行失败沿用历史容错规则。
 */
export function run_project_item_public_contract_migration(db: DatabaseSync): void {
  write_item_migration(db, normalize_item_public_contract_payload);
}

/**
 * 补齐公开 DTO 固定字段并返回真实变化标记，格式私有字段保持原样。
 */
export function normalize_item_public_contract_payload(item_data: ItemMigrationPayload): {
  data: ItemMigrationPayload;
  changed: boolean;
} {
  const normalized: ItemMigrationPayload = { ...item_data };
  let changed = false;

  const src = String(normalized["src"] ?? "");
  changed = assign_contract_field(normalized, "src", src) || changed;
  changed = assign_contract_field(normalized, "dst", String(normalized["dst"] ?? "")) || changed;
  changed =
    assign_contract_field(
      normalized,
      "name_src",
      normalize_item_name_field(normalized["name_src"]),
    ) || changed;
  changed =
    assign_contract_field(
      normalized,
      "name_dst",
      normalize_item_name_field(normalized["name_dst"]),
    ) || changed;
  changed =
    assign_contract_field(
      normalized,
      "extra_field",
      normalized["extra_field"] === undefined ? "" : normalized["extra_field"],
    ) || changed;
  changed = assign_contract_field(normalized, "tag", String(normalized["tag"] ?? "")) || changed;
  changed =
    assign_contract_field(
      normalized,
      "row",
      read_json_integer(normalized["row"] ?? normalized["row_number"], 0),
    ) || changed;
  if (normalized["row_number"] !== undefined) {
    delete normalized["row_number"];
    changed = true;
  }

  const file_type = normalize_migration_file_type(normalized["file_type"]);
  changed = assign_contract_field(normalized, "file_type", file_type) || changed;
  changed =
    assign_contract_field(normalized, "file_path", String(normalized["file_path"] ?? "")) ||
    changed;
  changed =
    assign_contract_field(
      normalized,
      "text_type",
      normalize_migration_text_type(normalized["text_type"], file_type, src),
    ) || changed;
  changed =
    assign_contract_field(normalized, "status", normalize_item_status(normalized["status"])) ||
    changed;
  changed =
    assign_contract_field(
      normalized,
      "skip_internal_filter",
      normalized["skip_internal_filter"] === true,
    ) || changed;

  return { data: normalized, changed };
}

/**
 * 只在字段真实变化时写回，减少旧工程打开期无意义更新。
 */
function assign_contract_field(
  item_data: ItemMigrationPayload,
  key: string,
  value: unknown,
): boolean {
  if (json_values_equal(item_data[key], value)) {
    return false;
  }
  item_data[key] = value;
  return true;
}

/**
 * JSON 字段按序列化值比较，保证字符串数组姓名等复合值不会被引用差异误判。
 */
function json_values_equal(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return JsonTool.stringifyStrict(left) === JsonTool.stringifyStrict(right);
}
