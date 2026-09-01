import {
  classify_language_grapheme,
  normalize_language_code,
  type TargetLanguageCode,
} from "../../domain/language";
import { check_similarity_by_jaccard } from "../utils/text-tool";

const TRANSLATION_SIMILARITY_THRESHOLD = 0.8; // 相似度阈值只服务校对页质量 warning

const TRANSLATION_RETRY_REVIEW_THRESHOLD = 2; // 达到该重试次数后交给人工校对，不再继续用任务侧质量检查阻塞提交

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * 去重时保留首次出现顺序，便于日志和校对页展示稳定片段。
 */
function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 外文残留只看目标语言允许的书写系统；字素簇保证基础文字与附标作为完整证据保留。
 */
export function collect_foreign_char_residue_fragments(args: {
  text: string;
  targetLanguage: TargetLanguageCode;
}): string[] {
  const fragments: string[] = [];
  let current_fragment = "";

  for (const { segment } of GRAPHEME_SEGMENTER.segment(args.text)) {
    if (classify_language_grapheme(segment, args.targetLanguage) === "residue") {
      current_fragment += segment;
      continue;
    }

    if (current_fragment !== "") {
      fragments.push(current_fragment);
      current_fragment = "";
    }
  }

  if (current_fragment !== "") {
    fragments.push(current_fragment);
  }

  return unique_strings(fragments);
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
    collect_foreign_char_residue_fragments({
      text: args.dst,
      targetLanguage: target_language,
    }).length > 0
  );
}
