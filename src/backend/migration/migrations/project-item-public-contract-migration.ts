import type { DatabaseSync } from "node:sqlite";

import { Item } from "../../../domain/item";
import { JsonTool } from "../../../shared/utils/json-tool";
import type { MigrationDescriptor, ProjectDatabaseMigrationContext } from "../migration-types";

type ItemContractRow = Record<string, unknown>;
type ItemContractPayload = Record<string, unknown>;

// 完整公开 DTO 契约需要这些文件类型在缺失 text_type 时保留历史推断语义。
const TEXT_TYPE_INFERENCE_FILE_TYPES = new Set(["XLSX", "KVJSON", "MESSAGEJSON"]);

/**
 * 迁移背景：
 * 完整公开 item DTO 成为项目 query、预过滤、reset 和全量写回的唯一跨层形状。
 * 已执行过旧写回迁移的项目不会再进入旧迁移，因此公开 DTO 依赖字段必须由新的迁移 id 一次性补齐。
 *
 * 生效场景：
 * `.lg` schema 可用后，打开旧工程时补齐完整公开 DTO 所需的稳定持久字段。
 */
export const project_item_public_contract_migration: MigrationDescriptor = {
  id: "project-item-public-contract",
  order: 450,
  /**
   * 公开 DTO 契约依赖基础 item 和 TRANS 私有 metadata 先完成各自归一。
   */
  run_project_database_writeback(context: ProjectDatabaseMigrationContext): void {
    ProjectItemPublicContractMigration.run(context.db);
  },
};

/**
 * 负责把旧 item payload 升级到完整公开 DTO 可生成的持久契约。
 */
export class ProjectItemPublicContractMigration {
  /**
   * 遍历所有可解析 item JSON，损坏行保留原文，不阻塞项目打开。
   */
  public static run(db: DatabaseSync): void {
    const rows = db.prepare("SELECT id, data FROM items ORDER BY id").all();
    const update = db.prepare("UPDATE items SET data = ? WHERE id = ?");
    for (const row of rows) {
      const raw = row_text(row, "data");
      try {
        const parsed = JsonTool.parseStrict<ItemContractRow>(raw);
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
   * 补齐公开 DTO 必需字段，同时保留未知格式私有字段和已有 extra_field 内容。
   */
  public static normalize_item_payload(item_data: ItemContractRow): {
    data: ItemContractRow;
    changed: boolean;
  } {
    const normalized: ItemContractPayload = { ...item_data };
    let changed = false;

    const src = read_string(normalized["src"]);
    changed = assign_contract_field(normalized, "src", src) || changed;
    changed = assign_contract_field(normalized, "dst", read_string(normalized["dst"])) || changed;
    changed =
      assign_contract_field(normalized, "name_src", Item.normalize_name(normalized["name_src"])) ||
      changed;
    changed =
      assign_contract_field(normalized, "name_dst", Item.normalize_name(normalized["name_dst"])) ||
      changed;
    changed =
      assign_contract_field(
        normalized,
        "extra_field",
        normalized["extra_field"] === undefined ? "" : normalized["extra_field"],
      ) || changed;
    changed = assign_contract_field(normalized, "tag", read_string(normalized["tag"])) || changed;
    changed =
      assign_contract_field(
        normalized,
        "row",
        read_number(normalized["row"] ?? normalized["row_number"], 0),
      ) || changed;
    if (normalized["row_number"] !== undefined) {
      delete normalized["row_number"];
      changed = true;
    }

    const file_type = Item.normalize_file_type(normalized["file_type"]);
    changed = assign_contract_field(normalized, "file_type", file_type) || changed;
    changed =
      assign_contract_field(normalized, "file_path", read_string(normalized["file_path"])) ||
      changed;
    changed =
      assign_contract_field(
        normalized,
        "text_type",
        normalize_text_type(normalized["text_type"], file_type, src),
      ) || changed;
    changed =
      assign_contract_field(normalized, "status", Item.normalize_status(normalized["status"])) ||
      changed;
    changed =
      assign_contract_field(normalized, "retry_count", read_number(normalized["retry_count"], 0)) ||
      changed;
    changed =
      assign_contract_field(
        normalized,
        "skip_internal_filter",
        normalized["skip_internal_filter"] === true,
      ) || changed;

    return { data: normalized, changed };
  }
}

/**
 * text_type 缺失时沿用基础 item 迁移的推断边界，避免公开 DTO 失去文本语义。
 */
function normalize_text_type(value: unknown, file_type: string, src: string): string {
  const text_type = Item.normalize_text_type(value);
  if (text_type === "NONE" && TEXT_TYPE_INFERENCE_FILE_TYPES.has(file_type)) {
    return Item.infer_text_type_from_source(src);
  }
  return text_type;
}

/**
 * 只在字段真实变化时写回，减少旧工程打开期无意义更新。
 */
function assign_contract_field(
  item_data: ItemContractPayload,
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

/**
 * items 表读取文本统一收窄，损坏 JSON 判断依赖原始字符串。
 */
function row_text(row: ItemContractRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * items 表 id 写回前统一转 number，兼容 bigint 返回。
 */
function row_number(row: ItemContractRow, key: string): number {
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
 * 字符串契约字段统一在迁移层落为稳定文本值。
 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * 数值契约字段写回整数，非法值回落到调用方给出的默认值。
 */
function read_number(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
