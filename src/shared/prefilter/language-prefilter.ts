import {
  ALL_LANGUAGE_CODE,
  has_language_character,
  normalize_language_code,
} from "../../domain/language";
import { AppError } from "../error";

/**
 * 返回 true 表示需要排除；ALL 关闭过滤，未知语言显式暴露损坏配置。
 */
export function should_skip_by_language_prefilter(text: string, source_language: string): boolean {
  const language_code = normalize_language_code(source_language);
  // "ALL" 表示关闭语言过滤
  if (language_code === ALL_LANGUAGE_CODE) {
    return false;
  }

  if (language_code === null) {
    throw new AppError("language.unknown_source_language_code", {
      public_details: { source_language },
      diagnostic_context: { source_language },
    });
  }

  return !has_language_character(text, language_code);
}
