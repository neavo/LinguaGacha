import { AppError } from "../shared/error";

type CharacterMatcher = (char: string) => boolean;

const WRITING_SYSTEM_CODES = [
  "HAN",
  "KANA",
  "HANGUL",
  "LATIN",
  "CYRILLIC",
  "ARABIC",
  "THAI",
] as const;
type WritingSystemCode = (typeof WRITING_SYSTEM_CODES)[number];

type WritingSystemDefinition = {
  matches_body_character: CharacterMatcher;
  matches_auxiliary_character: CharacterMatcher;
};

export const ALL_LANGUAGE_CODE = "ALL"; // 特殊值：表示“任意原文语言”（关闭语言过滤）

// 源语言列表不包含繁中变体，避免预过滤把简繁当成可精确区分的源语言
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
export const LANGUAGE_CODES = TARGET_LANGUAGE_CODES;

export type SourceLanguageCode = (typeof SOURCE_LANGUAGE_CODES)[number];
export type TargetLanguageCode = (typeof TARGET_LANGUAGE_CODES)[number];
export type ConfiguredSourceLanguageCode = typeof ALL_LANGUAGE_CODE | SourceLanguageCode;
// 额外包含 ALL，用于表示关闭语言限制的配置值
export type LanguageCode = typeof ALL_LANGUAGE_CODE | SourceLanguageCode | TargetLanguageCode;
export type LanguageDisplayLocale = "zh" | "en" | "de";

// 语言定义只声明允许的书写系统，字符分类统一由书写系统词表负责。
export type LanguageGraphemeClassification = "allowed" | "residue" | "neutral";

// 语言名称与语言码同源维护，UI、提示词和日志都复用这一套“中文/日文”口径
export const LANGUAGE_DISPLAY_NAMES: Record<
  LanguageCode,
  Readonly<Record<LanguageDisplayLocale, string>>
> = {
  ALL: {
    zh: "全部",
    en: "All",
    de: "Alle",
  },
  ZH: {
    zh: "中文",
    en: "Chinese",
    de: "Chinesisch",
  },
  "ZH-HANT": {
    zh: "中文（繁体）",
    en: "Traditional Chinese",
    de: "Chinesisch (traditionell)",
  },
  EN: {
    zh: "英文",
    en: "English",
    de: "Englisch",
  },
  JA: {
    zh: "日文",
    en: "Japanese",
    de: "Japanisch",
  },
  KO: {
    zh: "韩文",
    en: "Korean",
    de: "Koreanisch",
  },
  RU: {
    zh: "俄文",
    en: "Russian",
    de: "Russisch",
  },
  AR: {
    zh: "阿拉伯文",
    en: "Arabic",
    de: "Arabisch",
  },
  DE: {
    zh: "德文",
    en: "German",
    de: "Deutsch",
  },
  FR: {
    zh: "法文",
    en: "French",
    de: "Französisch",
  },
  PL: {
    zh: "波兰文",
    en: "Polish",
    de: "Polnisch",
  },
  ES: {
    zh: "西班牙文",
    en: "Spanish",
    de: "Spanisch",
  },
  IT: {
    zh: "意大利文",
    en: "Italian",
    de: "Italienisch",
  },
  PT: {
    zh: "葡萄牙文",
    en: "Portuguese",
    de: "Portugiesisch",
  },
  HU: {
    zh: "匈牙利文",
    en: "Hungarian",
    de: "Ungarisch",
  },
  TR: {
    zh: "土耳其文",
    en: "Turkish",
    de: "Türkisch",
  },
  TH: {
    zh: "泰文",
    en: "Thai",
    de: "Thailändisch",
  },
  ID: {
    zh: "印尼文",
    en: "Indonesian",
    de: "Indonesisch",
  },
  VI: {
    zh: "越南文",
    en: "Vietnamese",
    de: "Vietnamesisch",
  },
};

// 展示名统一从语言定义表读取，不在调用点重复维护语言名称
export function get_language_display_name(
  language_code: LanguageCode,
  locale: LanguageDisplayLocale,
): string {
  return LANGUAGE_DISPLAY_NAMES[language_code][locale];
}

// 源语言允许 ALL 和空值，提示词里表达为泛化的“原文”
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
export function get_prompt_target_language_name(
  language_code: LanguageCode | null,
  locale: LanguageDisplayLocale,
): string {
  if (language_code === ALL_LANGUAGE_CODE) {
    throw new AppError("language.unsupported_all_target_language");
  }
  if (language_code === null) {
    throw new AppError("language.invalid_target_language");
  }

  return get_language_display_name(language_code, locale);
}

