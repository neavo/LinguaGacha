import { InvalidTargetLanguageError, UnsupportedAllTargetLanguageError } from "../shared/error";

type CharacterMatcher = (char: string) => boolean;
type TextMatcher = (text: string) => boolean;

/**
 * 集中维护当前模块的稳定常量。
 */
export const ALL_LANGUAGE_CODE = "ALL"; // 特殊值：表示“任意原文语言”（关闭语言过滤）

// 源语言列表不包含繁中变体，避免预过滤把简繁当成可精确区分的源语言
/**
 * 集中维护当前模块的稳定常量。
 */
export const SOURCE_LANGUAGE_CODES = [
  "ZH", // 中文
  "EN", // 英文
  "JA", // 日文
  "KO", // 韩文
  "RU", // 俄文
  "AR", // 阿拉伯文
  "DE", // 德文
  "FR", // 法文
  "PL", // 波兰文
  "ES", // 西班牙文
  "IT", // 意大利文
  "PT", // 葡萄牙文
  "HU", // 匈牙利文
  "TR", // 土耳其文
  "TH", // 泰文
  "ID", // 印尼文
  "VI", // 越南文
] as const;

// 目标语言列表允许繁中作为原生目标，并贴近中文排列，避免在下拉末尾割裂同族语言
/**
 * 集中维护当前模块的稳定常量。
 */
export const TARGET_LANGUAGE_CODES = [
  "ZH", // 中文
  "ZH-HANT", // 中文（繁体）
  "EN", // 英文
  "JA", // 日文
  "KO", // 韩文
  "RU", // 俄文
  "AR", // 阿拉伯文
  "DE", // 德文
  "FR", // 法文
  "PL", // 波兰文
  "ES", // 西班牙文
  "IT", // 意大利文
  "PT", // 葡萄牙文
  "HU", // 匈牙利文
  "TR", // 土耳其文
  "TH", // 泰文
  "ID", // 印尼文
  "VI", // 越南文
] as const;

// 总语言表只服务定义表和 i18n 资源对齐，页面应按源/目标语义选择窄列表
/**
 * 集中维护当前模块的稳定常量。
 */
export const LANGUAGE_CODES = TARGET_LANGUAGE_CODES;

export type SourceLanguageCode = (typeof SOURCE_LANGUAGE_CODES)[number];
export type TargetLanguageCode = (typeof TARGET_LANGUAGE_CODES)[number];
// 额外包含 ALL，用于表示关闭语言限制的配置值
export type LanguageCode = typeof ALL_LANGUAGE_CODE | SourceLanguageCode | TargetLanguageCode;
export type LanguageDisplayLocale = "zh" | "en";
export type LanguageLabelKey = `app.language.${LanguageCode}`;

// 语言定义集中携带 CJK 标记和正文 matcher，调用方不直接拼 Unicode 规则
export type LanguageDefinition = {
  code: LanguageCode;
  cjk: boolean;
  matches_character: CharacterMatcher | null;
  matches_text: TextMatcher | null;
};

// 语言名称与语言码同源维护，UI、提示词和日志都复用这一套“中文/日文”口径
/**
 * 集中维护当前模块的稳定常量。
 */
export const LANGUAGE_DISPLAY_NAMES: Record<
  LanguageCode,
  Readonly<Record<LanguageDisplayLocale, string>>
> = {
  ALL: {
    zh: "全部",
    en: "All",
  },
  ZH: {
    zh: "中文",
    en: "Chinese",
  },
  "ZH-HANT": {
    zh: "中文（繁体）",
    en: "Traditional Chinese",
  },
  EN: {
    zh: "英文",
    en: "English",
  },
  JA: {
    zh: "日文",
    en: "Japanese",
  },
  KO: {
    zh: "韩文",
    en: "Korean",
  },
  RU: {
    zh: "俄文",
    en: "Russian",
  },
  AR: {
    zh: "阿拉伯文",
    en: "Arabic",
  },
  DE: {
    zh: "德文",
    en: "German",
  },
  FR: {
    zh: "法文",
    en: "French",
  },
  PL: {
    zh: "波兰文",
    en: "Polish",
  },
  ES: {
    zh: "西班牙文",
    en: "Spanish",
  },
  IT: {
    zh: "意大利文",
    en: "Italian",
  },
  PT: {
    zh: "葡萄牙文",
    en: "Portuguese",
  },
  HU: {
    zh: "匈牙利文",
    en: "Hungarian",
  },
  TR: {
    zh: "土耳其文",
    en: "Turkish",
  },
  TH: {
    zh: "泰文",
    en: "Thai",
  },
  ID: {
    zh: "印尼文",
    en: "Indonesian",
  },
  VI: {
    zh: "越南文",
    en: "Vietnamese",
  },
};

