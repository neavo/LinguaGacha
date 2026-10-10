import { read_json_record } from "./json";
import { Type, type Static } from "typebox";
import { PROJECT_REVISION_SCHEMA, read_project_revision } from "./project-revision";

export const TRANSLATION_PROMPT_SLICE_SCHEMA = Type.Object({
  text: Type.Union([Type.String(), Type.Null()], {
    description: "用户覆盖正文。null 使用当前内置模板，空字符串表示显式空正文。",
  }),
  enabled: Type.Boolean(), // 是否采用自定义翻译提示词。
  revision: PROJECT_REVISION_SCHEMA, // 工程提示词内容与启用态的修订号。
});
export type TranslationPromptSlice = Static<typeof TRANSLATION_PROMPT_SLICE_SCHEMA>;
const EMPTY_TRANSLATION_PROMPT_SLICE: Readonly<TranslationPromptSlice> = Object.freeze({
  text: null,
  enabled: false,
  revision: 0,
});
/** 翻译提示词资源与持久化槽位的唯一描述。 */
export const TRANSLATION_PROMPT = Object.freeze({
  database_type: "translation_prompt", // 正文在 `rules` 表中的存储类型。
  directory_name: "translation_prompt", // 提示词预设目录名。
  enabled_meta_key: "translation_prompt_enable", // 工程启用态的 meta 键。
  revision_meta_key: "quality_prompt_revision.translation", // 工程提示词修订的 meta 键。
  default_preset_setting_key: "translation_custom_prompt_default_preset", // 默认预设引用的应用设置键。
  store_key: "translation", // 公开提示词切片标识。
  preset_extension: ".txt", // 提示词预设文件扩展名。
  template_files: Object.freeze(["base.txt", "prefix.txt", "thinking.txt", "suffix.txt"] as const), // 内置模板片段文件名。
} as const);
export type PromptKind = typeof TRANSLATION_PROMPT.store_key;
export const PROMPT_KINDS = [TRANSLATION_PROMPT.store_key] as const;
/** 从公开切片读取正文、启用态与 revision。 */
export function normalize_translation_prompt_slice(value: unknown): TranslationPromptSlice {
  const record = read_json_record(value);
  return {
    text: record["text"] == null ? null : String(record["text"]),
    enabled: Boolean(record["enabled"] ?? EMPTY_TRANSLATION_PROMPT_SLICE.enabled),
    revision: read_project_revision(record["revision"]),
  };
}

const PROJECT_PROMPTS_SCHEMA = Type.Object({
  [TRANSLATION_PROMPT.store_key]: TRANSLATION_PROMPT_SLICE_SCHEMA,
});
export type ProjectPrompts = Static<typeof PROJECT_PROMPTS_SCHEMA>;
/** 空会话与无工程快照使用同一完整提示词结构。 */
export function create_empty_project_prompts(): ProjectPrompts {
  return { translation: { ...EMPTY_TRANSLATION_PROMPT_SLICE } };
}
