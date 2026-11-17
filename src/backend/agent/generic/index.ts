import type { TSchema } from "typebox";
import { GENERIC_ITEMS_SCHEMA } from "../../../shared/generic-package";
import { create_schema_renderer } from "../workspace/schema-description";

export { pack, unpack } from "./package";
export {
  read_generic_items,
  type GenericItem,
  type GenericItems,
} from "../../../shared/generic-package";

/** 按需呈现当前 `.generic` 目标形状，避免永久扩张工具说明。 */
export function describe_package(): string {
  return create_schema_renderer(
    new Map<TSchema, string>([[GENERIC_ITEMS_SCHEMA, "GenericItems"]]),
  ).declarations();
}