// 语言标签 key 从语言码计算，避免 UI 手写 i18n key
/**
 * 读取当前场景需要的稳定数据。
 */
export function get_language_label_key(language_code: LanguageCode): LanguageLabelKey {
  return `app.language.${language_code}`;
}

// 应用语言只影响语言显示名本地化，未知值默认回中文
/**
 * 读取当前场景需要的稳定数据。
 */
export function get_language_display_locale(app_language: unknown): LanguageDisplayLocale {
  return String(app_language).trim().toUpperCase() === "EN" ? "en" : "zh";
}

// 展示名统一从语言定义表读取，不在调用点重复维护语言名称
/**
 * 读取当前场景需要的稳定数据。
 */
export function get_language_display_name(
  language_code: LanguageCode,
  locale: LanguageDisplayLocale,
): string {
  return LANGUAGE_DISPLAY_NAMES[language_code][locale];
}

// 源语言允许 ALL 和空值，提示词里表达为泛化的“原文”
/**
 * 读取当前场景需要的稳定数据。
 */
export function get_prompt_source_language_name(
  language_code: LanguageCode | null,
  locale: LanguageDisplayLocale,
): string {
  if (language_code === null || language_code === ALL_LANGUAGE_CODE) {
    return locale === "zh" ? "原文" : "Source";
  }

  return get_language_display_name(language_code, locale);
}

// 目标语言不能是 ALL 或空值，调用方配置损坏时必须显式报错
/**
 * 读取当前场景需要的稳定数据。
 */
export function get_prompt_target_language_name(
  language_code: LanguageCode | null,
  locale: LanguageDisplayLocale,
): string {
  if (language_code === ALL_LANGUAGE_CODE) {
    throw new UnsupportedAllTargetLanguageError();
  }
  if (language_code === null) {
    throw new InvalidTargetLanguageError();
  }

  return get_language_display_name(language_code, locale);
}

const NON_BODY_LANGUAGE_CHARACTER_PATTERN = /[\s\p{N}\p{P}\p{S}\p{M}]/u; // 正文字符先排除空白、数字、标点、符号和组合标记
const NON_STANDALONE_LANGUAGE_MARK_PATTERN = /\p{M}/u; // Unicode Mark 单独存在时只表达附着标记，不构成正文

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u; // Han Script 单字符正文规则，覆盖汉字扩展区和兼容汉字
const HIRAGANA_CHARACTER_PATTERN = /\p{Script=Hiragana}/u; // Hiragana Script 单字符规则，用于平假名残留和剥离
const KATAKANA_CHARACTER_PATTERN = /\p{Script=Katakana}/u; // Katakana Script 单字符规则，包含全角和半角片假名
const HANGUL_CHARACTER_PATTERN = /\p{Script=Hangul}/u; // Hangul Script 单字符规则，用于韩文正文和残留检测
const CYRILLIC_CHARACTER_PATTERN = /\p{Script=Cyrillic}/u; // Cyrillic Script 单字符规则，避免误收 Glagolitic
const ARABIC_CHARACTER_PATTERN = /\p{Script=Arabic}/u; // Arabic Script 单字符规则，数字和符号由正文排除规则剔除
const THAI_CHARACTER_PATTERN = /\p{Script=Thai}/u; // Thai Script 单字符规则，泰文数字不作为正文
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/u; // Latin Script 单字符规则，拉丁语系共享粗过滤

const HAN_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Han}/u; // Han Script 整段命中规则，不带 g 避免 lastIndex 泄漏
const HIRAGANA_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Hiragana}/u; // Hiragana Script 整段命中规则
const KATAKANA_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Katakana}/u; // Katakana Script 整段命中规则
const HANGUL_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Hangul}/u; // Hangul Script 整段命中规则
const CYRILLIC_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Cyrillic}/u; // Cyrillic Script 整段命中规则
const ARABIC_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Arabic}/u; // Arabic Script 整段命中规则
const THAI_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Thai}/u; // Thai Script 整段命中规则
const LATIN_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))\p{Script=Latin}/u; // Latin Script 整段命中规则，非自然语言识别
const JAPANESE_TEXT_PATTERN =
  /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana})/u; // 日文整段规则：Han + Hiragana + Katakana
