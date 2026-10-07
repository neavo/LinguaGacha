import { read_translation_for_generation } from "../translation-generation-text";

import { decode_text_content } from "../../../shared/utils/text-tool";
import { split_text_lines_for_items, type FileFormatServiceConfig } from "../file-format-shared";
import { Item } from "../../../domain/item";
import { AppError } from "../../../shared/error";
import { split_text_lines } from "../../../shared/text/text-lines";
import { needs_bilingual_text, type SubtitleOutput } from "./subtitle-text";

/**
 * SRT 格式以字幕块为单位解析，序号和时间轴放入 row/extra_field
 * 单值类的正文生效规则见 `read_translation_for_generation()`。
 */
export class SRTFormat {
  /**
   * 配置决定原译文相同时的双语去重策略
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 解析时按空行切块，只接受「序号 + 时间轴 + 正文」结构
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
    for (const line of split_text_lines_for_items(await decode_text_content(content))) {
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
   * 写回时重新生成 SRT 块，保持序号、时间轴和空行分隔
   */
  public render_text(text: string, items: readonly Item[], file: string): SubtitleOutput {
    if (items.length === 0) return { translated: text, bilingual: text };
    let translated = "";
    let bilingual = "";
    let translated_row = 0; // 单语序号只计实际输出的字幕块。
    for (const item of items) {
      const row = String(item.row);
      const time_code = String(item.extra_field ?? "");
      const item_dst = read_translation_for_generation(item) ?? item.src;
      // 空正文省略单语字幕块，输出序号连续；双语版仍保留原文和原时间轴。
      const content = needs_bilingual_text(
        item.src,
        item_dst,
        this.config.deduplication_in_bilingual,
      )
        ? `${item.src}\n${item_dst}`
        : item.src;
      // 尾部换行属于块间分隔，正文内部的空行会截断当前字幕。
      for (const body of [item_dst, content]) {
        const lines = split_text_lines(body.trimEnd());
        if (body.trim() !== "" && lines.some((line) => line.trim() === ""))
          throw new AppError("file.invalid_structure", {
            message: `${file}: subtitle ${item.row}: The text contains an empty line.`,
            public_details: { file, subtitle: item.row },
          });
      }
      if (item_dst.trim() !== "")
        translated += `${++translated_row}\n${time_code}\n${item_dst}\n\n`;
      bilingual += `${row}\n${time_code}\n${content}\n\n`;
    }
    return { translated, bilingual };
  }
}
