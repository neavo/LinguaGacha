/**
 * 翻译提示词和响应解码共享的输出协议模式。
 */
export type TranslationPromptMode = "text" | "actor_text";

/**
 * 内置提示词模板当前只维护中英文两套输出格式说明。
 */
export type TranslationPromptLanguage = "zh" | "en";

/**
 * 构建翻译提示词中的 JSONLINE 输出格式示例。
 */
export function build_translation_output_format(
  mode: TranslationPromptMode,
  language: TranslationPromptLanguage,
): string {
  const index_label = language === "zh" ? "<序号>" : "<INDEX>";
  if (mode === "actor_text") {
    const actor_label = language === "zh" ? "<姓名译文或null>" : "<Translated Actor or null>";
    const text_label = language === "zh" ? "<正文译文>" : "<Translated Text>";
    return `\`\`\`jsonline\n{"${index_label}":{"actor":"${actor_label}","text":"${text_label}"}}\n\`\`\``;
  }
  const text_label = language === "zh" ? "<译文文本>" : "<Translated Text>";
  return `\`\`\`jsonline\n{"${index_label}":"${text_label}"}\n\`\`\``;
}

/**
 * 填充模板中的翻译输出格式占位符。
 */
export function fill_translation_output_format_placeholder(
  text: string,
  mode: TranslationPromptMode,
  language: TranslationPromptLanguage,
): string {
  return text.replaceAll(
    "{translation_output_format}",
    build_translation_output_format(mode, language),
  );
}