const KOREAN_TEXT_PATTERN = /(?!(?:[\s\p{N}\p{P}\p{S}\p{M}]))(?:\p{Script=Han}|\p{Script=Hangul})/u; // 韩文整段规则：Han + Hangul

const NON_STANDALONE_LANGUAGE_CHARACTERS = new Set([
  "ー", // 长音符不能独立表达正文，规则预过滤会单独消费
  "・", // 全角中点不能独立表达正文
  "･", // 半角中点不能独立表达正文
  "ﾞ", // 半角浊点不能独立表达正文
  "ﾟ", // 半角半浊点不能独立表达正文
]);

// 单字符正文判断统一收口排除项和 Script 检查，避免各语言分支自行组合
/**
 * 判断当前值是否满足业务条件。
 */
function is_language_body_character(char: string, script_pattern: RegExp): boolean {
  return !NON_BODY_LANGUAGE_CHARACTER_PATTERN.test(char) && script_pattern.test(char);
}

// 全量匹配沿用 Python all 的空字符串真值语义
/**
 * 判断当前值是否满足业务条件。
 */
function all_matching_characters(text: string, matches_character: CharacterMatcher): boolean {
  return [...text].every((char) => matches_character(char));
}

// 首尾剥离只移除边缘非目标字符，中间内容必须原样保留
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function strip_non_matching_characters(text: string, matches_character: CharacterMatcher): string {
  const chars = [...text.trim()];
  let start = 0;
  let end = chars.length - 1;

  while (start <= end && !matches_character(chars[start] ?? "")) {
    start += 1;
  }

  while (end >= start && !matches_character(chars[end] ?? "")) {
    end -= 1;
  }

  return start > end ? "" : chars.slice(start, end + 1).join("");
}

// 汉字正文判断覆盖 Unicode 当前运行时支持的 Han Script，包括扩展区和兼容汉字
/**
 * 判断当前值是否满足业务条件。
 */
function is_han_character(char: string): boolean {
  return is_language_body_character(char, HAN_CHARACTER_PATTERN);
}

// 拉丁语系共享 Latin Script 粗过滤，不区分具体自然语言
/**
 * 判断当前值是否满足业务条件。
 */
function is_latin_character(char: string): boolean {
  return is_language_body_character(char, LATIN_CHARACTER_PATTERN);
}

// 俄文按 Cyrillic Script 判断，避免误收 Glagolitic 等旧手写范围偏差
/**
 * 判断当前值是否满足业务条件。
 */
function is_cyrillic_character(char: string): boolean {
  return is_language_body_character(char, CYRILLIC_CHARACTER_PATTERN);
}

// 阿拉伯文按 Arabic Script 判断，数字和符号由正文排除规则统一剔除
/**
 * 判断当前值是否满足业务条件。
 */
function is_arabic_character(char: string): boolean {
  return is_language_body_character(char, ARABIC_CHARACTER_PATTERN);
}

// 泰文按 Thai Script 判断，泰文数字不再被当作正文字符
/**
 * 判断当前值是否满足业务条件。
 */
function is_thai_character(char: string): boolean {
  return is_language_body_character(char, THAI_CHARACTER_PATTERN);
}

// 谚文正文判断供韩文语言过滤、残留检查和 fixer 共用
/**
 * 判断当前值是否满足业务条件。
 */
export function is_hangul_character(char: string): boolean {
  return is_language_body_character(char, HANGUL_CHARACTER_PATTERN);
}

// 平假名正文判断排除不能独立成文的日文标记
/**
 * 判断当前值是否满足业务条件。
 */
export function is_hiragana_character(char: string): boolean {
  return is_language_body_character(char, HIRAGANA_CHARACTER_PATTERN);
}

// 片假名正文判断支持全角和半角片假名，但不把长音与中点当作正文
/**
 * 判断当前值是否满足业务条件。
 */
export function is_katakana_character(char: string): boolean {
  return is_language_body_character(char, KATAKANA_CHARACTER_PATTERN);
}

// 假名聚合入口供校对和 fixer 复用，不让调用方重复拼平假名/片假名判断
/**
 * 判断当前值是否满足业务条件。
 */
