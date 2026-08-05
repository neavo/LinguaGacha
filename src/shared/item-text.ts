import { read_item_name_text } from "./item-name";

type ItemTextField = "src" | "name_src" | "dst" | "name_dst";

export type ItemTextPart = {
  field: ItemTextField; // 参与规则计算的原始字段
  text: string; // 规则匹配文本，调用方不得拼接跨字段文本
};

export type ItemTextGroup = ItemTextPart[];

/** 保持字段边界，把每个字段拆成独立行；空行仍是可观察文本单元。 */
export function split_item_text_parts_by_line(parts: readonly ItemTextPart[]): ItemTextGroup {
  return parts.flatMap((part) =>
    part.text.split("\n").map((text) => ({ field: part.field, text })),
  );
}

type ItemTextRecord = {
  src?: unknown;
  dst?: unknown;
  name_src?: unknown;
  name_dst?: unknown;
};

function read_name_text_parts(field: "name_src" | "name_dst", value: unknown): ItemTextPart[] {
  const text = read_item_name_text(value);
  return text === "" ? [] : [{ field, text }];
}

// 原文正文与源姓名保持独立 part，规则不得跨字段拼接命中。
export function read_item_source_text_parts(item: ItemTextRecord): ItemTextGroup {
  return [
    {
      field: "src",
      text: String(item.src ?? ""),
    },
    ...read_name_text_parts("name_src", item.name_src),
  ];
}

// 译文正文与译名保持独立 part，统计和校对共用同一拆分口径。
export function read_item_translation_text_parts(item: ItemTextRecord): ItemTextGroup {
  return [
    {
      field: "dst",
      text: String(item.dst ?? ""),
    },
    ...read_name_text_parts("name_dst", item.name_dst),
  ];
}

// 任一译文字段非空即视为条目已有翻译。
export function has_item_translation_text(item: ItemTextRecord): boolean {
  return read_item_translation_text_parts(item).some((part) => part.text !== "");
}

// 清空译文时保留其它条目字段，并把译名恢复为领域空值 null。
export function clear_item_translation_fields<T extends ItemTextRecord>(
  item: T,
): T & { dst: string; name_dst: null } {
  return {
    ...item,
    dst: "",
    name_dst: null,
  };
}
