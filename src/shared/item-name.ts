import { Item, type ItemNameField } from "../domain/item";

type ResolveExportItemNameInput = {
  name_src: ItemNameField | undefined;
  name_dst: ItemNameField | undefined;
  write_translated_name_fields_to_file?: boolean;
};

// 姓名数组只有第 0 槽是当前可见姓名，后续槽位作为格式附加信息保留。
export function read_item_name_text(value: unknown): string {
  const normalized = Item.normalize_name_field(value);
  if (Array.isArray(normalized)) {
    return normalized[0] ?? "";
  }
  return normalized ?? "";
}

// 空姓名统一映射为 null，供可选展示和筛选边界消费。
export function read_optional_item_name_text(value: unknown): string | null {
  const name = read_item_name_text(value);
  return name === "" ? null : name;
}

// 写姓名时只替换第 0 槽，不能丢失数组中的格式附加信息。
export function write_item_name_text(current: unknown, next_name: string): ItemNameField {
  const normalized = Item.normalize_name_field(current);
  if (Array.isArray(normalized)) {
    const names = [...normalized];
    names[0] = next_name;
    return names;
  }
  return next_name;
}

// 导出时按设置选择源姓名或译名，并保持源字段原有标量/数组形状。
export function resolve_export_item_name(input: ResolveExportItemNameInput): ItemNameField {
  const source_name = Item.normalize_name_field(input.name_src);
  if (input.write_translated_name_fields_to_file === false) {
    return source_name;
  }

  const translation_name = read_item_name_text(input.name_dst);
  if (translation_name === "") {
    return source_name;
  }

  if (Array.isArray(source_name)) {
    const names = [...source_name];
    names[0] = translation_name;
    return names;
  }
  return translation_name;
}

// 比较前先走领域归一，避免 null、空值和姓名数组产生并行语义。
export function are_item_name_fields_equal(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(Item.normalize_name_field(left)) ===
    JSON.stringify(Item.normalize_name_field(right))
  );
}
