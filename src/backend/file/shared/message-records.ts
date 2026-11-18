import type { Item } from "../../../domain/item";
import type { JsonRecord } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_translation_for_generation } from "./translation-generation-text";

/** 工程条目的行号和原文必须匹配原稿，同一行只接纳一条译文。 */
export function index_message_items(
  messages: readonly { message: string }[],
  items: readonly Item[],
  rel_path: string,
) {
  const byRow = new Map<number, Item>();
  for (const item of items) {
    const record = messages[item.row];
    if (!record) throw invalid_structure(rel_path, "message_row_not_found", item.row);
    if (byRow.has(item.row)) throw invalid_structure(rel_path, "duplicate_message_row", item.row);
    if (record.message !== item.src)
      throw invalid_structure(rel_path, "message_source_mismatch", item.row);
    byRow.set(item.row, item);
  }
  return byRow;
}

/** 消费已对齐条目的译文与译名。 */
export function write_message_records(
  messages: (JsonRecord & { message: string })[],
  items: readonly Item[],
  rel_path: string,
  allow_names_array = false, // 仅 MESSAGEJSON 解释 `names`，通用记录的同名字段属于私有数据。
): void {
  for (const [row, item] of index_message_items(messages, items, rel_path)) {
    const record = messages[row]!;
    record.message = read_translation_for_generation(item) ?? item.src;
    // 姓名独立于正文状态。双字段沿用 `name` 优先规则。
    if (!item.name_dst) continue; // 空译名保留源姓名结构。
    if (!allow_names_array || typeof record.name === "string" || !Array.isArray(record.names)) {
      record.name = item.name_dst;
    } else {
      const slot = record.names.findIndex((value) => typeof value === "string");
      if (slot < 0) record.names.unshift(item.name_dst);
      else record.names[slot] = item.name_dst;
    }
  }
}

/** 公开错误定位到文件，具体错位原因留给诊断日志。 */
function invalid_structure(file: string, reason: string, row: number): AppError {
  return new AppError("file.invalid_structure", {
    public_details: { file },
    diagnostic_context: { reason, row },
  });
}
