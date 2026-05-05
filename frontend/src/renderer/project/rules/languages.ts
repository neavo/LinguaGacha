type CodePointRange = readonly [number, number];
type CharacterMatcher = (char: string) => boolean;

// 特殊值：表示“任意原文语言”（关闭语言过滤）。
export const ALL_LANGUAGE_CODE = "ALL";

export const SOURCE_TARGET_LANGUAGE_CODES = [
  "ZH", // 中文 (Chinese)
  "EN", // 英文 (English)
  "JA", // 日文 (Japanese)
  "KO", // 韩文 (Korean)
  "RU", // 俄文 (Russian)
  "AR", // 阿拉伯文 (Arabic)
  "DE", // 德文 (German)
  "FR", // 法文 (French)
  "PL", // 波兰文 (Polish)
  "ES", // 西班牙文 (Spanish)
  "IT", // 意大利文 (Italian)
  "PT", // 葡萄牙文 (Portuguese)
  "HU", // 匈牙利文 (Hungarian)
  "TR", // 土耳其文 (Turkish)
  "TH", // 泰文 (Thai)
  "ID", // 印尼文 (Indonesian)
  "VI", // 越南文 (Vietnamese)
] as const;

export type SourceTargetLanguageCode = (typeof SOURCE_TARGET_LANGUAGE_CODES)[number];
export type LanguageCode = typeof ALL_LANGUAGE_CODE | SourceTargetLanguageCode;

export type LanguageDefinition = {
  code: LanguageCode;
  cjk: boolean;
  matches_character: CharacterMatcher | null;
};

// 这些字符范围对齐 Python TextBase，用于前端预过滤，不替代后端完整文本处理。
const CJK_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
];

const LATIN_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0041, 0x005a],
  [0x0061, 0x007a],
  [0x00c0, 0x00ff],
  [0x0100, 0x017f],
  [0x0180, 0x024f],
];

const HANGUL_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x1100, 0x11ff],
  [0xa960, 0xa97f],
  [0xd7b0, 0xd7ff],
  [0xac00, 0xd7af],
  [0x3130, 0x318f],
];

const HIRAGANA_CHARACTER_RANGES: readonly CodePointRange[] = [[0x3040, 0x309f]];
const HIRAGANA_EXCLUDED_CODE_POINTS = new Set([0x309b, 0x309c]);

const KATAKANA_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x30a0, 0x30ff],
  [0x31f0, 0x31ff],
  [0xff65, 0xff9f],
];
const KATAKANA_EXCLUDED_CODE_POINTS = new Set([0xff65, 0x30fb, 0x30fc]);

const RU_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0410, 0x044f],
  [0x0500, 0x052f],
  [0x2c00, 0x2c5f],
  [0xa640, 0xa69f],
  [0x1c80, 0x1c8f],
  [0x2de0, 0x2dff],
];

const AR_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

const TH_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0e00, 0x0e7f],
  [0x0e50, 0x0e59],
];

const VI_CHARACTER_RANGES: readonly CodePointRange[] = [[0x1ea0, 0x1ef9]];

const DE_EXTRA_CHARACTERS = new Set(["Ä", "Ö", "Ü", "ä", "ö", "ü", "ß"]);
const FR_EXTRA_CHARACTERS = new Set([
  "à",
  "á",
  "â",
  "ä",
  "ç",
  "é",
  "è",
  "ê",
  "ë",
  "î",
  "ï",
  "ô",
  "ö",
  "ù",
  "û",
  "ü",
  "ÿ",
  "œ",
  "Œ",
]);
const PL_EXTRA_CHARACTERS = new Set([
  "ą",
  "ć",
  "ę",
  "ł",
  "ń",
  "ó",
  "ś",
  "ź",
  "ż",
  "Ą",
  "Ć",
  "Ę",
  "Ł",
  "Ń",
  "Ó",
  "Ś",
  "Ź",
  "Ż",
]);
const ES_EXTRA_CHARACTERS = new Set(["ñ", "á", "é", "í", "ó", "ú", "ü"]);
const IT_EXTRA_CHARACTERS = new Set(["à", "è", "é", "ì", "ò", "ù"]);
const PT_EXTRA_CHARACTERS = new Set(["á", "é", "í", "ó", "ú", "ã", "õ", "à", "â", "ê", "ô", "ç"]);
const HU_EXTRA_CHARACTERS = new Set(["á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű"]);
const TR_EXTRA_CHARACTERS = new Set(["Ç", "ç", "Ğ", "ğ", "İ", "ı", "Ö", "ö", "Ş", "ş", "Ü", "ü"]);

function code_point(char: string): number | null {
  return char.codePointAt(0) ?? null;
}

function is_code_point_in_ranges(char: string, ranges: readonly CodePointRange[]): boolean {
  const value = code_point(char);
  if (value === null) {
    return false;
  }

  return ranges.some(([start, end]) => value >= start && value <= end);
}

