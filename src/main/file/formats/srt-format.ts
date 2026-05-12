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
 * SRT 格式以字幕块为单位解析，序号和时间轴放入 row/extra_field。
 */
export class SRTFormat {
  /**
   * 配置用于输出路径和双语去重策略。
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解析时按空行切块，只接受「序号 + 时间轴 + 正文」结构。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const items: Item[] = [];
    let chunk: string[] = [];
    const process_chunk = (): void => {
      if (chunk.length < 3 || !/^\d+$/u.test(chunk[0] ?? "")) {
        return;
      }
      items.push(
        Item.from_json({
          src: chunk.slice(2).join("\n"),
          dst: "",
          extra_field: chunk[1] ?? "",
          row: Number(chunk[0] ?? 0),
          file_type: "SRT",
          file_path: rel_path,
        }),
      );
    };
    for (const line of split_text_lines_for_items(await TextTool.decode(content))) {
      const stripped = line.trim();
      if (stripped === "") {
        if (chunk.length > 0) {
          process_chunk();
          chunk = [];
        }
      } else {
        chunk.push(stripped);
      }
    }
    if (chunk.length > 0) {
      process_chunk();
    }
    return items;
  }

  /**
   * 写回时重新生成 SRT 块，保持序号、时间轴和空行分隔。
   */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "SRT")) {
      let translated = "";
      let bilingual = "";
      for (const item of group) {
        const row = String(item.row);
        const time_code = String(item.extra_field ?? "");
        const item_dst = effective_export_text(item);
        translated += `${row}\n${time_code}\n${item_dst}\n\n`;
        const content =
          this.config.deduplication_in_bilingual && item.src === item_dst
            ? item_dst
            : `${item.src}\n${item_dst}`;
        bilingual += `${row}\n${time_code}\n${content}\n\n`;
      }
      await write_text_file(
        build_target_path(this.config, paths.translated_path, rel_path),
        translated,
      );
      await write_text_file(
        build_bilingual_path(this.config, paths.bilingual_path, rel_path),
        bilingual,
      );
    }
  }
}
