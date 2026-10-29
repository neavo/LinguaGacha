import type { ItemNameField } from "../domain/item";

/** 生成译文时优先使用非空译名，否则回退源姓名。 */
export function resolve_output_item_name(input: {
  name_src: ItemNameField | undefined;
  name_dst: ItemNameField | undefined;
}): ItemNameField {
  return input.name_dst || (input.name_src ?? null);
}
