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
 * ASS 字幕格式按 Events/Dialogue 文本字段解析，保留整行模板用于写回。
 */
export class ASSFormat {
  /**
   * 配置用于目标和双语输出路径，以及双语去重策略。
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 读取 Events 段 Format 列数后抽取 Dialogue 尾部文本，与旧切片逻辑一致。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const lines = split_text_lines_for_items(await TextTool.decode(content)).map((line) =>
      line.trim(),
    );
    let in_event = false;
    let format_field_num = -1;
    for (const line of lines) {
      if (line === "[Events]") {
        in_event = true;
      }
      if (in_event && line.startsWith("Format:")) {
        format_field_num = line.split(",").length - 1;
        break;
      }
    }
    return lines.map((line, index) => {
      const content_value = line.startsWith("Dialogue:")
        ? line.split(",").slice(format_field_num).join(",")
        : "";
      const extra_field = content_value === "" ? line : line.replace(content_value, "{{CONTENT}}");
      return Item.from_json({
        src: content_value.replace(/\\N/gu, "\n"),
        dst: "",
        extra_field,
        row: index,
        file_type: "ASS",
        file_path: rel_path,
      });
    });
  }

  /**
   * 写回时用 {{CONTENT}} 模板还原 ASS 行，双语输出用 \N 拼接原文和译文。
   */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "ASS")) {
      const translated = group
        .map((item) =>
          String(item.extra_field ?? "").replace(
            "{{CONTENT}}",
            effective_export_text(item).replace(/\n/gu, "\\N"),
          ),
        )
        .join("\n");
      await write_text_file(
        build_target_path(this.config, paths.translated_path, rel_path),
        translated,
      );
    }

    for (const [rel_path, group] of group_items(items, "ASS")) {
      const bilingual = group
        .map((item) => {
          const extra_field = String(item.extra_field ?? "");
          const item_dst = effective_export_text(item);
          if (this.config.deduplication_in_bilingual && item.src === item_dst) {
            return extra_field.replace("{{CONTENT}}", item_dst.replace(/\n/gu, "\\N"));
          }
          return extra_field
            .replace("{{CONTENT}}", "{{CONTENT}}\\N{{CONTENT}}")
            .replace("{{CONTENT}}", item.src.replace(/\n/gu, "\\N"))
            .replace("{{CONTENT}}", item_dst.replace(/\n/gu, "\\N"));
        })
        .join("\n");
      await write_text_file(
        build_bilingual_path(this.config, paths.bilingual_path, rel_path),
        bilingual,
      );
    }
  }
}
