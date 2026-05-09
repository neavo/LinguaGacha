type CodePointRange = readonly [number, number];

// CJK 全角标点范围与 Py TextHelper 保持一致。
const CJK_PUNCTUATION_RANGES: readonly CodePointRange[] = [
  [0x3001, 0x303f],
  [0xff01, 0xff0f],
  [0xff1a, 0xff1f],
  [0xff3b, 0xff40],
  [0xff5b, 0xff65],
  [0xffe0, 0xffee],
];

// 拉丁和通用标点范围用于数字/标点行过滤。
const LATIN_PUNCTUATION_RANGES: readonly CodePointRange[] = [
  [0x0021, 0x002f],
  [0x003a, 0x0040],
  [0x005b, 0x0060],
  [0x007b, 0x007e],
  [0x2000, 0x206f],
  [0x2e00, 0x2e7f],
  [0x2010, 0x2027],
  [0x2030, 0x205e],
];

// 少量项目约定符号不在 Unicode 标点范围内，但业务上按标点处理。
const SPECIAL_PUNCTUATION_SET = new Set(["·", "・", "♥"]);
// TextDecoder 会保留 BOM 字符，格式解析前必须显式剥掉。
const UTF8_BOM = "\uFEFF";

/**
 * 按 code point 判断范围，避免代理对字符被 UTF-16 下标拆坏。
 */
function is_code_point_in_ranges(char: string, ranges: readonly CodePointRange[]): boolean {
  const value = char.codePointAt(0);
  return value !== undefined && ranges.some(([start, end]) => value >= start && value <= end);
}

/**
 * 解码后统一移除 UTF-8 BOM，保持各格式处理器不感知文件头。
 */
function strip_utf8_bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/**
 * 对齐 Python TextHelper 的文本判断与文件编码入口。
 */
export class TextTool {
  /**
   * 判断字符是否属于 CJK/全角标点范围。
   */
  public static is_cjk_punctuation_character(char: string): boolean {
    return is_code_point_in_ranges(char, CJK_PUNCTUATION_RANGES);
  }

  /**
   * 判断字符是否属于拉丁或通用标点范围。
   */
  public static is_latin_punctuation_character(char: string): boolean {
    return is_code_point_in_ranges(char, LATIN_PUNCTUATION_RANGES);
  }

  /**
   * 判断字符是否属于项目额外认定的标点符号。
   */
  public static is_special_punctuation_character(char: string): boolean {
    return SPECIAL_PUNCTUATION_SET.has(char);
  }

  /**
   * 统一标点判断入口，前端规则过滤不再保留薄封装。
   */
  public static is_punctuation_character(char: string): boolean {
    return (
      this.is_cjk_punctuation_character(char) ||
      this.is_latin_punctuation_character(char) ||
      this.is_special_punctuation_character(char)
    );
  }

  /**
   * 判断文本中是否包含任意标点。
   */
  public static any_punctuation(text: string): boolean {
    return [...text].some((char) => this.is_punctuation_character(char));
  }

  /**
   * 判断文本是否全部由标点组成，空字符串沿用 JS every 的真值语义。
   */
  public static all_punctuation(text: string): boolean {
    return [...text].every((char) => this.is_punctuation_character(char));
  }

  /**
   * 去掉首尾标点但保留中间内容，用于规则文本归一化。
   */
  public static strip_punctuation(text: string): string {
    const chars = [...text.trim()];
    let start = 0;
    let end = chars.length - 1;
    while (start <= end && this.is_punctuation_character(chars[start] ?? "")) {
      start += 1;
    }
    while (end >= start && this.is_punctuation_character(chars[end] ?? "")) {
      end -= 1;
    }
    return start > end ? "" : chars.slice(start, end + 1).join("");
  }

  /**
   * 去掉首尾阿拉伯数字，保持 Py TextHelper 的轻量处理口径。
   */
  public static strip_arabic_numerals(text: string): string {
    return text.replace(/^\d+|\d+$/gu, "");
  }

  /**
   * 按标点和可选空格切分文本，用于相似度与规则判断的前置分段。
   */
  public static split_by_punctuation(text: string, split_by_space: boolean): string[] {
    const result: string[] = [];
    let current = "";
    for (const char of text) {
      if (
        this.is_punctuation_character(char) ||
        (split_by_space && (char === "\u0020" || char === "\u3000"))
      ) {
        if (current !== "") {
          result.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }
    if (current !== "") {
      result.push(current);
    }
    return result.filter(Boolean);
  }

  /**
   * 近似终端显示宽度：全角字符计 2，半角字符计 1。
   */
  public static get_display_length(text: string): number {
    let total = 0;
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 0;
      total += this.is_fullwidth_code_point(cp) ? 2 : 1;
    }
    return total;
  }

  /**
   * 基于字符集合的 Jaccard 相似度，与 Py 侧轻量去重判断一致。
   */
  public static check_similarity_by_jaccard(left: string, right: string): number {
    const left_set = new Set(left);
    const right_set = new Set(right);
    const union = new Set([...left_set, ...right_set]).size;
    if (union === 0) {
      return 0;
    }
    let intersection = 0;
    for (const char of left_set) {
      if (right_set.has(char)) {
        intersection += 1;
      }
    }
    return intersection / union;
  }

  /**
   * 自动探测编码并将 ASCII/UTF-8 统一归入 UTF-8-SIG 处理入口。
   */
  public static async detect_encoding(
    content: Uint8Array,
    add_sig_to_utf8 = true,
  ): Promise<string> {
    let encoding = "utf-8";
    try {
      const chardet = await import("chardet");
      const detected = chardet.detect(content as never);
      if (typeof detected === "string" && detected.trim() !== "") {
        encoding = detected.trim();
      }
    } catch {
      // 编码探测失败时回退 UTF-8，保持解析主流程可继续。
    }
    const normalized = encoding.toLowerCase().replace(/_/gu, "-");
    if (normalized === "ascii") {
      encoding = "utf-8";
    }
    if (add_sig_to_utf8 && (normalized === "utf-8" || normalized === "utf8")) {
      encoding = "utf-8-sig";
    }
    return encoding;
  }

  /**
   * 解码文件内容，探测失败或 iconv 不支持时回退 UTF-8。
   */
  public static async decode(content: Uint8Array, add_sig_to_utf8 = true): Promise<string> {
    const encoding = await this.detect_encoding(content, add_sig_to_utf8);
    if (encoding.toLowerCase().replace(/_/gu, "-") === "utf-8-sig") {
      return strip_utf8_bom(new TextDecoder("utf-8").decode(content));
    }
    try {
      const iconv = await import("iconv-lite");
      return strip_utf8_bom(iconv.decode(content as never, encoding));
    } catch {
      return strip_utf8_bom(new TextDecoder("utf-8").decode(content));
    }
  }

  /**
   * 全角范围判断用于显示长度估算，不参与语言学意义上的字符分类。
   */
  private static is_fullwidth_code_point(code_point: number): boolean {
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
}

// 兼容旧调用点的函数式导出，真实实现仍收口在 TextTool 类上。
export const is_cjk_punctuation_character = TextTool.is_cjk_punctuation_character.bind(TextTool);
export const is_latin_punctuation_character =
  TextTool.is_latin_punctuation_character.bind(TextTool);
export const is_special_punctuation_character =
  TextTool.is_special_punctuation_character.bind(TextTool);
export const is_punctuation_character = TextTool.is_punctuation_character.bind(TextTool);
