import { type Item, create_item } from "../../../domain/item";
import { is_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { read_translation_for_generation } from "../shared/translation-generation-text";

type MessageRecord = JsonRecord & { message: string };

// `row` 始终是有效台词序号，导入与写回复用筛选规则以兼容已保存的条目。
function read_messages(data: JsonValue): MessageRecord[] {
  return Array.isArray(data)
    ? data.filter(
        (entry): entry is MessageRecord =>
          is_json_record(entry) && typeof entry.message === "string",
      )
    : [];
}

/** MESSAGEJSON 只把当前姓名和正文交给业务层，源资产拥有格式附加信息。 */
export class MESSAGEJSONFormat {
  /** `name` 优先于 `names`，后者只提取第一个字符串作为当前姓名。 */
  public read_items(data: JsonValue, rel_path: string): Item[] {
    return read_messages(data).map((record, row) =>
      create_item({
        src: record.message,
        name_src:
          typeof record.name === "string"
            ? record.name
            : Array.isArray(record.names)
              ? (record.names.find((value) => typeof value === "string") ?? null)
              : null,
        row,
        file_type: "MESSAGEJSON",
        file_path: rel_path,
      }),
    );
  }

  /** 完整生成并验证当前文件后，由文件服务负责落盘。 */
  public render_text(text: string, items: readonly Item[], rel_path: string): string {
    const data = JsonTool.parseStrict<JsonValue>(text);
    if (!Array.isArray(data)) throw invalid_structure(rel_path, "expected_message_array");
    const messages = read_messages(data);
    const written = new Set<number>(); // 每个源对象只接纳一条译文，避免后写覆盖前写。
    for (const item of items) {
      if (!Number.isInteger(item.row) || item.row < 0)
        throw invalid_structure(rel_path, "invalid_message_row", item.row);
      const record = messages[item.row];
      if (!record) throw invalid_structure(rel_path, "message_row_not_found", item.row);
      if (written.has(item.row))
        throw invalid_structure(rel_path, "duplicate_message_row", item.row);
      if (record.message !== item.src)
        throw invalid_structure(rel_path, "message_source_mismatch", item.row);
      written.add(item.row);
      record.message = read_translation_for_generation(item) ?? item.src;
      // 姓名独立于正文状态。双字段沿用 `name` 优先规则。
      if (!item.name_dst) continue; // 空译名保留源姓名结构。
      if (typeof record.name === "string" || !Array.isArray(record.names)) {
        record.name = item.name_dst;
      } else {
        const slot = record.names.findIndex((value) => typeof value === "string");
        if (slot < 0) record.names.unshift(item.name_dst);
        else record.names[slot] = item.name_dst;
      }
    }
    return JsonTool.stringifyStrict(data, { indent: 4 });
  }
}

/** 公开错误定位到文件，具体错位原因留给诊断日志。 */
function invalid_structure(file: string, reason: string, row?: number): AppError {
  return new AppError("file.invalid_structure", {
    public_details: { file },
    diagnostic_context: { reason, row },
  });
}
