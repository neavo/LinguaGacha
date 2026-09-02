import {
  classify_target_language_grapheme,
  normalize_language_code,
  type TargetLanguageCode,
} from "../../domain/language";
import { check_similarity_by_jaccard } from "../utils/text-tool";

const TRANSLATION_SIMILARITY_THRESHOLD = 0.8; // 相似度阈值只服务校对页质量 warning

const TRANSLATION_RETRY_REVIEW_THRESHOLD = 2; // 达到该重试次数后交给人工校对，不再继续用任务侧质量检查阻塞提交

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * 外文残留按连续字素聚合；孤立 Latin 字素证据不足，其它单字素和连续片段继续报告。
 */
export function collect_foreign_residue_fragments(args: {
  text: string;
  targetLanguage: TargetLanguageCode;
}): string[] {
  const fragments: string[] = [];
  let current_fragment = "";
  let current_grapheme_count = 0;
  let current_has_other_residue = false;

  // 片段结束时就地判断证据强度，不让过滤规则泄漏到调用方。
  const flush_current_fragment = (): void => {
    if (current_fragment !== "" && (current_grapheme_count > 1 || current_has_other_residue)) {
      fragments.push(current_fragment);
    }
    current_fragment = "";
    current_grapheme_count = 0;
    current_has_other_residue = false;
  };

  for (const { segment } of GRAPHEME_SEGMENTER.segment(args.text)) {
    const classification = classify_target_language_grapheme(segment, args.targetLanguage);
    if (classification === "latin-residue" || classification === "other-residue") {
      current_fragment += segment;
      current_grapheme_count += 1;
      current_has_other_residue ||= classification === "other-residue";
      continue;
    }

    flush_current_fragment();
  }

  flush_current_fragment();

  return [...new Set(fragments)];
}

/**
 * 重试阈值同时服务任务侧“停止继续阻塞”和校对页“提示人工介入”。
 */
export function has_translation_retry_reached_review_threshold(retryCount: number): boolean {
  const normalized_retry_count = Number.isFinite(retryCount) ? Math.trunc(retryCount) : 0;
  return normalized_retry_count >= TRANSLATION_RETRY_REVIEW_THRESHOLD;
}

/**
 * 文本相似先走包含关系快判，再使用字符集合 Jaccard，保持历史轻量质量检查口径。
 */
export function is_translation_text_similar(left: string, right: string): boolean {
  const left_text = left.trim();
  const right_text = right.trim();
  if (left_text === "" || right_text === "") {
    return false;
  }

  return (
    left_text.includes(right_text) ||
    right_text.includes(left_text) ||
    check_similarity_by_jaccard(left_text, right_text) > TRANSLATION_SIMILARITY_THRESHOLD
  );
}

/**
 * 相似度 issue 是独立质量裁决；日/韩译中文时沿用既有政策，要求同时出现非中文书写证据。
 */
export function has_translation_similarity_issue(args: {
  src: string;
  dst: string;
  sourceLanguage: string;
  targetLanguage: string;
}): boolean {
  if (!is_translation_text_similar(args.src, args.dst)) {
    return false;
  }

  const target_language = normalize_language_code(args.targetLanguage);
  const source_language = normalize_language_code(args.sourceLanguage);
  if (target_language !== "ZH" && target_language !== "ZH-HANT") {
    return true;
  }

  if (source_language !== "JA" && source_language !== "KO") {
    return true;
  }

  return (
    collect_foreign_residue_fragments({
      text: args.dst,
      targetLanguage: target_language,
    }).length > 0
  );
}