export function is_kana_character(char: string): boolean {
  return is_hiragana_character(char) || is_katakana_character(char);
}

// 非独立语言字符只服务“无正文价值”判断，不能单独触发语言正文命中
/**
 * 判断当前值是否满足业务条件。
 */
export function is_non_standalone_language_character(char: string): boolean {
  return (
    NON_STANDALONE_LANGUAGE_MARK_PATTERN.test(char) || NON_STANDALONE_LANGUAGE_CHARACTERS.has(char)
  );
}

// 中日韩正文字符判断供文本保护等下游语义过滤复用，不暴露正则拼接细节
/**
 * 判断当前值是否满足业务条件。
 */
export function is_cjk_language_character(char: string): boolean {
  return is_han_character(char) || is_kana_character(char) || is_hangul_character(char);
}

// 中日韩正文任意命中入口用于下游排除含自然语言正文的控制段候选
/**
 * 判断当前值是否满足业务条件。
 */
export function has_cjk_language_character(text: string): boolean {
  return JAPANESE_TEXT_PATTERN.test(text) || HANGUL_TEXT_PATTERN.test(text);
}

// 平假名任意命中入口供旧 JA.any_hiragana 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_any_hiragana_character(text: string): boolean {
  return HIRAGANA_TEXT_PATTERN.test(text);
}

// 平假名全量入口供旧 JA.all_hiragana 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_only_hiragana_characters(text: string): boolean {
  return all_matching_characters(text, is_hiragana_character);
}

// 片假名任意命中入口供旧 JA.any_katakana 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_any_katakana_character(text: string): boolean {
  return KATAKANA_TEXT_PATTERN.test(text);
}

// 片假名全量入口供旧 JA.all_katakana 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_only_katakana_characters(text: string): boolean {
  return all_matching_characters(text, is_katakana_character);
}

// 谚文任意命中入口供旧 KO.any_hangeul 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_any_hangul_character(text: string): boolean {
  return HANGUL_TEXT_PATTERN.test(text);
}

// 谚文全量入口供旧 KO.all_hangeul 语义复用
/**
 * 判断当前值是否满足业务条件。
 */
export function has_only_hangul_characters(text: string): boolean {
  return all_matching_characters(text, is_hangul_character);
}

// 日文允许汉字或假名命中，符合原文混排的常见场景
/**
 * 判断当前值是否满足业务条件。
 */
function is_ja_character(char: string): boolean {
  return is_han_character(char) || is_kana_character(char);
}

// 韩文允许汉字或谚文命中，兼容含汉字词的韩文本地化文本
/**
 * 判断当前值是否满足业务条件。
 */
function is_ko_character(char: string): boolean {
  return is_han_character(char) || is_hangul_character(char);
}

// 定义表构造器保证单字符判断和整段命中规则成对登记
/**
 * 构建当前场景的稳定结果。
 */
function build_definition(
  code: LanguageCode,
  cjk: boolean,
  matches_character: CharacterMatcher | null,
  text_pattern: RegExp | null,
): LanguageDefinition {
  return {
    code,
    cjk,
    matches_character,
    matches_text: text_pattern === null ? null : (text) => text_pattern.test(text),
  };
}

// 语言定义是运行态唯一正文规则表；拉丁语系只做 Latin Script 粗过滤，不做自然语言识别
/**
 * 集中维护当前模块的稳定常量。
 */
