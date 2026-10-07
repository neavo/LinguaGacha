import { Item, type ItemFileType } from "../../../domain/item";
import { read_json_record } from "../../../domain/json";
import { AppError } from "../../../shared/error";
import { read_translation_for_generation } from "../translation-generation-text";

export type SubtitleLine = {
  text: string;
  ending: string; // 原始行结束符
  start: number; // 解码文本中的 UTF-16 偏移
  row: number; // 从零开始的物理行号
};
export type SubtitleSlot = {
  offset: number; // 解码文本中的 UTF-16 偏移，导入和写回使用同一坐标
  text: string;
};
export type SubtitleOutput = { translated: string; bilingual: string };

/** 保留物理行与原始结束符，源位置在导入和导出使用同一解码文本。 */
export function read_subtitle_lines(text: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    if (match[0] === "") continue;
    lines.push({ text: match[1]!, ending: match[2]!, start: match.index, row: lines.length });
  }
  return lines;
}

/** 将内部行号转为可见行号，格式解析与导出共用故障定位。 */
export function subtitle_error(file: string, row: number, reason: string): AppError {
  return new AppError("file.invalid_structure", {
    message: `${file}:${row + 1}: ${reason}`,
    public_details: { file, line: row + 1 },
  });
}

/** 槽位按源位置排列，每个非空正文条目保存位置引用。 */
export function create_subtitle_items(
  text: string,
  slots: readonly SubtitleSlot[],
  file: string,
  file_type: ItemFileType,
): Item[] {
  const lines = read_subtitle_lines(text);
  let row = 0;
  return slots
    .filter((slot) => slot.text.trim() !== "")
    .map((slot) => {
      while (row + 1 < lines.length && lines[row + 1]!.start <= slot.offset) row++;
      return Item.from_json({
        src: slot.text,
        row,
        file_path: file,
        file_type,
        extra_field: { subtitle: { offset: slot.offset } },
      });
    });
}

/** 校验引用与源正文，再建立槽位到当前条目的对应关系。 */
export function bind_subtitle_items(
  slots: readonly SubtitleSlot[],
  items: readonly Item[],
  file: string,
): Map<number, Item> {
  const source = new Map(slots.map((slot) => [slot.offset, slot.text]));
  const result = new Map<number, Item>();
  for (const item of items) {
    const offset = read_json_record(read_json_record(item.extra_field)["subtitle"])["offset"];
    if (typeof offset !== "number" || source.get(offset) !== item.src || result.has(offset))
      throw subtitle_error(file, item.row, "The subtitle text position does not match the source.");
    result.set(offset, item);
  }
  return result;
}

/** 完成状态使用当前译文，其余槽位沿用源正文。 */
export function read_subtitle_target(slot: SubtitleSlot, items: ReadonlyMap<number, Item>): string {
  const item = items.get(slot.offset);
  return item ? (read_translation_for_generation(item) ?? item.src) : slot.text;
}

/** 非空目标正文按双语去重设置决定是否追加。 */
export function needs_bilingual_text(
  source: string,
  target: string,
  deduplicate?: boolean,
): boolean {
  return target.trim() !== "" && !(deduplicate && source === target);
}
