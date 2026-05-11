// 语言字符范围全部按闭区间记录，方便同时生成判断函数和正则字符类。
type CodePointRange = readonly [number, number];

// 单字符 matcher 是 LANGUAGE_DEFINITIONS 的最小能力，调用方不需要知道具体范围表。
type CharacterMatcher = (char: string) => boolean;

// 特殊值：表示“任意原文语言”（关闭语言过滤）。
export const ALL_LANGUAGE_CODE = "ALL";

// 公开源/目标语言列表由 UI、过滤器和质量检查共用，避免各模块维护不同顺序。
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

// 源/目标语言类型从唯一列表派生，新增语言时无需重复维护联合类型。
export type SourceTargetLanguageCode = (typeof SOURCE_TARGET_LANGUAGE_CODES)[number];
// LanguageCode 额外包含 ALL，用于表示关闭语言限制的配置值。
export type LanguageCode = typeof ALL_LANGUAGE_CODE | SourceTargetLanguageCode;

// 语言定义集中携带 CJK 标记和字符 matcher，调用方不直接读取范围常量。
export type LanguageDefinition = {
  code: LanguageCode;
  cjk: boolean;
  matches_character: CharacterMatcher | null;
};

// 这些字符范围对齐历史 TextBase，用于前端预过滤，不替代后端完整文本处理。
const CJK_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
];

// Latin 范围服务非 CJK 语言预过滤，只覆盖基础拉丁与扩展拉丁字母。
const LATIN_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0041, 0x005a],
  [0x0061, 0x007a],
  [0x00c0, 0x00ff],
  [0x0100, 0x017f],
  [0x0180, 0x024f],
];

// 韩文范围包含 Jamo、扩展 Jamo、兼容 Jamo 与完整谚文音节。
const HANGUL_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x1100, 0x11ff],
  [0xa960, 0xa97f],
  [0xd7b0, 0xd7ff],
  [0xac00, 0xd7af],
  [0x3130, 0x318f],
];

// 平假名范围需排除浊点/半浊点符号，保持残留检测不误报标记符。
const HIRAGANA_CHARACTER_RANGES: readonly CodePointRange[] = [[0x3040, 0x309f]];
// 浊点/半浊点是组合标记，过滤时不能当作残留假名。
const HIRAGANA_EXCLUDED_CODE_POINTS = new Set([0x309b, 0x309c]);

// 片假名范围含半角片假名，但排除中点和长音符等非文字控制符。
const KATAKANA_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x30a0, 0x30ff],
  [0x31f0, 0x31ff],
  [0xff65, 0xff9f],
];
// 半角中点和长音符常作为控制/分隔符出现，残留检测不把它们当作假名文字。
const KATAKANA_EXCLUDED_CODE_POINTS = new Set([0xff65, 0x30fb, 0x30fc]);

// 正则字符类不能表达“范围减去集合”，因此这里把平假名范围按例外点拆开。
const HIRAGANA_REGEX_RANGES: readonly CodePointRange[] = [
  [0x3040, 0x309a],
  [0x309d, 0x309f],
];

// 片假名正则范围同样按例外点拆分，保证和 is_katakana_character 一致。
const KATAKANA_REGEX_RANGES: readonly CodePointRange[] = [
  [0x30a0, 0x30fa],
  [0x30fd, 0x30ff],
  [0x31f0, 0x31ff],
  [0xff66, 0xff9f],
];

// 需要构造正则字符串的调用点引用这里，正则范围必须和上面的字符判断例外点保持一致。
export const CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE = [
  ...CJK_CHARACTER_RANGES,
  ...HIRAGANA_REGEX_RANGES,
  ...KATAKANA_REGEX_RANGES,
  ...HANGUL_CHARACTER_RANGES,
]
  .map(
    ([start, end]) => `${format_code_point_for_regex(start)}-${format_code_point_for_regex(end)}`,
  )
  .join("");

