import { zh_cn_messages } from "./resources/zh-CN";
import { en_us_messages } from "./resources/en-US";
import { de_de_messages } from "./resources/de-DE";
import { ja_jp_messages } from "./resources/ja-JP";
import { ko_kr_messages } from "./resources/ko-KR";
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

/** 将按页面组织的词典展开为调用方使用的点分键。 */
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

/** 在词典入口收口动态遍历与静态消息键类型的转换。 */
function build_message_map(messages: LocaleMessages): ReadonlyMap<LocaleKey, string> {
  const message_map: Map<string, string> = new Map();
  flatten_message_map(messages as Record<string, unknown>, message_map, "");
  return message_map as ReadonlyMap<LocaleKey, string>;
}

export const MESSAGE_MAP_BY_LOCALE: Readonly<Record<Locale, ReadonlyMap<LocaleKey, string>>> = {
  "zh-CN": build_message_map(zh_cn_messages),
  "en-US": build_message_map(en_us_messages),
  "de-DE": build_message_map(de_de_messages),
  "ja-JP": build_message_map(ja_jp_messages),
  "ko-KR": build_message_map(ko_kr_messages),
};

/** 解析消息并替换已提供的参数；缺失消息以键名暴露诊断线索。 */
export function format_i18n_message(
  locale: Locale,
  key: LocaleKey,
  params: Record<string, string> = {},
): string {
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    MESSAGE_MAP_BY_LOCALE[locale].get(key) ?? key,
  );
}

/** 将调用方的语言快照绑定到统一消息解析入口。 */
export function create_text_resolver(locale: Locale): TextResolver {
  return (key, params) => format_i18n_message(locale, key, params);
}

export { LOCALES, type Locale, type LocaleMessageSchema } from "./types";
