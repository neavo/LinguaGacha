import path from "node:path";

import { decode_text_content } from "../../../../shared/utils/text-tool";
import {
  group_items,
  prepare_name_fields,
  split_text_lines_for_items,
  write_text_file,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "../file-format-shared";
import { Item } from "../../../../domain/item";
import { normalize_setting_snapshot } from "../../../../domain/setting";
import { build_items_for_writeback, get_item_target_line } from "./compat";
import { RenpyExtractor } from "./extractor";
import { parse_document } from "./parser";
import { RenpyWriter } from "./writer";

/**
 * 直接构造 RenPyFormat 的测试默认开启姓名写回，FileFormatService 会注入真实配置。
 */
const DEFAULT_SETTING_SNAPSHOT = normalize_setting_snapshot({});
const DEFAULT_CONFIG: FileFormatServiceConfig = {
  source_language: DEFAULT_SETTING_SNAPSHOT.source_language,
  target_language: DEFAULT_SETTING_SNAPSHOT.target_language,
  write_translated_name_fields_to_file:
    DEFAULT_SETTING_SNAPSHOT.write_translated_name_fields_to_file,
};

/**
 * RenPy 翻译脚本格式门面，只编排 AST 管线和文件读写。
 */
export class RenPyFormat {
  /**
   * 构造时固定配置，确保姓名字段写回策略和导出服务一致。
   */
  public constructor(private readonly config: FileFormatServiceConfig = DEFAULT_CONFIG) {}

  /**
   * 文件流入口只负责解码，实际解析拆到 parse_text 便于测试复用。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    return this.parse_text(rel_path, await decode_text_content(content));
  }

  /**
   * 文本解析走解析器到抽取器链路，RenPyFormat 不再持有正则匹配细节。
   */
  public parse_text(rel_path: string, text: string): Item[] {
    const lines = split_text_lines_for_items(text);
    return new RenpyExtractor().extract(parse_document(lines), rel_path);
  }

  /**
   * 写回时先将历史条目归一为当前 AST 条目，再交给槽位感知写回器。
   */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "RENPY")) {
      const original = asset_reader(rel_path);
      if (original === null) {
        continue;
      }
      const lines = split_text_lines_for_items(await decode_text_content(original));
      const normalized_items = build_items_for_writeback(rel_path, lines, group);
      const prepared_items = prepare_name_fields(normalized_items, this.config).sort(
        (left, right) => get_item_target_line(left) - get_item_target_line(right),
      );
      new RenpyWriter().apply_items_to_lines(lines, prepared_items);
      await write_text_file(path.join(paths.translated_path, rel_path), lines.join("\n"));
    }
  }
}
