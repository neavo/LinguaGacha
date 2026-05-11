import { ALL_LANGUAGE_CODE, has_language_character, normalize_language_code } from "./languages";

// 获取语言判断函数。
export function has_target_language_character(text: string, source_language: string): boolean {
  const language_code = normalize_language_code(source_language);
  // "ALL" 表示关闭语言过滤。
  if (language_code === ALL_LANGUAGE_CODE) {
    return true;
  }

  // 未知语言不跳过，避免配置扩展时由前端误过滤正文。
  if (language_code === null) {
    return true;
  }

  return has_language_character(text, language_code);
}

// 返回值 true 表示需要过滤（即需要排除）。
export function should_skip_by_language_filter(text: string, source_language: string): boolean {
  return !has_target_language_character(text, source_language);
}
