type CodePointRange = readonly [number, number];

// 汉字标点符号（CJK）
export const CJK_PUNCTUATION_RANGES: readonly CodePointRange[] = [
  [0x3001, 0x303f],
  [0xff01, 0xff0f],
  [0xff1a, 0xff1f],
  [0xff3b, 0xff40],
  [0xff5b, 0xff65],
  [0xffe0, 0xffee],
];

// 拉丁标点符号
export const LATIN_PUNCTUATION_RANGES: readonly CodePointRange[] = [
  [0x0021, 0x002f],
  [0x003a, 0x0040],
  [0x005b, 0x0060],
  [0x007b, 0x007e],
  [0x2000, 0x206f],
  [0x2e00, 0x2e7f],
  [0x2010, 0x2027],
  [0x2030, 0x205e],
];

// 特殊符号（不属于标点符号范围但是当作标点符号处理）
export const SPECIAL_PUNCTUATION_SET = new Set(["·", "・", "♥"]);

function is_code_point_in_ranges(char: string, ranges: readonly CodePointRange[]): boolean {
  const value = char.codePointAt(0);
  if (value === undefined) {
    return false;
  }

  return ranges.some(([start, end]) => value >= start && value <= end);
}

export function is_cjk_punctuation_character(char: string): boolean {
  return is_code_point_in_ranges(char, CJK_PUNCTUATION_RANGES);
}

export function is_latin_punctuation_character(char: string): boolean {
  return is_code_point_in_ranges(char, LATIN_PUNCTUATION_RANGES);
}

export function is_special_punctuation_character(char: string): boolean {
  return SPECIAL_PUNCTUATION_SET.has(char);
}

// 判断一个字符是否是标点符号。
export function is_punctuation_character(char: string): boolean {
  return (
    is_cjk_punctuation_character(char) ||
    is_latin_punctuation_character(char) ||
    is_special_punctuation_character(char)
  );
}
