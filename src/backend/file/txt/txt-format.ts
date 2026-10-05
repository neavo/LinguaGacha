import { read_translation_for_generation } from "../translation-generation-text";
import path from "node:path";

import { decode_text_content } from "../../../shared/utils/text-tool";
import {
  group_items,
  split_text_lines_for_items,
  write_text_file,
  type GeneratedFilePaths,
  type FileFormatServiceConfig,
} from "../file-format-shared";
import { Item } from "../../../domain/item";

/**
 * TXT 格式按行解析与写回，保持旧实现最朴素的一行一条规则
 * 单值类的正文生效规则见 `read_translation_for_generation()`。
 */
export class TXTFormat {
  /**
   * 配置决定原译文相同时的双语去重策略
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解析时保留原始行号，空行也作为可被排除或处理的普通条目
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const text = await decode_text_content(content);
    return split_text_lines_for_items(text).map((line, index) =>
      Item.from_json({
        src: line,
        dst: "",
        row: index,
        file_type: "TXT",
        file_path: rel_path,
      }),
    );
  }

  /**
   * 写出译文和双语文件，双语去重口径由共享配置控制
   */
  public async write_to_path(items: Item[], paths: GeneratedFilePaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "TXT")) {
      await write_text_file(
        path.join(paths.translated_path, rel_path),
        group.map((item) => read_translation_for_generation(item) ?? item.src).join("\n"),
      );
      const bilingual = group
        .map((item) => {
          const item_dst = read_translation_for_generation(item) ?? item.src;
          return this.config.deduplication_in_bilingual && item.src === item_dst
            ? item_dst
            : item_dst === ""
              ? item.src
              : `${item.src}\n${item_dst}`;
        })
        .join("\n");
      await write_text_file(path.join(paths.bilingual_path, rel_path), bilingual);
    }
  }
}
