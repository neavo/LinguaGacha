import { Item, read_json_record } from "../../../../base/item";
import { parse_document, parse_translate_header } from "./parser";
import { RenpyExtractor } from "./extractor";
import { sha1_hex } from "./lexer";
import { RENPY_EXTRA_VERSION, type RenpyAstKey } from "./types";

/**
 * 历史项目导入或数据库迁移能稳定补齐当前 AST extra 后，可以整体删除本兼容入口。
 */
export function build_items_for_writeback(
  rel_path: string,
  lines: string[],
  items: Item[],
  extractor = new RenpyExtractor(),
): Item[] {
  const cloned_items = items.map((item) => Item.from_json(item));
  if (cloned_items.length > 0 && cloned_items.every(has_current_ast_extra_field)) {
    return cloned_items;
  }

  const parsed_items = extractor.extract(parse_document(lines), rel_path);
  const ast_written_target_lines = transfer_ast_translations(cloned_items, parsed_items);
  transfer_legacy_translations(cloned_items, parsed_items, ast_written_target_lines);
  return parsed_items;
}

/**
 * 当前 AST extra 必须具备写回器所需的版本、块、配对、槽位和摘要。
 */
export function has_current_ast_extra_field(item: Item): boolean {
  const renpy = read_json_record(read_json_record(item.extra_field)["renpy"]);
  if (renpy["v"] !== RENPY_EXTRA_VERSION) {
    return false;
  }
  const block = read_json_record(renpy["block"]);
  const pair = read_json_record(renpy["pair"]);
  const digest = read_json_record(renpy["digest"]);
  return (
    typeof block["lang"] === "string" &&
    typeof block["label"] === "string" &&
    typeof block["kind"] === "string" &&
    typeof pair["template_line"] === "number" &&
    typeof pair["target_line"] === "number" &&
    Array.isArray(renpy["slots"]) &&
    typeof digest["template_raw_sha1"] === "string" &&
    typeof digest["template_raw_rstrip_sha1"] === "string" &&
    typeof digest["target_skeleton_sha1"] === "string" &&
    typeof digest["target_string_count"] === "number"
  );
}

/**
 * 从 AST extra 读取目标行，用于排序和历史迁移覆盖保护。
 */
export function get_item_target_line(item: Item): number {
  const renpy = read_json_record(read_json_record(item.extra_field)["renpy"]);
  const pair = read_json_record(renpy["pair"]);
  return typeof pair["target_line"] === "number" ? Math.trunc(pair["target_line"]) : 0;
}

/**
 * AST key 用块归属和模板摘要定位同一条原始模板，rstrip 摘要用于兼容行尾空白变化。
 */
export function build_ast_keys(item: Item): RenpyAstKey[] {
  const renpy = read_json_record(read_json_record(item.extra_field)["renpy"]);
  const block = read_json_record(renpy["block"]);
  const digest = read_json_record(renpy["digest"]);
  const lang = block["lang"];
  const label = block["label"];
  if (typeof lang !== "string" || typeof label !== "string") {
    return [];
  }

  const keys: RenpyAstKey[] = [];
  const primary = digest["template_raw_sha1"];
  const fallback = digest["template_raw_rstrip_sha1"];
  if (typeof primary === "string" && primary !== "") {
    keys.push([lang, label, primary]);
  }
  if (typeof fallback === "string" && fallback !== "" && keys[0]?.[2] !== fallback) {
    keys.push([lang, label, fallback]);
  }
  return keys;
}

/**
 * 当前 AST 或旧 AST extra 的译文先迁移到重新解析出的规范条目。
 */
export function transfer_ast_translations(existing_items: Item[], new_items: Item[]): Set<number> {
  const existing_by_key = new Map<string, Item[]>();
  for (const item of existing_items) {
    const keys = build_ast_keys(item);
    if (keys.length === 0) {
      continue;
    }
    const key_id = ast_key_id(keys[0]!);
    const bucket = existing_by_key.get(key_id) ?? [];
    bucket.push(item);
    existing_by_key.set(key_id, bucket);
  }

  const written_target_lines = new Set<number>();
  for (const item of new_items) {
    const candidates = pick_candidates(build_ast_keys(item), existing_by_key);
    if (candidates === null) {
      continue;
    }
    const picked = pick_best_candidate(item, candidates);
    transfer_item_translation(picked, item);
    const target_line = get_item_target_line(item);
    if (target_line > 0) {
      written_target_lines.add(target_line);
    }
  }
  return written_target_lines;
}

/**
 * 历史字符串 extra 只用于译文迁移，不直接驱动写回器替换任何槽位。
 */
export function transfer_legacy_translations(
  legacy_items: Item[],
  new_items: Item[],
  skip_target_lines: Set<number> | null,
): void {
  const legacy_by_key = new Map<string, Item[]>();
  let current_lang: string | null = null;
  let current_label: string | null = null;
  for (const item of [...legacy_items].sort((left, right) => left.row - right.row)) {
    if (typeof item.extra_field !== "string") {
      continue;
    }
    const header = parse_translate_header(item.extra_field);
    if (header !== null) {
      current_lang = header.lang;
      current_label = header.label;
      continue;
    }
    if (current_lang === null || current_label === null || item.src === "") {
      continue;
    }
    const key_id = ast_key_id([current_lang, current_label, sha1_hex(item.extra_field)]);
    const bucket = legacy_by_key.get(key_id) ?? [];
    bucket.push(item);
    legacy_by_key.set(key_id, bucket);
  }

  for (const item of new_items) {
    const target_line = get_item_target_line(item);
    if (skip_target_lines?.has(target_line)) {
      continue;
    }
    const candidates = pick_candidates(build_ast_keys(item), legacy_by_key);
    if (candidates === null) {
      continue;
    }
    transfer_item_translation(pick_best_candidate(item, candidates), item);
  }
}

/**
 * 多个候选按姓名和原文优先匹配，每个候选只消费一次。
 */
export function pick_best_candidate(item: Item, candidates: Item[]): Item {
  if (candidates.length === 1) {
    return candidates.shift()!;
  }
  const exact_index = candidates.findIndex(
    (candidate) => candidate.src === item.src && candidate.name_src === item.name_src,
  );
  if (exact_index >= 0) {
    return candidates.splice(exact_index, 1)[0]!;
  }
  const src_index = candidates.findIndex((candidate) => candidate.src === item.src);
  if (src_index >= 0) {
    return candidates.splice(src_index, 1)[0]!;
  }
  return candidates.shift()!;
}

/**
 * 译文迁移只复制用户可编辑字段，定位 extra_field 始终保留新解析出的规范 AST。
 */
function transfer_item_translation(source: Item, target: Item): void {
  target.dst = source.dst;
  if (source.name_dst !== null) {
    target.name_dst = source.name_dst;
  }
}

/**
 * 键查询按主摘要到备用摘要顺序命中，命中后由候选池负责消费去重。
 */
function pick_candidates(keys: RenpyAstKey[], buckets: Map<string, Item[]>): Item[] | null {
  for (const key of keys) {
    const bucket = buckets.get(ast_key_id(key));
    if (bucket !== undefined && bucket.length > 0) {
      return bucket;
    }
  }
  return null;
}

/**
 * Map key 使用不可见分隔符，避免 lang、label 和摘要拼接产生歧义。
 */
function ast_key_id(key: RenpyAstKey): string {
  return `${key[0]}\u001f${key[1]}\u001f${key[2]}`;
}
