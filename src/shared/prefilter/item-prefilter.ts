import type { ItemNameField } from "../../domain/item";
import { read_item_source_text_parts, type ItemTextGroup } from "../item-text";
import { has_translatable_text, should_skip_by_rule_prefilter } from "./rule-prefilter";

/** 正文与可见姓名独立参与候选判断。格式元数据规则只作用于正文。 */
export function read_item_translation_candidates(item: {
  src?: string;
  name_src?: ItemNameField;
  skip_internal_filter?: boolean;
}): ItemTextGroup {
  return read_item_source_text_parts(item).filter(
    (part) =>
      item.skip_internal_filter === true ||
      (part.field === "src"
        ? !should_skip_by_rule_prefilter(part.text)
        : has_translatable_text(part.text)),
  );
}
