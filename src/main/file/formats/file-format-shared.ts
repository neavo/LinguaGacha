import fs from "node:fs";
import path from "node:path";

import type { ApiJsonValue } from "../../api/api-types";
import { Item, type ItemFileType } from "../../../base/item";

/**
 * 文件格式处理器共享配置，来源于应用设置或测试显式注入
 */
export interface FileFormatServiceConfig {
  source_language: string;
  target_language: string;
  app_language?: string;
  deduplication_in_bilingual?: boolean;
  write_translated_name_fields_to_file?: boolean;
}

/**
 * 工作台单文件预演返回的格式化结果，供 API 层直接包成 JSON
 */
export interface ParsedFilePreview {
  target_rel_path: string;
  file_type: ItemFileType;
  parsed_items: Record<string, ApiJsonValue>[];
}

/**
 * 新建工程预演阶段保存源文件绝对路径与工程内相对路径的映射
 */
export interface ProjectSourceFileEntry {
  source_path: string;
  rel_path: string;
}

/**
 * 导出目录成对出现：译文目录和双语对照目录必须由同一规则生成
 */
export interface ExportPaths {
  translated_path: string;
  bilingual_path: string;
}

const EPUB_READING_LAYOUT_TARGET_LANGUAGES = new Set(["JA", "ZH-HANT"]); // 日文与繁中导出保留原 EPUB 翻页方向和竖排信息

/**
 * 模拟历史 splitlines 行为，但保留每一行作为独立翻译条目
 */
export function split_text_lines_for_items(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/u);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/**
 * EPUB 阅读排版保留策略只由目标语言决定，避免 AST 与 legacy 写回分支各自判断
 */
export function should_preserve_epub_reading_layout(target_language: string): boolean {
  return EPUB_READING_LAYOUT_TARGET_LANGUAGES.has(target_language.trim().toUpperCase());
}

/**
 * 构造单语译文输出路径，文件名沿用源文件相对路径
 */
export function build_target_path(
  _config: FileFormatServiceConfig,
  base_path: string,
  rel_path: string,
): string {
  return path.join(base_path, rel_path);
}

/**
 * 构造双语对照输出路径，双语目录已经表达输出语义，文件名沿用源文件相对路径
 */
export function build_bilingual_path(base_path: string, rel_path: string): string {
  return path.join(base_path, rel_path);
}

/**
 * 写文本文件前统一创建目录，格式处理器只关心内容生成
 */
export async function write_text_file(file_path: string, content: string): Promise<void> {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  await fs.promises.writeFile(file_path, content, "utf-8");
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

/**
 * 统计同一 name_src 的多数 name_dst，保持人名字段写回稳定
 */
export function prepare_name_fields(items: Item[], config: FileFormatServiceConfig): Item[] {
  const cloned = items.map((item) => Item.from_json(item));
  if (config.write_translated_name_fields_to_file === false) {
    return cloned.map((item) => Item.from_json({ ...item.to_json(), name_dst: item.name_src }));
  }
  const counts = new Map<string, Map<string, number>>();
  for (const item of cloned) {
    const item_name_src = Item.normalize_name(item.name_src);
    const item_name_dst = Item.normalize_name(item.name_dst);
    const src_names = Array.isArray(item_name_src)
      ? item_name_src
      : item_name_src === null
        ? []
        : [item_name_src];
    const dst_names = Array.isArray(item_name_dst)
      ? item_name_dst
      : item_name_dst === null
        ? []
        : [item_name_dst];
    src_names.forEach((src, index) => {
      const dst = dst_names[index] ?? src;
      const bucket = counts.get(src) ?? new Map<string, number>();
      bucket.set(dst, (bucket.get(dst) ?? 0) + 1);
      counts.set(src, bucket);
    });
  }
  const final_names = new Map<string, string>();
  for (const [src, bucket] of counts) {
    final_names.set(src, [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? src);
  }
  return cloned.map((item) => {
    if (typeof item.name_src === "string") {
      return Item.from_json({
        ...item.to_json(),
        name_dst: final_names.get(item.name_src) ?? item.name_src,
      });
    }
    if (Array.isArray(item.name_src)) {
      return Item.from_json({
        ...item.to_json(),
        name_dst: item.name_src.map((name) => final_names.get(name) ?? name),
      });
    }
    return item;
  });
}

/**
 * 导出统一使用有效译文，未来若增加状态级策略只需改这里
 */
export function effective_export_text(item: Item): string {
  return Item.from_json(item).effective_dst();
}