// 俄文使用西里尔基础与扩展区间，覆盖常见游戏文本中的旧字母。
const RU_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0410, 0x044f],
  [0x0500, 0x052f],
  [0x2c00, 0x2c5f],
  [0xa640, 0xa69f],
  [0x1c80, 0x1c8f],
  [0x2de0, 0x2dff],
];

// 阿拉伯文覆盖基础、补充、扩展和展示形区域，满足轻量语言过滤。
const AR_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

// 泰文范围保留数字段，避免纯泰文数字行被误判为非目标语言。
const TH_CHARACTER_RANGES: readonly CodePointRange[] = [
  [0x0e00, 0x0e7f],
  [0x0e50, 0x0e59],
];

// 越南语额外字符只覆盖越南语专用扩展，普通拉丁字母由 LATIN 范围负责。
const VI_CHARACTER_RANGES: readonly CodePointRange[] = [[0x1ea0, 0x1ef9]];

// 各欧洲语言额外字符只补足拉丁范围无法表达的语言特征。
const DE_EXTRA_CHARACTERS = new Set(["Ä", "Ö", "Ü", "ä", "ö", "ü", "ß"]);
// 法语额外字符包含合字和常见重音字母，补足拉丁范围外的语言特征。
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
// 波兰语额外字符覆盖带尾音和锐音的大小写形式。
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
// 西葡意匈土的额外字符较短，分别用显式集合表达，避免宽泛 Unicode 属性误判。
const ES_EXTRA_CHARACTERS = new Set(["ñ", "á", "é", "í", "ó", "ú", "ü"]);
// 意大利语额外字符主要是重音元音，基础拉丁字母已由 LATIN 范围覆盖。
const IT_EXTRA_CHARACTERS = new Set(["à", "è", "é", "ì", "ò", "ù"]);
// 葡萄牙语额外字符覆盖鼻化元音和 ç，避免与西语规则混用。
const PT_EXTRA_CHARACTERS = new Set(["á", "é", "í", "ó", "ú", "ã", "õ", "à", "â", "ê", "ô", "ç"]);
// 匈牙利语额外字符包含长双锐音，不能只依赖基础 Latin 扩展命中。
const HU_EXTRA_CHARACTERS = new Set(["á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű"]);
// 土耳其语 I/İ/ı 与大小写规则特殊，显式列出更稳定。
const TR_EXTRA_CHARACTERS = new Set(["Ç", "ç", "Ğ", "ğ", "İ", "ı", "Ö", "ö", "Ş", "ş", "Ü", "ü"]);

// 单字符转 code point 的入口统一处理空字符串，调用方无需重复防御。
function code_point(char: string): number | null {
  return char.codePointAt(0) ?? null;
}

// 正则字符类需要根据 BMP / 非 BMP 选择不同转义形式。
function format_code_point_for_regex(value: number): string {
  return value <= 0xffff
    ? `\\u${value.toString(16).padStart(4, "0")}`
    : `\\u{${value.toString(16)}}`;
}

// 范围判断按 code point 执行，避免代理对字符被 UTF-16 下标拆开。
function is_code_point_in_ranges(char: string, ranges: readonly CodePointRange[]): boolean {
  const value = code_point(char);
  if (value === null) {
    return false;
  }

  return ranges.some(([start, end]) => value >= start && value <= end);
}

// 例外点判断用于“范围减集合”的假名残留规则。
function is_code_point_excluded(char: string, excluded_code_points: ReadonlySet<number>): boolean {
  const value = code_point(char);
  return value !== null && excluded_code_points.has(value);
}

// 任意文本命中一个语言字符即可视为包含该语言，保持过滤器轻量。
function has_matching_character(text: string, matches_character: CharacterMatcher): boolean {
  for (const char of text) {
    if (matches_character(char)) {
      return true;
    }
  }

  return false;
}

// 中文字符判断只覆盖汉字范围，假名和谚文由各自语言函数补充。
function is_cjk_character(char: string): boolean {
  return is_code_point_in_ranges(char, CJK_CHARACTER_RANGES);
}

// 拉丁基础判断供多种欧洲语言复用，额外字符由语言定义层补充。
function is_latin_character(char: string): boolean {
  return is_code_point_in_ranges(char, LATIN_CHARACTER_RANGES);
}

