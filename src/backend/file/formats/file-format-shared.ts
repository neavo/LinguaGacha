import { default_native_fs, normalize_native_file_bytes } from "../../../native/native-fs";
import { Item, type ItemFileType } from "../../../domain/item";

/**
 * 文件格式处理器共享配置，来源于应用设置或测试显式注入
 */
export interface FileFormatServiceConfig {
  target_language: string; // 决定 EPUB 阅读排版等目标语言写回策略
  deduplication_in_bilingual?: boolean; // 原译文相同时双语文件只写一份
  write_translated_name_fields_to_file?: boolean; // 姓名字段是否使用译名写回
}

/**
 * 新建工程预演阶段保存源文件绝对路径与工程内相对路径的映射
 */
export interface ProjectSourceFileEntry {
  source_path: string; // 用户选择或目录扫描得到的真实文件路径
  rel_path: string; // 导入工程后的稳定资产路径
}

/**
 * 导出目录成对出现：译文目录和双语对照目录必须由同一规则生成
 */
export interface ExportPaths {
  translated_path: string; // 单语译文根目录
  bilingual_path: string; // 双语对照根目录
}

const EPUB_READING_LAYOUT_TARGET_LANGUAGES = new Set(["JA", "ZH-HANT"]); // 日文与繁中导出保留原 EPUB 翻页方向和竖排信息
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
 * EPUB 阅读排版保留策略只由目标语言决定，避免 AST 与 legacy 写回分支各自判断
 */
export function should_preserve_epub_reading_layout(target_language: string): boolean {
  return EPUB_READING_LAYOUT_TARGET_LANGUAGES.has(target_language.trim().toUpperCase());
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