const LETTER_CHARACTER_PATTERN = /\p{L}/u;
const MARK_CHARACTER_PATTERN = /\p{M}/u;
const COMMON_OR_INHERITED_SCRIPT_PATTERN = /(?:\p{Script=Common}|\p{Script=Inherited})/u;
const HAN_SCRIPT_PATTERN = /\p{Script_Extensions=Han}/u;
const HIRAGANA_SCRIPT_PATTERN = /\p{Script_Extensions=Hiragana}/u;
const KATAKANA_SCRIPT_PATTERN = /\p{Script_Extensions=Katakana}/u;
const HANGUL_SCRIPT_PATTERN = /\p{Script_Extensions=Hangul}/u;
const LATIN_SCRIPT_PATTERN = /\p{Script_Extensions=Latin}/u;
const CYRILLIC_SCRIPT_PATTERN = /\p{Script_Extensions=Cyrillic}/u;
const ARABIC_SCRIPT_PATTERN = /\p{Script_Extensions=Arabic}/u;
const THAI_SCRIPT_PATTERN = /\p{Script_Extensions=Thai}/u;

// 这些字符属于假名书写系统，但不能独立证明一段文本含有日文正文。
const KANA_AUXILIARY_CHARACTERS = new Set([
  "゙",
  "゚",
  "゛",
  "゜",
  "ー",
  "〱",
  "〲",
  "〳",
  "〴",
  "〵",
  "ｰ",
  "ﾞ",
  "ﾟ",
]);
const ARABIC_AUXILIARY_CHARACTERS = new Set(["ـ"]); // Tatweel 是 Common Script 的阿拉伯书写延长线

/** Script_Extensions 只在字符本身是正文 Letter 时成立，附属字符由独立 matcher 处理。 */
function matches_script_letter(
  character: string,
  script_pattern: RegExp,
  excluded_characters?: ReadonlySet<string>,
): boolean {
  return (
    LETTER_CHARACTER_PATTERN.test(character) &&
    script_pattern.test(character) &&
    !(excluded_characters?.has(character) ?? false)
  );
}

const WRITING_SYSTEM_DEFINITIONS: Readonly<Record<WritingSystemCode, WritingSystemDefinition>> =
  Object.freeze({
    HAN: {
      matches_body_character: (character) => matches_script_letter(character, HAN_SCRIPT_PATTERN),
      matches_auxiliary_character: () => false,
    },
    KANA: {
      matches_body_character: (character) =>
        matches_script_letter(character, HIRAGANA_SCRIPT_PATTERN, KANA_AUXILIARY_CHARACTERS) ||
        matches_script_letter(character, KATAKANA_SCRIPT_PATTERN, KANA_AUXILIARY_CHARACTERS),
      matches_auxiliary_character: (character) => KANA_AUXILIARY_CHARACTERS.has(character),
    },
    HANGUL: {
      matches_body_character: (character) =>
        matches_script_letter(character, HANGUL_SCRIPT_PATTERN),
      matches_auxiliary_character: (character) =>
        MARK_CHARACTER_PATTERN.test(character) && HANGUL_SCRIPT_PATTERN.test(character),
    },
    LATIN: {
      matches_body_character: (character) => matches_script_letter(character, LATIN_SCRIPT_PATTERN),
      matches_auxiliary_character: () => false,
    },
    CYRILLIC: {
      matches_body_character: (character) =>
        matches_script_letter(character, CYRILLIC_SCRIPT_PATTERN),
      matches_auxiliary_character: () => false,
    },
    ARABIC: {
      matches_body_character: (character) =>
        matches_script_letter(character, ARABIC_SCRIPT_PATTERN, ARABIC_AUXILIARY_CHARACTERS),
      matches_auxiliary_character: (character) =>
        ARABIC_AUXILIARY_CHARACTERS.has(character) ||
        (MARK_CHARACTER_PATTERN.test(character) && ARABIC_SCRIPT_PATTERN.test(character)),
    },
    THAI: {
      matches_body_character: (character) => matches_script_letter(character, THAI_SCRIPT_PATTERN),
      matches_auxiliary_character: (character) =>
        MARK_CHARACTER_PATTERN.test(character) && THAI_SCRIPT_PATTERN.test(character),
    },
  });

// 语言定义是语言与书写系统关系的唯一事实；共享文字由多个语言直接引用同一系统。
const LANGUAGE_WRITING_SYSTEMS: Readonly<Record<LanguageCode, readonly WritingSystemCode[]>> = {
  ALL: [],
  ZH: ["HAN"],
  "ZH-HANT": ["HAN"],
  EN: ["LATIN"],
  JA: ["HAN", "KANA"],
  KO: ["HAN", "HANGUL"],
  RU: ["CYRILLIC"],
  AR: ["ARABIC"],
  DE: ["LATIN"],
  FR: ["LATIN"],
  PL: ["LATIN"],
  ES: ["LATIN"],
  IT: ["LATIN"],
  PT: ["LATIN"],
  HU: ["LATIN"],
  TR: ["LATIN"],
  TH: ["THAI"],
  ID: ["LATIN"],
  VI: ["LATIN"],
};

const CJK_WRITING_SYSTEMS = new Set<WritingSystemCode>(["HAN", "KANA", "HANGUL"]);

/** Script_Extensions 可同时属于多个书写系统，调用方据此判断与目标语言是否有交集。 */
function matching_writing_systems(
  character: string,
  matcher: keyof WritingSystemDefinition,
): WritingSystemCode[] {
  return WRITING_SYSTEM_CODES.filter((code) =>
    WRITING_SYSTEM_DEFINITIONS[code][matcher](character),
  );
}