// 韩文判断直接引用共享范围，供残留检查和语言过滤共同使用。
export function is_hangul_character(char: string): boolean {
  return is_code_point_in_ranges(char, HANGUL_CHARACTER_RANGES);
}

// 平假名判断与正则范围保持同一例外集合，避免残留检查和保护规则分歧。
export function is_hiragana_character(char: string): boolean {
  return (
    is_code_point_in_ranges(char, HIRAGANA_CHARACTER_RANGES) &&
    !is_code_point_excluded(char, HIRAGANA_EXCLUDED_CODE_POINTS)
  );
}

// 片假名判断排除常见分隔符，减少游戏控制文本误报。
export function is_katakana_character(char: string): boolean {
  return (
    is_code_point_in_ranges(char, KATAKANA_CHARACTER_RANGES) &&
    !is_code_point_excluded(char, KATAKANA_EXCLUDED_CODE_POINTS)
  );
}

// 假名聚合入口供校对和 fixer 复用，不让调用方重复拼平假名/片假名判断。
export function is_kana_character(char: string): boolean {
  return is_hiragana_character(char) || is_katakana_character(char);
}

// 日文允许汉字或假名命中，符合原文混排的常见场景。
function is_ja_character(char: string): boolean {
  return is_cjk_character(char) || is_kana_character(char);
}

// 韩文允许汉字或谚文命中，兼容含汉字词的韩文本地化文本。
function is_ko_character(char: string): boolean {
  return is_cjk_character(char) || is_hangul_character(char);
}

// 欧洲语言先走拉丁范围，再补充该语言特有字符集合。
function is_latin_or_extra_character(char: string, extra_characters: ReadonlySet<string>): boolean {
  return is_latin_character(char) || extra_characters.has(char);
}

// 语言定义是运行态唯一 matcher 表，新增语言必须在这里补齐 CJK 标记和字符规则。
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

// CJK 语言集合供 UI 和规则分支快速判断，不重复解释字符范围。
export const CJK_LANGUAGE_CODES = new Set<LanguageCode>(["ZH", "JA", "KO"]);

// 语言码入口统一大小写与空白处理，未知值显式返回 null。
export function normalize_language_code(value: string): LanguageCode | null {
  const normalized_value = value.trim().toUpperCase();
  if (normalized_value in LANGUAGE_DEFINITIONS) {
    return normalized_value as LanguageCode;
  }

  return null;
}

// 判断语言族时必须先归一化，避免小写配置让 CJK 分支失效。
export function is_cjk_language_code(value: string): boolean {
  const language_code = normalize_language_code(value);
  return language_code !== null && CJK_LANGUAGE_CODES.has(language_code);
}

// 文本语言命中入口，ALL 语言永远返回 true 表示不过滤。
export function has_language_character(text: string, language_code: LanguageCode): boolean {
  const matches_character = LANGUAGE_DEFINITIONS[language_code].matches_character;
  if (matches_character === null) {
    return true;
  }

  return has_matching_character(text, matches_character);
}

/**
 * 东亚全角显示宽度判断，用于 UI/日志长度估算，不参与语言过滤。
 */
export function is_fullwidth_code_point(code_point: number): boolean {
  return (
    code_point >= 0x1100 &&
    (code_point <= 0x115f ||
      code_point === 0x2329 ||
      code_point === 0x232a ||
      (code_point >= 0x2e80 && code_point <= 0xa4cf && code_point !== 0x303f) ||
      (code_point >= 0xac00 && code_point <= 0xd7a3) ||
      (code_point >= 0xf900 && code_point <= 0xfaff) ||
      (code_point >= 0xfe10 && code_point <= 0xfe19) ||
      (code_point >= 0xfe30 && code_point <= 0xfe6f) ||
      (code_point >= 0xff00 && code_point <= 0xff60) ||
      (code_point >= 0xffe0 && code_point <= 0xffe6) ||
      (code_point >= 0x20000 && code_point <= 0x3fffd))
  );
}
