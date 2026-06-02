import { Item, type ItemNameField } from "../domain/item";

export type ResolveExportItemNameInput = {
  name_src: ItemNameField | undefined;
  name_dst: ItemNameField | undefined;
  write_translated_name_fields_to_file?: boolean;
};

export function read_item_name_text(value: unknown): string {
  const normalized = Item.normalize_name_field(value);
  if (Array.isArray(normalized)) {
    return normalized[0] ?? "";
  }
  return normalized ?? "";
}

export function read_optional_item_name_text(value: unknown): string | null {
  const name = read_item_name_text(value);
  return name === "" ? null : name;
}

export function has_item_name_text(value: unknown): boolean {
  return read_item_name_text(value) !== "";
}

export function write_item_name_text(current: unknown, next_name: string): ItemNameField {
  const normalized = Item.normalize_name_field(current);
  if (Array.isArray(normalized)) {
    const names = [...normalized];
    names[0] = next_name;
    return names;
  }
  return next_name;
}

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

export function are_item_name_fields_equal(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(Item.normalize_name_field(left)) ===
    JSON.stringify(Item.normalize_name_field(right))
  );
}
