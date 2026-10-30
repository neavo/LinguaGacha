import { read_translation_for_generation } from "../shared/translation-generation-text";
import type { Item } from "../../../domain/item";
import { read_json_record, type JsonValue, type MutableJsonRecord } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import {
  derive_trans_filter_effect,
  string_array,
  to_mutable_record,
  type NoneTransProcessor,
} from "./trans-processor";

/** 条目定位通过原稿校验后，交给同步写回流程使用。 */
export type PatchTarget = {
  item: Readonly<Item>;
  file_key: string;
  row_index: number;
};

/**
 * 校验所有条目都能通过 trans_ref 定位原始数据行，避免无定位信息时猜测写回
 */
export function collect_patch_targets(
  items: readonly Readonly<Item>[],
  files: MutableJsonRecord,
): PatchTarget[] {
  const targets: PatchTarget[] = [];
  for (const item of items) {
    const trans_ref = read_json_record(read_json_record(item.extra_field)["trans_ref"]);
    const file_key = trans_ref["file_key"];
    const row_index = trans_ref["row_index"];
    if (
      typeof file_key !== "string" ||
      typeof row_index !== "number" ||
      !Number.isInteger(row_index)
    ) {
      throw new AppError("file.invalid_structure", {
        public_details: { format: "TRANS" },
        diagnostic_context: { reason: "missing_trans_ref" },
      });
    }
    const entry = to_mutable_record(files[file_key]);
    const data_list = Array.isArray(entry["data"]) ? entry["data"] : null;
    if (data_list === null || row_index < 0 || row_index >= data_list.length) {
      throw new AppError("file.invalid_structure", {
        public_details: { format: "TRANS" },
        diagnostic_context: { file_key, row_index, reason: "trans_ref_out_of_range" },
      });
    }
    targets.push({ item, file_key, row_index });
  }
  return targets;
}

/**
 * 对单行执行最小补丁：必要时更新 tags/parameters，PROCESSED 才写译文列
 */
export function patch_trans_row(
  files: MutableJsonRecord,
  target: PatchTarget,
  processor: NoneTransProcessor,
  index_translation: number,
): void {
  const entry = to_mutable_record(files[target.file_key]);
  const tag_row = read_row_string_array(entry["tags"], target.row_index);
  const context_row = read_row_string_array(entry["context"], target.row_index);
  const parameter_row = read_row_value(entry["parameters"], target.row_index);
  const effect = derive_trans_filter_effect({
    block: processor.filter(target.item.src, target.file_key, tag_row, context_row),
    tag: tag_row,
    parameter: parameter_row,
  });

  if (effect.tag !== tag_row) {
    const tags_field = ensure_array_field(entry, "tags");
    while (tags_field.length <= target.row_index) {
      tags_field.push([]);
    }
    tags_field[target.row_index] = effect.tag;
  }

  if (effect.is_mixed_partition) {
    const parameters_field = ensure_array_field(entry, "parameters");
    while (parameters_field.length <= target.row_index) {
      parameters_field.push(null);
    }
    parameters_field[target.row_index] = processor.generate_parameter(
      target.item.src,
      context_row,
      parameter_row,
      effect.block,
    );
  }

  // KV 类：未完成结果保持源行，完成空译文覆盖目标列。
  const translation = read_translation_for_generation(target.item);
  if (translation === undefined) {
    files[target.file_key] = entry;
    return;
  }

  const data_list = ensure_array_field(entry, "data");
  if (target.row_index >= data_list.length) {
    files[target.file_key] = entry;
    return;
  }
  const row_raw = data_list[target.row_index];
  const row = Array.isArray(row_raw) ? row_raw : [];
  while (row.length <= index_translation) {
    row.push("");
  }
  row[index_translation] = translation;
  data_list[target.row_index] = row;
  files[target.file_key] = entry;
}

/**
 * 从行级二维字段读取字符串数组，缺失行直接为空
 */
function read_row_string_array(value: JsonValue | undefined, row_index: number): string[] {
  const rows = Array.isArray(value) ? value : [];
  return string_array(rows[row_index]);
}

/**
 * 从行级二维字段读取原始 JSON 值，供参数 schema 探测使用
 */
function read_row_value(value: JsonValue | undefined, row_index: number): JsonValue | undefined {
  const rows = Array.isArray(value) ? value : [];
  return rows[row_index];
}

/**
 * 写回可选数组字段时就地补齐字段，保持原始 JSON 对象最小变更
 */
function ensure_array_field(record: MutableJsonRecord, field: string): JsonValue[] {
  const value = record[field];
  if (Array.isArray(value)) {
    return value;
  }
  const replacement: JsonValue[] = [];
  record[field] = replacement;
  return replacement;
}