function is_code_point_excluded(char: string, excluded_code_points: ReadonlySet<number>): boolean {
  const value = code_point(char);
  return value !== null && excluded_code_points.has(value);
}

function has_matching_character(text: string, matches_character: CharacterMatcher): boolean {
  for (const char of text) {
    if (matches_character(char)) {
      return true;
    }
  }

  return false;
}

function is_cjk_character(char: string): boolean {
  return is_code_point_in_ranges(char, CJK_CHARACTER_RANGES);
}

function is_latin_character(char: string): boolean {
  return is_code_point_in_ranges(char, LATIN_CHARACTER_RANGES);
}

function is_hangul_character(char: string): boolean {
  return is_code_point_in_ranges(char, HANGUL_CHARACTER_RANGES);
}

function is_hiragana_character(char: string): boolean {
  return (
    is_code_point_in_ranges(char, HIRAGANA_CHARACTER_RANGES) &&
    !is_code_point_excluded(char, HIRAGANA_EXCLUDED_CODE_POINTS)
  );
}

function is_katakana_character(char: string): boolean {
  return (
    is_code_point_in_ranges(char, KATAKANA_CHARACTER_RANGES) &&
    !is_code_point_excluded(char, KATAKANA_EXCLUDED_CODE_POINTS)
  );
}

function is_ja_character(char: string): boolean {
  return is_cjk_character(char) || is_hiragana_character(char) || is_katakana_character(char);
}

function is_ko_character(char: string): boolean {
  return is_cjk_character(char) || is_hangul_character(char);
}

function is_latin_or_extra_character(char: string, extra_characters: ReadonlySet<string>): boolean {
  return is_latin_character(char) || extra_characters.has(char);
}

export const LANGUAGE_DEFINITIONS: Record<LanguageCode, LanguageDefinition> = {
  ALL: {
    code: "ALL",
    cjk: false,
    matches_character: null,
  },
  ZH: {
    code: "ZH",
    cjk: true,
    matches_character: is_cjk_character,
  },
  EN: {
    code: "EN",
    cjk: false,
    matches_character: is_latin_character,
  },
  JA: {
    code: "JA",
    cjk: true,
    matches_character: is_ja_character,
  },
  KO: {
    code: "KO",
    cjk: true,
    matches_character: is_ko_character,
  },
  RU: {
    code: "RU",
    cjk: false,
    matches_character: (char) => is_code_point_in_ranges(char, RU_CHARACTER_RANGES),
  },
  AR: {
    code: "AR",
    cjk: false,
    matches_character: (char) => is_code_point_in_ranges(char, AR_CHARACTER_RANGES),
  },
  DE: {
    code: "DE",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, DE_EXTRA_CHARACTERS),
  },
  FR: {
    code: "FR",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, FR_EXTRA_CHARACTERS),
  },
  PL: {
    code: "PL",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, PL_EXTRA_CHARACTERS),
  },
  ES: {
    code: "ES",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, ES_EXTRA_CHARACTERS),
  },
  IT: {
    code: "IT",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, IT_EXTRA_CHARACTERS),
  },
  PT: {
    code: "PT",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, PT_EXTRA_CHARACTERS),
  },
  HU: {
    code: "HU",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, HU_EXTRA_CHARACTERS),
  },
  TR: {
    code: "TR",
    cjk: false,
    matches_character: (char) => is_latin_or_extra_character(char, TR_EXTRA_CHARACTERS),
  },
  TH: {
    code: "TH",
    cjk: false,
    matches_character: (char) => is_code_point_in_ranges(char, TH_CHARACTER_RANGES),
  },
  ID: {
    code: "ID",
    cjk: false,
    matches_character: is_latin_character,
  },
  VI: {
    code: "VI",
    cjk: false,
    matches_character: (char) =>
      is_latin_character(char) || is_code_point_in_ranges(char, VI_CHARACTER_RANGES),
  },
};

export const CJK_LANGUAGE_CODES = new Set<LanguageCode>(["ZH", "JA", "KO"]);

export function normalize_language_code(value: string): LanguageCode | null {
  const normalized_value = value.trim().toUpperCase();
  if (normalized_value in LANGUAGE_DEFINITIONS) {
    return normalized_value as LanguageCode;
  }

  return null;
}

export function is_cjk_language_code(value: string): boolean {
  const language_code = normalize_language_code(value);
  return language_code !== null && CJK_LANGUAGE_CODES.has(language_code);
}

export function has_language_character(text: string, language_code: LanguageCode): boolean {
  const matches_character = LANGUAGE_DEFINITIONS[language_code].matches_character;
  if (matches_character === null) {
    return true;
  }

  return has_matching_character(text, matches_character);
}
