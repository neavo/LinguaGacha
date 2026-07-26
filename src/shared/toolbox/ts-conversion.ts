import * as OpenCC from "opencc-js";

import { read_item_name_text, write_item_name_text } from "../item-name";

export type TsConversionDirection = "s2t" | "t2s";

export type TsConversionNameDst = string | string[] | null;

export type TsConversionItem = {
  item_id: number;
  dst: string;
  name_dst: TsConversionNameDst;
  text_type: string;
};

export type TsConversionConvertedItem = {
  item_id: number;
  dst: string;
  name_dst: TsConversionNameDst;
};

type TsConversionTextConverter = (text: string) => string;

type BuildConvertedItemsInput = {
  items: TsConversionItem[];
  direction: TsConversionDirection;
  convert_name: boolean;
  preserve_text: boolean;
  text_preserve_mode: string;
  custom_rules: string[];
  preset_rules_by_text_type: Record<string, string[]>;
  converter?: TsConversionTextConverter;
};

function normalize_text(value: unknown): string {
  return String(value ?? "");
}

function normalize_item_id(value: unknown): number | null {
  const item_id = Number(value);
  if (!Number.isFinite(item_id)) {
    return null;
  }
  return item_id;
}

function normalize_name_dst(value: unknown): TsConversionNameDst {
  if (Array.isArray(value)) {
    return value.map((name) => normalize_text(name));
  }
  if (value === null || value === undefined) {
    return null;
  }
  return normalize_text(value);
}

// 外部条目只保留转换所需字段，无有效 item_id 的记录直接丢弃。
export function normalize_ts_conversion_items(items: Iterable<unknown>): TsConversionItem[] {
  return [...items].flatMap((value) => {
    if (typeof value !== "object" || value === null) {
      return [];
    }

    const candidate = value as Record<string, unknown>;
    const item_id = normalize_item_id(candidate.item_id ?? candidate.id);
    if (item_id === null) {
      return [];
    }

    return [
      {
        item_id,
        dst: normalize_text(candidate.dst),
        name_dst: normalize_name_dst(candidate.name_dst),
        text_type: normalize_text(candidate.text_type || "NONE").toUpperCase(),
      },
    ];
  });
}

function create_ts_conversion_converter(
  direction: TsConversionDirection,
): TsConversionTextConverter {
  if (direction === "s2t") {
    return OpenCC.Converter({ from: "cn", to: "tw" });
  }
  return OpenCC.Converter({ from: "tw", to: "cn" });
}

function resolve_rules_for_item(args: {
  item: TsConversionItem;
  text_preserve_mode: string;
  custom_rules: string[];
  preset_rules_by_text_type: Record<string, string[]>;
}): string[] {
  const mode = args.text_preserve_mode.toLowerCase();
  if (mode === "off") {
    return [];
  }
  if (mode === "custom") {
    return args.custom_rules;
  }
  return args.preset_rules_by_text_type[args.item.text_type] ?? [];
}

function compile_text_preserve_rule(rules: string[]): RegExp | null {
  const effective_rules = rules.filter((rule) => rule.trim() !== "");
  if (effective_rules.length === 0) {
    return null;
  }

  try {
    return new RegExp(`(?:${effective_rules.join("|")})+`, "giu");
  } catch {
    return null;
  }
}

// 保留片段原样拼回，只转换各匹配区间之间的文本，避免简繁转换破坏占位符。
function convert_text_with_optional_preserve(args: {
  text: string;
  converter: TsConversionTextConverter;
  rules: string[];
  preserve_text: boolean;
}): string {
  if (args.text === "") {
    return args.text;
  }
  if (!args.preserve_text) {
    return args.converter(args.text);
  }

  const preserve_rule = compile_text_preserve_rule(args.rules);
  if (preserve_rule === null) {
    return args.converter(args.text);
  }

  let last_end = 0;
  const result: string[] = [];
  for (const match of args.text.matchAll(preserve_rule)) {
    const matched_text = match[0];
    const start = match.index ?? 0;
    if (matched_text === "") {
      continue;
    }
    if (start > last_end) {
      result.push(args.converter(args.text.slice(last_end, start)));
    }
    result.push(matched_text);
    last_end = start + matched_text.length;
  }

  if (last_end < args.text.length) {
    result.push(args.converter(args.text.slice(last_end)));
  }
  return result.join("");
}

function convert_name_dst(args: {
  name_dst: TsConversionNameDst;
  converter: TsConversionTextConverter;
  rules: string[];
  preserve_text: boolean;
}): TsConversionNameDst {
  const name = read_item_name_text(args.name_dst);
  if (name === "") {
    return args.name_dst;
  }

  const converted_name = convert_text_with_optional_preserve({
    text: name,
    converter: args.converter,
    rules: args.rules,
    preserve_text: args.preserve_text,
  });
  return write_item_name_text(args.name_dst, converted_name);
}

// 自定义保护规则按用户顺序去空保留，正则合法性在编译阶段统一处理。
export function build_ts_conversion_custom_rules(
  entries: Array<Record<string, unknown>>,
): string[] {
  return entries.map((entry) => normalize_text(entry.src).trim()).filter((rule) => rule !== "");
}

// worker 只需要实际出现的文本类型集合来加载对应预置保护规则。
export function collect_ts_conversion_text_types(items: TsConversionItem[]): string[] {
  return [...new Set(items.map((item) => item.text_type).filter((text_type) => text_type !== ""))];
}

// 每个条目按文本类型选择保护规则，正文与姓名共享同一转换器。
export function build_ts_conversion_converted_items(
  input: BuildConvertedItemsInput,
): TsConversionConvertedItem[] {
  const converter = input.converter ?? create_ts_conversion_converter(input.direction);
  return input.items.map((item) => {
    const rules = resolve_rules_for_item({
      item,
      text_preserve_mode: input.text_preserve_mode,
      custom_rules: input.custom_rules,
      preset_rules_by_text_type: input.preset_rules_by_text_type,
    });
    const dst =
      item.dst === ""
        ? item.dst
        : convert_text_with_optional_preserve({
            text: item.dst,
            converter,
            rules,
            preserve_text: input.preserve_text,
          });

    return {
      item_id: item.item_id,
      dst,
      name_dst: input.convert_name
        ? convert_name_dst({
            name_dst: item.name_dst,
            converter,
            rules,
            preserve_text: input.preserve_text,
          })
        : item.name_dst,
    };
  });
}
