import type { TranslationPromptMode } from "../../../shared/text/translation-output-format";

export type { TranslationPromptMode };

export type TranslationActor = string | null;

/**
 * 译前 pipeline 送入模型的最小行单元，request_index 是响应回填唯一键。
 */
export interface TranslationLine {
  request_index: number;
  item_index: number;
  line_index: number;
  text_src: string;
  actor_src: TranslationActor;
}

/**
 * 响应解码后的译文行，保留模型返回的序号和可选姓名译文。
 */
export interface TranslationDecodedLine {
  request_index: number;
  text_dst: string;
  actor_dst: TranslationActor;
}

export function normalize_translation_actor(value: unknown): TranslationActor {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return null;
}

/**
 * 单次请求内只要存在有效姓名，就整体切换到 actor/text 协议。
 */
export function resolve_translation_prompt_mode(lines: TranslationLine[]): TranslationPromptMode {
  return lines.some((line) => line.actor_src !== null) ? "actor_text" : "text";
}

/**
 * 响应检查和 SakuraLLM 旧提示词只消费正文列表，姓名字段留在 actor/text 协议中。
 */
export function read_translation_text_srcs(lines: TranslationLine[]): string[] {
  return lines.map((line) => line.text_src);
}

export function format_translation_actor(actor: TranslationActor): string {
  return actor === null ? "null" : actor;
}
