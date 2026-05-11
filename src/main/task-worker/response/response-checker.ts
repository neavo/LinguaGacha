import { should_skip_by_language_filter } from "../../../shared/rules/language-filter";
import { is_hangul_character, is_kana_character } from "../../../shared/rules/languages";
import { should_skip_by_rule_filter } from "../../../shared/rules/rule-filter";
import {
  build_text_preserve_rule,
  normalize_text_preserve_mode,
} from "../../../shared/text/text-preserve-rules";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../shared/text/text-types";
import { TextTool } from "../../../shared/utils/text-tool";

// 空白归一化用于相似度判断，避免换行和多空格影响质量检查。
const BLANK_PATTERN = /\s+/gu;

/**
 * 翻译响应行质量检查器，按模型结果决定哪些行可提交。
 */
export class ResponseChecker {
  /**
   * 退化、解析失败、行数和逐行问题都收口为固定错误字符串。
   */
  public static check(
    srcs: string[],
    dsts: string[],
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
    item_retry_count: number,
    stream_degraded: boolean,
  ): string[] {
    if (stream_degraded) {
      return srcs.map(() => "FAIL_DEGRADATION");
    }
    if (dsts.every((value) => value === "")) {
      return srcs.map(() => "FAIL_DATA");
    }
    if (item_retry_count >= 2) {
      return srcs.map(() => "NONE");
    }
    if (srcs.length !== dsts.length) {
      return srcs.map(() => "FAIL_LINE_COUNT");
    }
    return srcs.map((src, index) =>
      this.check_line(src, dsts[index] ?? "", text_type, config, quality_snapshot),
    );
  }

  /**
   * 单行检查顺序保持：空译文、规则过滤、语言过滤、保护段剥离、残留和相似度。
   */
  private static check_line(
    raw_src: string,
    raw_dst: string,
    text_type: string,
    config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
  ): string {
    let src = raw_src.trim();
    let dst = raw_dst.trim();
    if (src !== "" && dst === "") {
      return "LINE_ERROR_EMPTY_LINE";
    }
    if (
      should_skip_by_rule_filter(src) ||
      should_skip_by_language_filter(src, config.source_language)
    ) {
      return "NONE";
    }
    if (!this.check_preserved_segments(src, dst, text_type, quality_snapshot)) {
      return "FAIL_DATA";
    }
    const preserve_rule =
      normalize_text_preserve_mode(quality_snapshot.text_preserve_mode) === "off"
        ? null
        : this.get_sample_rule(text_type, quality_snapshot);
    if (preserve_rule !== null) {
      src = src.replace(preserve_rule, "");
      dst = dst.replace(preserve_rule, "");
    }
    if (
      config.check_kana_residue &&
      config.source_language === "JA" &&
      [...dst].some((char) => is_kana_character(char))
    ) {
      return "LINE_ERROR_KANA";
    }
    if (
      config.check_hangeul_residue &&
      config.source_language === "KO" &&
      [...dst].some((char) => is_hangul_character(char))
    ) {
      return "LINE_ERROR_HANGEUL";
    }
    if (config.check_similarity && this.is_similar_residue(src, dst, config)) {
      return "LINE_ERROR_SIMILARITY";
    }
    return "NONE";
  }

  /**
   * 文本保护检查比较逐个非空保护段，而不是比较整块命中结果。
   */
  private static check_preserved_segments(
    src: string,
    dst: string,
    text_type: string,
    quality_snapshot: TextQualitySnapshot,
  ): boolean {
    const rule = this.get_sample_rule(text_type, quality_snapshot);
    if (rule === null) {
      return true;
    }
    return (
      this.collect_non_blank_preserved_segments(src, rule).join("\u0000") ===
      this.collect_non_blank_preserved_segments(dst, rule).join("\u0000")
    );
  }

  /**
   * 样例规则用于保护段比较和剥离，必须和译前样例收集保持同源。
   */
  private static get_sample_rule(
    text_type: string,
    quality_snapshot: TextQualitySnapshot,
  ): RegExp | null {
    return build_text_preserve_rule({
      mode: quality_snapshot.text_preserve_mode,
      text_type,
      entries: quality_snapshot.text_preserve_entries,
      kind: "sample",
    });
  }

  /**
   * 保护段比较会移除内部空白，和历史实现的空白规则口径一致。
   */
  private static collect_non_blank_preserved_segments(text: string, rule: RegExp): string[] {
    const segments: string[] = [];
    rule.lastIndex = 0;
    for (const match of text.matchAll(rule)) {
      const segment = (match[0] ?? "").replace(BLANK_PATTERN, "");
      if (segment !== "") {
        segments.push(segment);
      }
    }
    rule.lastIndex = 0;
    return segments;
  }

  /**
   * 相似度在日/韩翻中时只对目标残留字符触发，其他语言按通用相似度判断。
   */
  private static is_similar_residue(
    src: string,
    dst: string,
    config: TextProcessingConfig,
  ): boolean {
    const similar =
      src.includes(dst) ||
      dst.includes(src) ||
      TextTool.check_similarity_by_jaccard(src, dst) > 0.8;
    if (!similar) {
      return false;
    }
    if (config.source_language === "JA" && config.target_language === "ZH") {
      return [...dst].some((char) => is_kana_character(char));
    }
    if (config.source_language === "KO" && config.target_language === "ZH") {
      return [...dst].some((char) => is_hangul_character(char));
    }
    return true;
  }
}
