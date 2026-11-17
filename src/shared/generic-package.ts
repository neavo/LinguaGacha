import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { JSON_VALUE_SCHEMA } from "../domain/json";

/** 三类数据包共用的基础条目结构；领域字段保留 JSON 值。 */
export const GENERIC_ITEM_SCHEMA = Type.Object(
  {
    message: Type.String(),
    name: Type.Optional(Type.String()),
  },
  { additionalProperties: JSON_VALUE_SCHEMA },
);
export const GENERIC_ITEMS_SCHEMA = Type.Array(GENERIC_ITEM_SCHEMA);
export type GenericItem = Static<typeof GENERIC_ITEM_SCHEMA>;
export type GenericItems = Static<typeof GENERIC_ITEMS_SCHEMA>;

/** `.generic`、`.media` 与 `.image` 的条目成员共用当前记录边界。 */
export function read_generic_items(value: unknown): GenericItems {
  if (!Check(GENERIC_ITEMS_SCHEMA, value)) throw new Error("Invalid message records");
  return value;
}
