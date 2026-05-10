import { JsonTool } from "../../../utils/json-tool";
import { TextTool } from "../../../utils/text-tool";
import {
  effective_export_text,
  group_items,
  write_text_file,
  type ExportPaths,
} from "./file-format-shared";
import { normalize_file_item, type FileFormatItem } from "../file-item";

/**
 * 键值 JSON 格式把 key 作为原文，value 作为已有译文。
 */
export class KVJSONFormat {
  /**
   * 读取对象型 JSON，非字符串键值对不进入翻译条目。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<FileFormatItem[]> {
    const data = await this.parse_json_with_encoding(content);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return [];
    }
    const items: FileFormatItem[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof key !== "string" || typeof value !== "string") {
        continue;
      }
      const dst = value === key ? "" : value;
      items.push(
        normalize_file_item({
          src: key,
          dst,
          row: items.length,
          file_type: "KVJSON",
          file_path: rel_path,
          status: key === "" ? "EXCLUDED" : dst !== "" && dst !== key ? "PROCESSED" : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * 写回时重新生成 key -> 有效译文 的对象，保持 Py 侧四空格缩进。
   */
  public async write_to_path(items: FileFormatItem[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "KVJSON")) {
      const data = Object.fromEntries(group.map((item) => [item.src, effective_export_text(item)]));
      await write_text_file(
        `${paths.translated_path}/${rel_path}`,
        JsonTool.stringifyStrict(data, { indent: 4 }),
      );
    }
  }

  /**
   * JSON 先按 UTF-8 严格解析，失败时再走编码探测兼容旧资源文件。
   */
  private async parse_json_with_encoding(content: Uint8Array): Promise<unknown> {
    try {
      return JsonTool.parseStrict(content);
    } catch {
      return JsonTool.parseStrict(await TextTool.decode(content));
    }
  }
}
