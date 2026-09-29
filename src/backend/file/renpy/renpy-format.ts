import path from "node:path";
import { AppError } from "../../../shared/error";

import { decode_text_content } from "../../../shared/utils/text-tool";
import {
  group_items,
  split_text_lines_for_items,
  write_text_file,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "../file-format-shared";
import { Item } from "../../../domain/item";
import { build_items_for_writeback, get_item_target_line } from "./compat";
import { RenpyExtractor } from "./extractor";
import { parse_document } from "./parser";
import { RenpyWriter } from "./writer";

/**
 * RenPy 翻译脚本格式门面，只编排 AST 管线和文件读写。
 */
export class RenPyFormat {
  /**
   * 构造时固定配置，确保姓名字段写回策略和导出服务一致。
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解码后按翻译块解析，抽取带原稿定位信息的条目。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const lines = split_text_lines_for_items(await decode_text_content(content));
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
        throw new AppError("file.not_found", { public_details: { file: rel_path } });
      }
      const lines = split_text_lines_for_items(await decode_text_content(original));
      const normalized_items = build_items_for_writeback(rel_path, lines, group);
      const prepared_items = normalized_items.sort(
        (left, right) => get_item_target_line(left) - get_item_target_line(right),
      );
      new RenpyWriter(this.config.write_translated_name_fields_to_file).apply_items_to_lines(
        lines,
        prepared_items,
      );
      await write_text_file(path.join(paths.translated_path, rel_path), lines.join("\n"));
    }
  }
}
