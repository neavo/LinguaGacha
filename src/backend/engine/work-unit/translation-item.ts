import type { TranslationPromptMode } from "../../../shared/text/translation-output-format";

export type { TranslationPromptMode };

export type TranslationActor = string | null;

/** One request record; item_index is worker-local and never enters the LLM protocol. */
export interface TranslationRequestItem {
  request_index: number; // Stable key echoed by the model for response alignment.
  item_index: number; // Worker-local index used to write back the original item.
  text_src: string; // Complete item text; embedded line breaks stay inside this string.
  actor_src: TranslationActor; // Optional source name included only in actor mode.
}

/** One decoded response record. */
export interface TranslationDecodedItem {
  request_index: number; // Echoed request key; unknown keys are ignored by the runner.
  text_dst: string; // Complete model text, including any internal line breaks.
  actor_dst: TranslationActor; // Optional translated name from actor mode.
}

/** Normalizes optional actor text so malformed model values never become names. */
export function normalize_translation_actor(value: unknown): TranslationActor {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Uses actor mode for the whole request when any item carries a source name. */
export function resolve_translation_prompt_mode(
  items: TranslationRequestItem[],
): TranslationPromptMode {
  return items.some((item) => item.actor_src !== null) ? "actor_text" : "text";
}
