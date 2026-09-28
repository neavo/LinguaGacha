import { read_json_record } from "./json";
/** 翻译提示词资源与持久化槽位的唯一描述。 */
export const TRANSLATION_PROMPT = Object.freeze({
  database_type: "translation_prompt",
  directory_name: "translation_prompt",
  enabled_meta_key: "translation_prompt_enable",
  revision_meta_key: "quality_prompt_revision.translation",
  default_preset_setting_key: "translation_custom_prompt_default_preset",
  store_key: "translation",
  preset_extension: ".txt",
  template_files: Object.freeze(["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"] as const),
} as const);
export type PromptKind = typeof TRANSLATION_PROMPT.store_key;
export const PROMPT_KINDS = [TRANSLATION_PROMPT.store_key] as const;
/** 从公开切片读取正文、启用态与 revision。 */
export function normalize_translation_prompt_slice(value: unknown): TranslationPromptSlice {
  const record = read_json_record(value);
  return {
    text: String(record["text"] ?? ""),
    enabled: Boolean(record["enabled"]),
    revision: Number(record["revision"] ?? 0),
  };
}

export type TranslationPromptSlice = { text: string; enabled: boolean; revision: number };
export type ProjectPrompts = Record<PromptKind, TranslationPromptSlice>;
/** 空会话与无工程快照使用同一完整提示词结构。 */
export function create_empty_project_prompts(): ProjectPrompts {
  return { translation: { text: "", enabled: false, revision: 0 } };
}
