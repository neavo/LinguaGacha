import { should_skip_by_language_prefilter } from "../../../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../../../shared/prefilter/rule-prefilter";

/**
 * 翻译响应行质量检查器，按模型结果决定哪些行可提交
 */
export class ResponseChecker {
  /**
   * 已对齐译文的整体和逐行质量检查。
   */
  public static check_aligned(
    srcs: string[],
    dsts: string[],
    source_language: string,
    skip_internal_filter_by_line: boolean[] = [],
  ): string[] {
    if (dsts.every((value) => value === "")) {
      return srcs.map(() => "FAIL_DATA");
    }
    return srcs.map((raw_src, index) => {
      const src = raw_src.trim();
      if (src !== "" && (dsts[index] ?? "").trim() === "") {
        return "LINE_ERROR_EMPTY_LINE";
      }
      if (skip_internal_filter_by_line[index] !== true && !should_skip_by_rule_prefilter(src)) {
        // 过滤已在任务输入阶段完成；这里保留未知源语言显式失败的既有语义。
        should_skip_by_language_prefilter(src, source_language);
      }
      return "NONE";
    });
  }
}
