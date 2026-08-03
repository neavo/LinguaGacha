import * as OpenCC from "opencc-js";

import { read_item_name_text, write_item_name_text } from "../item-name";
import type { TextPreserveEntry } from "../../domain/quality";
import { build_text_preserve_rule, type TextPreserveRule } from "./text-preserve-rules";

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
  text_preserve_entries: TextPreserveEntry[];
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

// 保留片段原样拼回，只转换各匹配区间之间的文本，避免简繁转换破坏占位符。
function convert_text_with_optional_preserve(args: {
  text: string;
  converter: TsConversionTextConverter;
  preserve_rule: TextPreserveRule | null;
}): string {
  if (args.text === "") {
    return args.text;
  }
  return (
    args.preserve_rule?.transform_unpreserved(args.text, args.converter) ??
    args.converter(args.text)
  );
}

function convert_name_dst(args: {
  name_dst: TsConversionNameDst;
  converter: TsConversionTextConverter;
  preserve_rule: TextPreserveRule | null;
}): TsConversionNameDst {
  const name = read_item_name_text(args.name_dst);
  if (name === "") {
    return args.name_dst;
  }

  const converted_name = convert_text_with_optional_preserve({
    text: name,
    converter: args.converter,
    preserve_rule: args.preserve_rule,
  });
  return write_item_name_text(args.name_dst, converted_name);
}

// 每个条目按文本类型选择保护规则，正文与姓名共享同一转换器。
export function build_ts_conversion_converted_items(
  input: BuildConvertedItemsInput,
): TsConversionConvertedItem[] {
  const converter = input.converter ?? create_ts_conversion_converter(input.direction);
  const preserve_rule_by_text_type = new Map<string, TextPreserveRule | null>();
  return input.items.map((item) => {
    let preserve_rule = preserve_rule_by_text_type.get(item.text_type);
    if (preserve_rule === undefined) {
      preserve_rule = input.preserve_text
        ? build_text_preserve_rule({
            mode: input.text_preserve_mode,
            text_type: item.text_type,
            entries: input.text_preserve_entries,
          })
        : null;
      preserve_rule_by_text_type.set(item.text_type, preserve_rule);
    }
    const dst =
      item.dst === ""
        ? item.dst
        : convert_text_with_optional_preserve({
            text: item.dst,
            converter,
            preserve_rule,
          });

    return {
      item_id: item.item_id,
      dst,
      name_dst: input.convert_name
        ? convert_name_dst({
            name_dst: item.name_dst,
            converter,
            preserve_rule,
          })
        : item.name_dst,
    };
  });
}
