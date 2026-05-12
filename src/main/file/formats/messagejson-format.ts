import path from "node:path";

import { JsonTool } from "../../../shared/utils/json-tool";
import { TextTool } from "../../../shared/utils/text-tool";
import type { ApiJsonValue } from "../../api/api-types";
import {
  effective_export_text,
  group_items,
  prepare_name_fields,
  write_text_file,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "./file-format-shared";
import { Item, read_json_record } from "../../../base/item";

/**
 * message JSON 格式用于 KAG 风格 name/message 数组结构
 */
export class MESSAGEJSONFormat {
  /**
   * 配置决定人名字段写回策略
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 只解析数组内含 message 字符串的对象，name/names 作为角色名字段保存
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const data = await this.parse_json_with_encoding(content);
    if (!Array.isArray(data)) {
      return [];
    }
    const items: Item[] = [];
    for (const entry of data) {
      const record = read_json_record(entry);
      if (typeof record["message"] !== "string") {
        continue;
      }
      const names = Array.isArray(record["names"])
        ? record["names"].filter((value): value is string => typeof value === "string")
        : undefined;
      const name = typeof record["name"] === "string" ? record["name"] : names;
      items.push(
        Item.from_json({
          src: record["message"],
          dst: "",
          name_src: name,
          name_dst: name,
          row: items.length,
          file_type: "MESSAGEJSON",
          file_path: rel_path,
          text_type: "KAG",
        }),
      );
    }
    return items;
  }

  /**
   * 写回时按配置整理 name_dst，多数译名会被用于同名角色
   */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "MESSAGEJSON")) {
      const normalized = prepare_name_fields(group, this.config);
      const data = normalized
        .sort((left, right) => left.row - right.row)
        .map((item) => {
          const message = effective_export_text(item);
          const name = Item.normalize_name(item.name_dst);
          if (typeof name === "string") {
            return { name, message };
          }
          if (Array.isArray(name)) {
            return { names: name, message };
          }
          return { message };
        });
      await write_text_file(
        path.join(paths.translated_path, rel_path),
        JsonTool.stringifyStrict(data as unknown as ApiJsonValue, { indent: 4 }),
      );
    }
  }

  /**
   * JSON 先按 UTF-8 严格解析，失败时再走编码探测兼容旧资源文件
   */
  private async parse_json_with_encoding(content: Uint8Array): Promise<unknown> {
    try {
      return JsonTool.parseStrict(content);
    } catch {
      return JsonTool.parseStrict(await TextTool.decode(content));
    }
  }
}
