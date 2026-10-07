import type { Item } from "../../../domain/item";
import { decode_text_content } from "../../../shared/utils/text-tool";
import { split_text_lines } from "../../../shared/text/text-lines";
import type { FileFormatServiceConfig } from "../file-format-shared";
import {
  bind_subtitle_items,
  create_subtitle_items,
  needs_bilingual_text,
  read_subtitle_lines,
  read_subtitle_target,
  subtitle_error,
  type SubtitleOutput,
  type SubtitleSlot,
} from "./subtitle-text";

const LRC_TIME = "\\d{1,3}:\\d{1,2}(?:[.:]\\d{1,6})?";
const LRC_LINE_PATTERN = new RegExp(`^([ \\t]*((?:\\[${LRC_TIME}\\])+))(.*)$`, "u");
const LRC_INLINE_PATTERN = new RegExp(`\\[${LRC_TIME}\\]|<${LRC_TIME}>`, "gu");

type LRCUnit = SubtitleSlot & { prefix: string; ending: string; end: number; row: number };

/** LRC 的时间标签与非正文行留在源资产，一源行最多产生一个正文条目。 */
export class LRCFormat {
  /** 固定当前双语输出设置。 */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /** 导入先移除逐字时间，使条目正文可直接参与翻译与校对。 */
  public async read_from_stream(content: Uint8Array, file: string): Promise<Item[]> {
    const text = await decode_text_content(content);
    return create_subtitle_items(text, this.parse_text(text, file), file, "LRC");
  }

  /** 按源行位置恢复时间标签，实际换行展开为同时间标签的多行字幕。 */
  public render_text(text: string, items: readonly Item[], file: string): SubtitleOutput {
    const units = this.parse_text(text, file);
    const bound = bind_subtitle_items(units, items, file);
    const default_ending = read_subtitle_lines(text).find((line) => line.ending)?.ending ?? "\n";
    let translated = "";
    let bilingual = "";
    let cursor = 0;
    for (const unit of units) {
      const before = text.slice(cursor, unit.offset);
      translated += before;
      bilingual += before;
      const target = read_subtitle_target(unit, bound);
      if (target.search(LRC_INLINE_PATTERN) !== -1) {
        throw subtitle_error(file, unit.row, "The subtitle text contains a time tag.");
      }
      const ending = unit.ending || default_ending;
      const render = (values: readonly string[]): string =>
        values.map((value) => unit.prefix + value).join(ending) + unit.ending;
      const target_lines = split_text_lines(target);
      translated += render(target_lines);
      bilingual += render(
        needs_bilingual_text(unit.text, target, this.config.deduplication_in_bilingual)
          ? [unit.text, ...target_lines]
          : [unit.text],
      );
      cursor = unit.end;
    }
    return {
      translated: translated + text.slice(cursor),
      bilingual: bilingual + text.slice(cursor),
    };
  }

  /** 行首时间标签组拥有整行正文，前后原始内容留在源资产。 */
  private parse_text(text: string, file: string): LRCUnit[] {
    const units: LRCUnit[] = [];
    for (const line of read_subtitle_lines(text)) {
      const match = LRC_LINE_PATTERN.exec(line.text);
      if (!match) continue;
      const validate = (tag: string): void => {
        // 标签语法已由 `LRC_TIME` 匹配，只校验秒的数值范围。
        const seconds = Number(tag.slice(1, -1).split(":")[1]);
        if (seconds >= 60)
          throw subtitle_error(file, line.row, "The subtitle time tag is invalid.");
      };
      for (const tag of match[2]!.matchAll(LRC_INLINE_PATTERN)) validate(tag[0]);
      const body = match[3]!.replace(LRC_INLINE_PATTERN, (tag) => {
        validate(tag);
        return "";
      });
      units.push({
        offset: line.start,
        text: body,
        prefix: match[1]!,
        ending: line.ending,
        end: line.start + line.text.length + line.ending.length,
        row: line.row,
      });
    }
    return units;
  }
}
