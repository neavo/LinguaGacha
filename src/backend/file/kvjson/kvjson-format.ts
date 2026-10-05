import type { JsonValue } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_translation_for_generation } from "../translation-generation-text";
import { JsonTool } from "../../../shared/utils/json-tool";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { group_items, write_text_file, type GeneratedFilePaths } from "../file-format-shared";
import { Item } from "../../../domain/item";

/**
 * 键值 JSON 格式把 key 作为原文，value 作为已有译文
 */
export class KVJSONFormat {
  /**
   * 读取对象型 JSON，非字符串键值对不进入翻译条目
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const data = JsonTool.parseStrict(await decode_text_content(content));
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return [];
    }
    const items: Item[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "string") {
        continue;
      }
      const dst = value;
      items.push(
        Item.from_json({
          src: key,
          dst,
          row: items.length,
          file_type: "KVJSON",
          file_path: rel_path,
          status: key === "" ? "RULE_SKIPPED" : dst !== "" && dst !== key ? "PROCESSED" : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * 基于原对象写回，保留其它字段并按带回退 KV 规则选择译文
   */
  public async write_to_path(
    items: Item[],
    paths: GeneratedFilePaths,
    asset_reader: (path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "KVJSON")) {
      const original = asset_reader(rel_path);
      if (original === null)
        throw new AppError("file.not_found", { public_details: { file: rel_path } });
      const data: unknown = JsonTool.parseStrict(await decode_text_content(original));
      if (typeof data !== "object" || data === null || Array.isArray(data))
        throw new AppError("file.invalid_structure", { public_details: { file: rel_path } });
      const record = data as Record<string, unknown>;
      // 带回退 KV：读取源资产原值，不能用工程当前 dst 作为未完成条目的回退基线。
      for (const item of group) {
        const source = Object.hasOwn(record, item.src) ? record[item.src] : undefined;
        if (typeof source !== "string")
          throw new AppError("file.invalid_structure", { public_details: { file: rel_path } });
        record[item.src] =
          read_translation_for_generation(item) ?? (source !== "" ? source : item.src);
      }
      await write_text_file(
        `${paths.translated_path}/${rel_path}`,
        JsonTool.stringifyStrict(data as JsonValue, { indent: 4 }),
      );
    }
  }
}
