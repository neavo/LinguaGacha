import type { Item } from "../../../domain/item";
import type { JsonRecord } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_translation_for_generation } from "./translation-generation-text";

/** 两种记录格式共享坐标校验与译文取值，调用方持有各自的读取契约。 */
export function write_message_records(
  messages: (JsonRecord & { message: string })[],
  items: readonly Item[],
  rel_path: string,
  allow_names_array = false, // 仅 MESSAGEJSON 解释 `names`，通用记录的同名字段属于私有数据。
): void {
  const written = new Set<number>(); // 每个源对象只接纳一条译文，避免后写覆盖前写。
  for (const item of items) {
    const record = messages[item.row];
    if (!record) throw invalid_structure(rel_path, "message_row_not_found", item.row);
    if (written.has(item.row)) throw invalid_structure(rel_path, "duplicate_message_row", item.row);
    if (record.message !== item.src)
      throw invalid_structure(rel_path, "message_source_mismatch", item.row);
    written.add(item.row);
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
