import { default_native_fs, normalize_native_file_bytes } from "../../../native/native-fs";
import type { Item, ItemFileType } from "../../../domain/item";

const SPLITLINES_CODE_POINTS = new Set([
  0x000a, 0x000b, 0x000c, 0x000d, 0x001c, 0x001d, 0x001e, 0x0085, 0x2028, 0x2029,
]); // Python splitlines 识别的全部单码点行边界；CRLF 在扫描时合并

/**
 * 模拟历史 splitlines 行为，但保留每一行作为独立翻译条目
 */
export function split_text_lines_for_items(text: string): string[] {
  const lines: string[] = [];
  let line_start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code_point = text.charCodeAt(index);
    if (!SPLITLINES_CODE_POINTS.has(code_point)) continue;
    lines.push(text.slice(line_start, index));
    if (code_point === 0x000d && text.charCodeAt(index + 1) === 0x000a) index += 1;
    line_start = index + 1;
  }
  if (line_start < text.length) lines.push(text.slice(line_start));
  return lines;
}

/**
 * 写文本文件前统一创建目录，格式处理器只关心内容生成
 */
export async function write_text_file(file_path: string, content: string): Promise<void> {
  await default_native_fs.write_file(file_path, content);
}

/**
 * 写二进制文件前统一创建目录，并在边界收窄第三方库返回的 bytes。
 */
export async function write_binary_file(file_path: string, content: unknown): Promise<void> {
  await default_native_fs.write_file(file_path, normalize_native_file_bytes(content));
}

/**
 * 按原始文件路径分组，写回时每个物理文件独立处理
 */
export function group_items(items: Item[], file_type: ItemFileType): Map<string, Item[]> {
  const group = new Map<string, Item[]>();
  for (const item of items.filter((candidate) => candidate.file_type === file_type)) {
    const bucket = group.get(item.file_path) ?? [];
    bucket.push(item);
    group.set(item.file_path, bucket);
  }
  return group;
}
