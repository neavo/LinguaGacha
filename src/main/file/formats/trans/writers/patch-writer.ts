import type { ApiJsonValue } from "../../../../api/api-types";
import {
  has_color_block_tag,
  string_array,
  to_mutable_record,
  type ApiJsonRecord,
  type PatchTarget,
  type TransSnapshot,
  type NoneTransProcessor,
} from "../trans-processor";

/**
 * 校验所有条目都能通过 trans_ref 定位原始数据行，避免无定位信息时猜测写回
 */
export function collect_patch_targets(
  snapshots: TransSnapshot[],
  files: ApiJsonRecord,
): PatchTarget[] {
  const targets: PatchTarget[] = [];
  for (const snap of snapshots) {
    const trans_ref = to_mutable_record(snap.extra_field["trans_ref"]);
    const file_key = trans_ref["file_key"];
    const row_index = trans_ref["row_index"];
    if (
      typeof file_key !== "string" ||
      typeof row_index !== "number" ||
      !Number.isInteger(row_index)
    ) {
      throw new Error("TRANS 条目缺少有效 trans_ref，无法定位原始行。");
    }
    const entry = to_mutable_record(files[file_key]);
    const data_list = Array.isArray(entry["data"]) ? entry["data"] : null;
    if (data_list === null || row_index < 0 || row_index >= data_list.length) {
      throw new Error("TRANS 条目的 trans_ref 指向不存在的原始行。");
    }
    targets.push({ snap, file_key, row_index });
  }
  return targets;
}

/**
 * 对单行执行最小补丁：必要时更新 tags/parameters，PROCESSED 才写译文列
 */
export function patch_trans_row(
  files: ApiJsonRecord,
  target: PatchTarget,
  processor: NoneTransProcessor,
  index_translation: number,
): void {
  const entry = to_mutable_record(files[target.file_key]);
  const tag_row = read_row_string_array(entry["tags"], target.row_index);
  const context_row = read_row_string_array(entry["context"], target.row_index);
  const parameter_row = read_row_value(entry["parameters"], target.row_index);
  let block = processor.filter(target.snap.src, target.file_key, tag_row, context_row);
  if (block.length === 0) {
    block = [false];
  }

  const is_all_blocked = block.every(Boolean);
  const is_all_unblocked = block.every((value) => !value);
  const is_mixed_block = !is_all_blocked && !is_all_unblocked;
  const parameter_list_for_schema = Array.isArray(parameter_row) ? parameter_row : [];
  const has_partition = parameter_list_for_schema.some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      ("contextStr" in value || "translation" in value),
  );
  const has_span = parameter_list_for_schema.some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      ("start" in value || "end" in value || "enclosure" in value || "lineIndent" in value),
  );
  const is_span_schema = has_span && !has_partition;
  const is_mixed_partition = is_mixed_block && !is_span_schema;

  let new_tags = tag_row;
  if (
    is_mixed_partition &&
    !tag_row.some((value) => value === "red" || value === "blue" || value === "gold")
  ) {
    new_tags = [...tag_row, "gold"];
  } else if (!is_mixed_partition && tag_row.includes("gold") && !has_color_block_tag(tag_row)) {
    new_tags = tag_row.filter((value) => value !== "gold");
  }
  if (new_tags !== tag_row) {
    const tags_field = ensure_array_field(entry, "tags");
    while (tags_field.length <= target.row_index) {
      tags_field.push([]);
    }
    tags_field[target.row_index] = new_tags;
  }

  if (is_mixed_partition) {
    const parameters_field = ensure_array_field(entry, "parameters");
    while (parameters_field.length <= target.row_index) {
      parameters_field.push(null);
    }
    parameters_field[target.row_index] = processor.generate_parameter(
      target.snap.src,
      context_row,
      parameter_row,
      block,
    );
  }

  if (target.snap.status !== "PROCESSED") {
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
  row[index_translation] = target.snap.dst;
  data_list[target.row_index] = row;
  files[target.file_key] = entry;
}

/**
 * 从行级二维字段读取字符串数组，缺失行直接为空
 */
function read_row_string_array(value: ApiJsonValue | undefined, row_index: number): string[] {
  const rows = Array.isArray(value) ? value : [];
  return string_array(rows[row_index]);
}

/**
 * 从行级二维字段读取原始 JSON 值，供参数 schema 探测使用
 */
function read_row_value(
  value: ApiJsonValue | undefined,
  row_index: number,
): ApiJsonValue | undefined {
  const rows = Array.isArray(value) ? value : [];
  return rows[row_index];
}

/**
 * 写回可选数组字段时就地补齐字段，保持原始 JSON 对象最小变更
 */
function ensure_array_field(record: ApiJsonRecord, field: string): ApiJsonValue[] {
  const value = record[field];
  if (Array.isArray(value)) {
    return value;
  }
  const replacement: ApiJsonValue[] = [];
  record[field] = replacement;
  return replacement;
}
