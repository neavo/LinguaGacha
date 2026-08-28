import { should_skip_by_language_prefilter } from "../../../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../../../shared/prefilter/rule-prefilter";

/**
 * 翻译响应 item 质量检查器；item 内的换行不再构成失败条件。
 */
export class ResponseChecker {
  /** Checks one request item without interpreting its internal line breaks. */
  public static check_item(
    src: string,
    dst: string,
    source_language: string,
    skip_internal_filter: boolean,
  ): "NONE" | "FAIL_DATA" {
    if (dst.trim() === "") return "FAIL_DATA";
    const normalized_src = src.trim();
    if (!skip_internal_filter && !should_skip_by_rule_prefilter(normalized_src)) {
      should_skip_by_language_prefilter(normalized_src, source_language);
    }
    return "NONE";
  }
}
