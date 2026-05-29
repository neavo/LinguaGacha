import { decode_text_content } from "../../../shared/utils/text-tool";
import {
  effective_export_text,
  build_target_path,
  group_items,
  split_text_lines_for_items,
  write_text_file,
  type ExportPaths,
  type FileFormatServiceConfig,
} from "./file-format-shared";
import { Item } from "../../../domain/item";

const IMAGE_PATTERN = /!\[.*?\]\(.*?\)/u; // 旧实现会直接排除 Markdown 图片行，避免把资源引用送进翻译

/**
 * Markdown 格式按行处理，并排除图片和代码块内容
 */
export class MDFormat {
  /**
   * 配置用于输出文件名语言后缀
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解析时用围栏状态标记代码块，维持旧实现对整行 Markdown 的处理方式
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const items: Item[] = [];
    let in_code_block = false;
    for (const line of split_text_lines_for_items(await decode_text_content(content))) {
      if (line.trim().startsWith("```")) {
        in_code_block = !in_code_block;
      }
      items.push(
        Item.from_json({
          src: line,
          dst: "",
          row: items.length,
          file_type: "MD",
          file_path: rel_path,
          text_type: "MD",
          status: IMAGE_PATTERN.test(line) || in_code_block ? "EXCLUDED" : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * Markdown 只写单语译文文件，行序由解析 row 自然保持
   */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "MD")) {
      await write_text_file(
        build_target_path(this.config, paths.translated_path, rel_path),
        group.map(effective_export_text).join("\n"),
      );
    }
  }
}
