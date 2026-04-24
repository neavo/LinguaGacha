import * as OpenCC from "opencc-js";

import type {
  TsConversionConvertedItem,
  TsConversionDirection,
  TsConversionNameDst,
  TsConversionRuntimeItem,
} from "@/pages/ts-conversion-page/types";

export type TsConversionTextConverter = (text: string) => string;

type BuildConvertedItemsInput = {
  items: TsConversionRuntimeItem[];
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

export function normalize_ts_conversion_runtime_items(
  items: Record<string, unknown>,
): TsConversionRuntimeItem[] {
  return Object.values(items).flatMap((value) => {
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

export function create_ts_conversion_converter(
  direction: TsConversionDirection,
): TsConversionTextConverter {
  if (direction === "s2t") {
    return OpenCC.Converter({ from: "cn", to: "tw" });
  }
  return OpenCC.Converter({ from: "tw", to: "cn" });
}

function resolve_rules_for_item(args: {
  item: TsConversionRuntimeItem;
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

export function convert_text_with_optional_preserve(args: {
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
  if (Array.isArray(args.name_dst)) {
    return args.name_dst.map((name) =>
      convert_text_with_optional_preserve({
        text: name,
        converter: args.converter,
        rules: args.rules,
        preserve_text: args.preserve_text,
      }),
    );
  }
  if (typeof args.name_dst === "string") {
    return convert_text_with_optional_preserve({
      text: args.name_dst,
      converter: args.converter,
      rules: args.rules,
      preserve_text: args.preserve_text,
    });
  }
  return args.name_dst;
}

export function build_ts_conversion_custom_rules(
  entries: Array<Record<string, unknown>>,
): string[] {
  return entries.map((entry) => normalize_text(entry.src).trim()).filter((rule) => rule !== "");
}

export function collect_ts_conversion_text_types(items: TsConversionRuntimeItem[]): string[] {
  return [...new Set(items.map((item) => item.text_type).filter((text_type) => text_type !== ""))];
}

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
