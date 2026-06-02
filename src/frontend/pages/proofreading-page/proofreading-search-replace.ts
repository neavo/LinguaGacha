import { read_item_name_text } from "@shared/item-name";
import {
  compile_text_pattern,
  matches_text_pattern,
  replace_text_pattern,
  type CompiledTextPattern,
} from "@shared/text/text-pattern";
import type { ProofreadingItem } from "@shared/proofreading/proofreading-types";

export type ProofreadingCompiledSearchPattern = CompiledTextPattern;

export function create_search_pattern(
  keyword: string,
  is_regex: boolean,
): ProofreadingCompiledSearchPattern | null {
  return compile_text_pattern({
    source_text: keyword,
    mode: is_regex ? "regex" : "literal",
    case_sensitive: false,
    global: false,
  });
}

export function matches_search_pattern(
  text: string,
  search_pattern: ProofreadingCompiledSearchPattern | null,
  keyword: string,
): boolean {
  const normalized_keyword = keyword.trim();
  if (normalized_keyword === "") {
    return true;
  }

  if (search_pattern === null) {
    return true;
  }

  return matches_text_pattern(text, search_pattern);
}

export function replace_first_visible_match(
  text: string,
  search_pattern: ProofreadingCompiledSearchPattern,
  replacement: string,
  is_regex: boolean,
): { text: string; replaced: boolean } {
  const replace_result = replace_text_pattern({
    text,
    pattern: search_pattern,
    replacement_text: replacement,
    replacement_syntax: is_regex ? "javascript" : "literal",
  });
  return {
    text: replace_result.text,
    replaced: replace_result.count > 0 && replace_result.text !== text,
  };
}

export function find_first_translation_replace(args: {
  item: ProofreadingItem;
  search_pattern: ProofreadingCompiledSearchPattern;
  replacement: string;
  is_regex: boolean;
}): { field: "dst" | "name_dst"; text: string } | null {
  const dst_result = replace_first_visible_match(
    args.item.dst,
    args.search_pattern,
    args.replacement,
    args.is_regex,
  );
  if (dst_result.replaced) {
    return {
      field: "dst",
      text: dst_result.text,
    };
  }

  const name_dst = read_item_name_text(args.item.name_dst);
  const name_result = replace_first_visible_match(
    name_dst,
    args.search_pattern,
    args.replacement,
    args.is_regex,
  );
  if (name_result.replaced) {
    return {
      field: "name_dst",
      text: name_result.text,
    };
  }

  return null;
}

export function matches_translation_replace_target(args: {
  item: ProofreadingItem;
  search_pattern: ProofreadingCompiledSearchPattern | null;
  keyword: string;
}): boolean {
  return (
    matches_search_pattern(args.item.dst, args.search_pattern, args.keyword) ||
    matches_search_pattern(
      read_item_name_text(args.item.name_dst),
      args.search_pattern,
      args.keyword,
    )
  );
}
