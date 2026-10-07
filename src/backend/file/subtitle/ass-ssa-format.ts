import { Item } from "../../../domain/item";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { split_text_lines_for_items, type FileFormatServiceConfig } from "../file-format-shared";
import { read_translation_for_generation } from "../translation-generation-text";
import {
  needs_bilingual_text,
  read_subtitle_lines,
  subtitle_error,
  type SubtitleLine,
  type SubtitleOutput,
} from "./subtitle-text";

const ASS_STANDARD_FIELD_COUNT = 10;
const ASS_STANDARD_TIME_PATTERN = /^\d+:\d{2}:\d{2}\.\d{2}$/u;
type ASSUnit = {
  line: SubtitleLine;
  row: number; // 既有分行口径中的位置，兼容旧条目的 Unicode 行边界
  prefix: string;
  text: string;
};

/** ASS／SSA 共用 `Events` 解析，旧条目通过既有分行位置定位原始资产。 */
export class ASSFormat {
  /** 固定当前双语输出设置。 */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /** 从末列 `Text` 提取正文，保留既有的整行正文条目契约。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    const text = await decode_text_content(content);
    return this.parse_text(text, file).map((unit) =>
      Item.from_json({
        src: unit.text,
        row: unit.row,
        file_type: "ASS",
        file_path: file,
      }),
    );
  }

  /** 在原始行的正文边界写入当前结果，其余段落和字段使用源内容。 */
  public render_text(text: string, items: readonly Item[], file: string): SubtitleOutput {
    const units = this.parse_text(text, file);
    // `row` 沿用历史分行口径，字段边界和行结束符由原始资产提供。
    const by_row = new Map(items.map((item) => [item.row, item]));
    let translated = "";
    let bilingual = "";
    let cursor = 0;
    for (const unit of units) {
      const item = by_row.get(unit.row);
      const source = item?.src ?? unit.text;
      const target = item ? (read_translation_for_generation(item) ?? source) : source;
      const before = text.slice(cursor, unit.line.start);
      const render = (body: string): string =>
        unit.prefix + body.replace(/\r\n|\r|\n/gu, "\\N") + unit.line.ending;
      translated += before + render(target);
      bilingual +=
        before +
        render(
          needs_bilingual_text(source, target, this.config.deduplication_in_bilingual)
            ? `${source}\n${target}`
            : source,
        );
      cursor = unit.line.start + unit.line.text.length + unit.line.ending.length;
    }
    return {
      translated: translated + text.slice(cursor),
      bilingual: bilingual + text.slice(cursor),
    };
  }

  /** 跟踪当前段落的字段声明，正文中的逗号归最后一列。 */
  private parse_text(text: string, file: string): ASSUnit[] {
    const units: ASSUnit[] = [];
    let in_events = false;
    let field_count: number | null = null; // 当前 `Events` 段的列数，空值使用标准布局
    let row = 0; // 历史分行计数与当前物理行扫描分别维护
    for (const line of read_subtitle_lines(text)) {
      const item_row = row;
      row += split_text_lines_for_items(line.text + line.ending).length;
      const section = /^\s*\[([^\]]+)\]\s*$/u.exec(line.text);
      if (section) {
        in_events = section[1]!.toLowerCase() === "events";
        field_count = null;
        continue;
      }
      if (!in_events) continue;
      const format = /^\s*Format:\s*(.*)$/iu.exec(line.text);
      if (format) {
        const fields = format[1]!.split(",").map((field) => field.trim().toLowerCase());
        if (
          fields.at(-1) !== "text" ||
          fields.filter((field) => field === "text").length !== 1 ||
          fields.some((field) => field === "")
        )
          throw subtitle_error(file, line.row, "The ASS Text field must be the last field.");
        field_count = fields.length;
        continue;
      }
      const dialogue = /^\s*Dialogue:\s*/iu.exec(line.text);
      if (!dialogue) continue;
      if (field_count === null) {
        const fields = line.text.slice(dialogue[0].length).split(",");
        if (
          fields.length < ASS_STANDARD_FIELD_COUNT ||
          !/^(?:\d+|Marked=\d+)$/iu.test(fields[0]!.trim()) ||
          !ASS_STANDARD_TIME_PATTERN.test(fields[1]!.trim()) ||
          !ASS_STANDARD_TIME_PATTERN.test(fields[2]!.trim())
        )
          throw subtitle_error(file, line.row, "The ASS standard field layout is not recognized.");
      }
      let body_start = dialogue[0].length; // 逐字段推进的正文起点，避开同值字段和模板字面量
      for (let field = 1; field < (field_count ?? ASS_STANDARD_FIELD_COUNT); field++) {
        const comma = line.text.indexOf(",", body_start);
        if (comma < 0) throw subtitle_error(file, line.row, "The ASS event has missing fields.");
        body_start = comma + 1;
      }
      units.push({
        line,
        row: item_row,
        prefix: line.text.slice(0, body_start),
        text: line.text.slice(body_start).replace(/\\N/gu, "\n"),
      });
    }
    return units;
  }
}