/** 字符命中的任一书写系统被目标语言接受，即视为允许。 */
function is_character_allowed_by_writing_systems(
  character: string,
  writing_systems: readonly WritingSystemCode[],
  matcher: keyof WritingSystemDefinition,
): boolean {
  return matching_writing_systems(character, matcher).some((code) =>
    writing_systems.includes(code),
  );
}

// 中日韩正文任意命中入口用于下游排除含自然语言正文的控制段候选。
export function has_cjk_language_character(text: string): boolean {
  return [...text].some(
    (character) =>
      WRITING_SYSTEM_DEFINITIONS.HAN.matches_body_character(character) ||
      WRITING_SYSTEM_DEFINITIONS.KANA.matches_body_character(character) ||
      WRITING_SYSTEM_DEFINITIONS.HANGUL.matches_body_character(character),
  );
}

/**
 * 任意书写系统的正文字符都能证明文本具有语言内容；Common / Inherited 附属字符不能独立成文。
 */
export function has_language_body_character(text: string): boolean {
  return [...text].some((character) => {
    if (matching_writing_systems(character, "matches_body_character").length > 0) {
      return true;
    }
    return (
      LETTER_CHARACTER_PATTERN.test(character) &&
      !COMMON_OR_INHERITED_SCRIPT_PATTERN.test(character)
    );
  });
}

// 语言码入口统一大小写与空白处理，未知值显式返回 null
export function normalize_language_code(value: string): LanguageCode | null {
  const normalized_value = value.trim().toUpperCase();
  if (normalized_value in LANGUAGE_WRITING_SYSTEMS) {
    return normalized_value as LanguageCode;
  }

  return null;
}

/** 源语言接受 ALL，但拒绝仅供目标侧使用的繁中变体。 */
export function normalize_source_language_code(value: string): ConfiguredSourceLanguageCode | null {
  const language_code = normalize_language_code(value);
  return language_code !== null &&
    (language_code === ALL_LANGUAGE_CODE ||
      (SOURCE_LANGUAGE_CODES as readonly LanguageCode[]).includes(language_code))
    ? (language_code as ConfiguredSourceLanguageCode)
    : null;
}

/** 目标语言必须来自目标词表，因而不接受 ALL。 */
export function normalize_target_language_code(value: string): TargetLanguageCode | null {
  const language_code = normalize_language_code(value);
  return language_code !== null &&
    (TARGET_LANGUAGE_CODES as readonly LanguageCode[]).includes(language_code)
    ? (language_code as TargetLanguageCode)
    : null;
}

// 判断语言族时必须先归一化，避免小写配置让 CJK 分支失效
export function is_cjk_language_code(value: string): boolean {
  const language_code = normalize_language_code(value);
  return (
    language_code !== null &&
    LANGUAGE_WRITING_SYSTEMS[language_code].some((code) => CJK_WRITING_SYSTEMS.has(code))
  );
}

// 文本语言命中入口，ALL 语言永远返回 true 表示不过滤
export function has_language_character(text: string, language_code: LanguageCode): boolean {
  return (
    language_code === ALL_LANGUAGE_CODE ||
    [...text].some((character) => is_language_character(character, language_code))
  );
}

// 单字符语言判断入口对齐历史 TextBase.char
export function is_language_character(character: string, language_code: LanguageCode): boolean {
  if (language_code === ALL_LANGUAGE_CODE) {
    return true;
  }

  const writing_systems = LANGUAGE_WRITING_SYSTEMS[language_code];
  return is_character_allowed_by_writing_systems(
    character,
    writing_systems,
    "matches_body_character",
  );
}

/**
 * 字素簇只回答目标语言是否允许；通用标点、符号、组合标记和格式字符保持中性。
 */
export function classify_language_grapheme(
  grapheme: string,
  language_code: TargetLanguageCode,
): LanguageGraphemeClassification {
  const writing_systems = LANGUAGE_WRITING_SYSTEMS[language_code];
  let contains_allowed_language_element = false;

  for (const character of grapheme) {
    const body_systems = matching_writing_systems(character, "matches_body_character");
    if (body_systems.length > 0) {
      if (!body_systems.some((code) => writing_systems.includes(code))) {
        return "residue";
      }
      contains_allowed_language_element = true;
      continue;
    }

    const auxiliary_systems = matching_writing_systems(character, "matches_auxiliary_character");
    if (auxiliary_systems.length > 0) {
      if (!auxiliary_systems.some((code) => writing_systems.includes(code))) {
        return "residue";
      }
      contains_allowed_language_element = true;
      continue;
    }

    // 未登记但明确属于其它 Script 的字母也属于非目标文字；Common / Inherited 保持中性。
    if (
      LETTER_CHARACTER_PATTERN.test(character) &&
      !COMMON_OR_INHERITED_SCRIPT_PATTERN.test(character)
    ) {
      return "residue";
    }
  }

  return contains_allowed_language_element ? "allowed" : "neutral";
}
