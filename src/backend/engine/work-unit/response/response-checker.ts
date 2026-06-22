import { should_skip_by_language_prefilter } from "../../../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../../../shared/prefilter/rule-prefilter";
import type { TextProcessingConfig } from "../../../../shared/text/text-types";

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
    config: TextProcessingConfig,
    skip_internal_filter_by_line: boolean[] = [],
  ): string[] {
    if (dsts.every((value) => value === "")) {
      return srcs.map(() => "FAIL_DATA");
    }
    return this.check_lines(srcs, dsts, config, skip_internal_filter_by_line);
  }

  /**
   * 逐行检查入口保留给单元测试和调用方区分“整包解析失败”与“单行空译文”
   */
  public static check_lines(
    srcs: string[],
    dsts: string[],
    config: TextProcessingConfig,
    skip_internal_filter_by_line: boolean[] = [],
  ): string[] {
    return srcs.map((src, index) =>
      this.check_line(src, dsts[index] ?? "", config, skip_internal_filter_by_line[index] === true),
    );
  }

  /**
   * 单行检查顺序保持：空译文、规则过滤、语言过滤
   */
  private static check_line(
    raw_src: string,
    raw_dst: string,
    config: TextProcessingConfig,
    skip_internal_filter: boolean,
  ): string {
    const src = raw_src.trim();
    const dst = raw_dst.trim();
    if (src !== "" && dst === "") {
      return "LINE_ERROR_EMPTY_LINE";
    }
    if (
      !skip_internal_filter &&
      (should_skip_by_rule_prefilter(src) ||
        should_skip_by_language_prefilter(src, config.source_language))
    ) {
      return "NONE";
    }
    return "NONE";
  }
}
