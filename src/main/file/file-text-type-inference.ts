import { Item, type ItemTextType } from "../../base/item";

/**
 * 缺少显式 text_type 时按原文内容兜底推断引擎类型
 */
export function infer_text_type_from_source(src: string): ItemTextType {
  return Item.infer_text_type_from_source(src);
}
