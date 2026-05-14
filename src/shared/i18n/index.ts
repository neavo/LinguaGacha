import { en_us_messages, zh_cn_messages } from "./messages";
import type { Locale, LocaleMessageSchema } from "./types";

type JoinPath<prefix extends string, key extends string> = prefix extends ""
  ? key
  : `${prefix}.${key}`;

type NestedMessageKey<tree, prefix extends string = ""> = {
  [key in keyof tree & string]: tree[key] extends string
    ? JoinPath<prefix, key>
    : tree[key] extends object
      ? NestedMessageKey<tree[key], JoinPath<prefix, key>>
      : never;
}[keyof tree & string];

type LocaleMessages = LocaleMessageSchema<typeof zh_cn_messages>;

export type LocaleKey = NestedMessageKey<LocaleMessages>;
export type TextResolver = (key: LocaleKey, params?: Record<string, string>) => string;

function flatten_message_map(
  message_tree: Record<string, unknown>,
  message_map: Map<string, string>,
  path_prefix: string,
): void {
  for (const [entry_key, entry_value] of Object.entries(message_tree)) {
    const next_path = path_prefix === "" ? entry_key : `${path_prefix}.${entry_key}`;

    if (typeof entry_value === "string") {
      message_map.set(next_path, entry_value);
    } else if (typeof entry_value === "object" && entry_value !== null) {
      flatten_message_map(entry_value as Record<string, unknown>, message_map, next_path);
    }
  }
}

function build_message_map(messages: LocaleMessages): ReadonlyMap<LocaleKey, string> {
  const message_map: Map<string, string> = new Map();
  flatten_message_map(messages as Record<string, unknown>, message_map, "");
  return message_map as ReadonlyMap<LocaleKey, string>;
}

function read_message_value(message_map: ReadonlyMap<LocaleKey, string>, key: LocaleKey): string {
  const message_value = message_map.get(key);
  return message_value ?? key;
}

function interpolate_message(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [key, value]) => {
    return text.replaceAll(`{${key}}`, value);
  }, template);
}

export function resolve_i18n_locale(app_language: unknown): Locale {
  return String(app_language).trim().toUpperCase() === "EN" ? "en-US" : "zh-CN";
}

export const MESSAGE_MAP_BY_LOCALE: Readonly<Record<Locale, ReadonlyMap<LocaleKey, string>>> = {
  "zh-CN": build_message_map(zh_cn_messages),
  "en-US": build_message_map(en_us_messages),
};

export function format_i18n_message(
  locale: Locale,
  key: LocaleKey,
  params: Record<string, string> = {},
): string {
  return interpolate_message(read_message_value(MESSAGE_MAP_BY_LOCALE[locale], key), params);
}

export function create_text_resolver(locale: Locale): TextResolver {
  return (key, params) => format_i18n_message(locale, key, params);
}

export type { Locale, LocaleMessageSchema } from "./types";
