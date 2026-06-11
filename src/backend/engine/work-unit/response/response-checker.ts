import { should_skip_by_language_prefilter } from "../../../../shared/prefilter/language-prefilter";
import { should_skip_by_rule_prefilter } from "../../../../shared/prefilter/rule-prefilter";
import {
  build_text_preserve_rule,
  normalize_text_preserve_mode,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import {
  has_translation_retry_reached_review_threshold,
  has_translation_similarity_issue,
} from "../../../../shared/text/translation-quality-rules";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";

/**
 * 翻译响应行质量检查器，按模型结果决定哪些行可提交
 */
export class ResponseChecker {
  /**
   * 退化、解析失败、行数和逐行问题都收口为固定错误字符串
   */
  public static check(
    srcs: string[],
    dsts: string[],
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    item_retry_count: number,
    stream_degraded: boolean,
    skip_internal_filter_by_line: boolean[] = [],
  ): string[] {
    if (stream_degraded) {
      return srcs.map(() => "FAIL_DEGRADATION");
    }
    if (dsts.every((value) => value === "")) {
      return srcs.map(() => "FAIL_DATA");
    }
    if (has_translation_retry_reached_review_threshold(item_retry_count)) {
      return srcs.map(() => "NONE");
    }
    if (srcs.length !== dsts.length) {
      return srcs.map(() => "FAIL_LINE_COUNT");
    }
    return this.check_lines(
      srcs,
      dsts,
      text_type,
      config,
      quality_snapshot,
      skip_internal_filter_by_line,
    );
  }

  /**
   * 逐行检查入口保留给单元测试和调用方区分“整包解析失败”与“单行空译文”
   */
  public static check_lines(
    srcs: string[],
    dsts: string[],
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    skip_internal_filter_by_line: boolean[] = [],
  ): string[] {
    return srcs.map((src, index) =>
      this.check_line(
        src,
        dsts[index] ?? "",
        text_type,
        config,
        quality_snapshot,
        skip_internal_filter_by_line[index] === true,
      ),
    );
  }

  /**
   * 单行检查顺序保持：空译文、规则过滤、语言过滤、保护段剥离和相似度
   */
  private static check_line(
    raw_src: string,
    raw_dst: string,
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    skip_internal_filter: boolean,
  ): string {
    let src = raw_src.trim();
    let dst = raw_dst.trim();
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
    const preserve_rule =
      normalize_text_preserve_mode(quality_snapshot.text_preserve_mode) === "off"
        ? null
        : this.get_sample_rule(text_type, quality_snapshot);
    if (preserve_rule !== null) {
      src = preserve_rule.replace(src, "");
      dst = preserve_rule.replace(dst, "");
    }
    if (
      has_translation_similarity_issue({
        src,
        dst,
        sourceLanguage: config.source_language,
        targetLanguage: config.target_language,
      })
    ) {
      return "LINE_ERROR_SIMILARITY";
    }
    return "NONE";
  }

  /**
   * 样例规则只用于剥离保护片段，保持和迁移前响应检查的宽容口径一致
   */
  private static get_sample_rule(
    text_type: string,
    quality_snapshot: TextQualitySnapshot,
  ): TextPreserveRule | null {
    return build_text_preserve_rule({
      mode: quality_snapshot.text_preserve_mode,
      text_type,
      entries: quality_snapshot.text_preserve_entries,
      kind: "sample",
    });
  }
}
