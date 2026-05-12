import { ALL_LANGUAGE_CODE, has_language_character, normalize_language_code } from "../language";

// 语言预过滤只依赖基础语言值域，未知语言显式报错以暴露损坏配置
export function has_prefilter_language_character(text: string, source_language: string): boolean {
  const language_code = normalize_language_code(source_language);
  // "ALL" 表示关闭语言过滤
  if (language_code === ALL_LANGUAGE_CODE) {
    return true;
  }

  if (language_code === null) {
    throw new Error(`未知源语言代码：${source_language}`);
  }

  return has_language_character(text, language_code);
}

// 返回值 true 表示需要过滤（即需要排除）
export function should_skip_by_language_prefilter(text: string, source_language: string): boolean {
  return !has_prefilter_language_character(text, source_language);
}
