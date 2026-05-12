import { TextTool } from "../../../shared/utils/text-tool";
import {
  effective_export_text,
  build_bilingual_path,
  build_target_path,
  group_items,
  split_text_lines_for_items,
  write_text_file,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "./file-format-shared";
import { Item } from "../../../base/item";

/**
 * TXT 格式按行解析与写回，保持旧实现最朴素的一行一条规则
 */
export class TXTFormat {
  /**
   * 配置只用于导出路径和双语去重，不参与 TXT 解析
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解析时保留原始行号，空行也作为可被排除或处理的普通条目
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const text = await TextTool.decode(content);
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
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "TXT")) {
      await write_text_file(
        build_target_path(this.config, paths.translated_path, rel_path),
        group.map(effective_export_text).join("\n"),
      );
    }

    for (const [rel_path, group] of group_items(items, "TXT")) {
      const bilingual = group
        .map((item) => {
          const item_dst = effective_export_text(item);
          return this.config.deduplication_in_bilingual && item.src === item_dst
            ? item_dst
            : `${item.src}\n${item_dst}`;
        })
        .join("\n");
      await write_text_file(
        build_bilingual_path(this.config, paths.bilingual_path, rel_path),
        bilingual,
      );
    }
  }
}
