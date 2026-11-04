import { type Item, create_item } from "../../../domain/item";
import { is_json_record, type JsonRecord, type JsonValue } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { JsonTool } from "../../../shared/utils/json-tool";
import { write_message_records } from "../shared/message-records";

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
    if (!Array.isArray(data))
      throw new AppError("file.invalid_structure", {
        public_details: { file: rel_path },
        diagnostic_context: { reason: "expected_message_array" },
      });
    const messages = read_messages(data);
    write_message_records(messages, items, rel_path, true);
    return JsonTool.stringifyStrict(data, { indent: 4 });
  }
}