export const LANGUAGE_DEFINITIONS: Record<LanguageCode, LanguageDefinition> = {
  ALL: build_definition("ALL", false, null, null), // 关闭语言过滤
  ZH: build_definition("ZH", true, is_han_character, HAN_TEXT_PATTERN), // 中文只以 Han Script 正文命中
  "ZH-HANT": build_definition("ZH-HANT", true, is_han_character, HAN_TEXT_PATTERN), // 繁中复用 Han Script，不按字符范围区分简繁
  EN: build_definition("EN", false, is_latin_character, LATIN_TEXT_PATTERN), // 英文走 Latin Script 粗过滤
  JA: build_definition("JA", true, is_ja_character, JAPANESE_TEXT_PATTERN), // 日文允许 Han + Kana 混排
  KO: build_definition("KO", true, is_ko_character, KOREAN_TEXT_PATTERN), // 韩文允许 Han + Hangul 混排
  RU: build_definition("RU", false, is_cyrillic_character, CYRILLIC_TEXT_PATTERN), // 俄文走 Cyrillic Script
  AR: build_definition("AR", false, is_arabic_character, ARABIC_TEXT_PATTERN), // 阿拉伯文走 Arabic Script
  DE: build_definition("DE", false, is_latin_character, LATIN_TEXT_PATTERN), // 德文走 Latin Script 粗过滤
  FR: build_definition("FR", false, is_latin_character, LATIN_TEXT_PATTERN), // 法文走 Latin Script 粗过滤
  PL: build_definition("PL", false, is_latin_character, LATIN_TEXT_PATTERN), // 波兰文走 Latin Script 粗过滤
  ES: build_definition("ES", false, is_latin_character, LATIN_TEXT_PATTERN), // 西班牙文走 Latin Script 粗过滤
  IT: build_definition("IT", false, is_latin_character, LATIN_TEXT_PATTERN), // 意大利文走 Latin Script 粗过滤
  PT: build_definition("PT", false, is_latin_character, LATIN_TEXT_PATTERN), // 葡萄牙文走 Latin Script 粗过滤
  HU: build_definition("HU", false, is_latin_character, LATIN_TEXT_PATTERN), // 匈牙利文走 Latin Script 粗过滤
  TR: build_definition("TR", false, is_latin_character, LATIN_TEXT_PATTERN), // 土耳其文走 Latin Script 粗过滤
  TH: build_definition("TH", false, is_thai_character, THAI_TEXT_PATTERN), // 泰文走 Thai Script，泰文数字不算正文
  ID: build_definition("ID", false, is_latin_character, LATIN_TEXT_PATTERN), // 印尼文走 Latin Script 粗过滤
  VI: build_definition("VI", false, is_latin_character, LATIN_TEXT_PATTERN), // 越南文走 Latin Script 粗过滤
};

/**
 * 集中维护当前模块的稳定常量。
 */
export const CJK_LANGUAGE_CODES = new Set<LanguageCode>(["ZH", "ZH-HANT", "JA", "KO"]); // CJK 语言集合供 UI 和规则分支快速判断，不重复解释字符范围

// 语言码入口统一大小写与空白处理，未知值显式返回 null
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function normalize_language_code(value: string): LanguageCode | null {
  const normalized_value = value.trim().toUpperCase();
  if (normalized_value in LANGUAGE_DEFINITIONS) {
    return normalized_value as LanguageCode;
  }

  return null;
}

// 判断语言族时必须先归一化，避免小写配置让 CJK 分支失效
/**
 * 判断当前值是否满足业务条件。
 */
export function is_cjk_language_code(value: string): boolean {
  const language_code = normalize_language_code(value);
  return language_code !== null && CJK_LANGUAGE_CODES.has(language_code);
}

// 文本语言命中入口，ALL 语言永远返回 true 表示不过滤
/**
 * 判断当前值是否满足业务条件。
 */
export function has_language_character(text: string, language_code: LanguageCode): boolean {
  const matches_text = LANGUAGE_DEFINITIONS[language_code].matches_text;
  if (matches_text === null) {
    return true;
  }

  return matches_text(text);
}

// 单字符语言判断入口对齐历史 TextBase.char
/**
 * 判断当前值是否满足业务条件。
 */
export function is_language_character(char: string, language_code: LanguageCode): boolean {
  const matches_character = LANGUAGE_DEFINITIONS[language_code].matches_character;
  if (matches_character === null) {
    return true;
  }

  return matches_character(char);
}

// 全量语言判断入口对齐历史 TextBase.all
/**
 * 判断当前值是否满足业务条件。
 */
export function all_language_characters(text: string, language_code: LanguageCode): boolean {
  const matches_character = LANGUAGE_DEFINITIONS[language_code].matches_character;
  if (matches_character === null) {
    return true;
  }

  return all_matching_characters(text, matches_character);
}

// 语言边缘剥离入口对齐历史 TextBase.strip_non_target
/**
 * 归一化输入，保证下游消费稳定形状。
 */
export function strip_non_language_characters(text: string, language_code: LanguageCode): string {
  const matches_character = LANGUAGE_DEFINITIONS[language_code].matches_character;
  if (matches_character === null) {
    return text.trim();
  }

  return strip_non_matching_characters(text, matches_character);
}
