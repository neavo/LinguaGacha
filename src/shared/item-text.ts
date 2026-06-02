import { read_item_name_text } from "./item-name";

export type ItemTextField = "src" | "name_src" | "dst" | "name_dst";

export type ItemTextPart = {
  field: ItemTextField; // 参与规则计算的原始字段
  text: string; // 规则匹配文本，调用方不得拼接跨字段文本
};

export type ItemTextGroup = ItemTextPart[];

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

export function read_item_source_text_parts(item: ItemTextRecord): ItemTextGroup {
  return [
    {
      field: "src",
      text: String(item.src ?? ""),
    },
    ...read_name_text_parts("name_src", item.name_src),
  ];
}

export function read_item_translation_text_parts(item: ItemTextRecord): ItemTextGroup {
  return [
    {
      field: "dst",
      text: String(item.dst ?? ""),
    },
    ...read_name_text_parts("name_dst", item.name_dst),
  ];
}

export function has_item_translation_text(item: ItemTextRecord): boolean {
  return read_item_translation_text_parts(item).some((part) => part.text !== "");
}

export function clear_item_translation_fields<T extends ItemTextRecord>(
  item: T,
): T & { dst: string; name_dst: null } {
  return {
    ...item,
    dst: "",
    name_dst: null,
  };
}

export function read_translation_name_text(value: unknown): string {
  return read_item_name_text(value);
}
