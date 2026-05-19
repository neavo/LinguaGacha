import { is_hangul_character, is_kana_character, normalize_language_code } from "../language";
import { check_similarity_by_jaccard } from "../utils/text-tool";

export const TRANSLATION_SIMILARITY_THRESHOLD = 0.8; // 相似度阈值是 Core 响应检查和校对页 warning 的唯一共享事实

export const TRANSLATION_RETRY_REVIEW_THRESHOLD = 2; // 达到该重试次数后交给人工校对，不再继续用任务侧质量检查阻塞提交

export type TranslationResidueFragments = {
  kana: string[]; // kana 只在源语言为日语时记录译文里的连续假名残留
  hangeul: string[]; // hangeul 只在源语言为韩语时记录译文里的连续谚文残留
};

/**
 * 去重时保留首次出现顺序，便于日志和校对页展示稳定片段。
 */
function unique_strings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * 残留片段按连续正文字符聚合，供日志裁决和校对页定位使用同一字符口径。
 */
function collect_contiguous_residue_fragments(
  text: string,
  is_residue_character: (character: string) => boolean,
): string[] {
  const fragments: string[] = [];
  let current_fragment = "";

  for (const character of Array.from(text)) {
    if (is_residue_character(character)) {
      current_fragment += character;
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
 * 源语言决定哪类残留有质量意义；未知语言和 ALL 不触发日/韩残留判断。
 */
export function collect_translation_residue_fragments(args: {
  text: string;
  sourceLanguage: string;
}): TranslationResidueFragments {
  const source_language = normalize_language_code(args.sourceLanguage);

  return {
    kana:
      source_language === "JA"
        ? collect_contiguous_residue_fragments(args.text, is_kana_character)
        : [],
    hangeul:
      source_language === "KO"
        ? collect_contiguous_residue_fragments(args.text, is_hangul_character)
        : [],
  };
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
 * 目标中文判断只接受归一化语言码，避免前后端各自维护中文别名。
 */
function is_chinese_target_language(targetLanguage: string): boolean {
  const target_language = normalize_language_code(targetLanguage);
  return target_language === "ZH" || target_language === "ZH-HANT";
}

/**
 * 相似度 issue 是质量裁决，不等同于 UI 的独立残留 warning；日/韩译中文时必须伴随对应残留。
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

  const source_language = normalize_language_code(args.sourceLanguage);
  if (!is_chinese_target_language(args.targetLanguage)) {
    return true;
  }

  const residue_fragments = collect_translation_residue_fragments({
    text: args.dst,
    sourceLanguage: args.sourceLanguage,
  });
  if (source_language === "JA") {
    return residue_fragments.kana.length > 0;
  }
  if (source_language === "KO") {
    return residue_fragments.hangeul.length > 0;
  }

  return true;
}
