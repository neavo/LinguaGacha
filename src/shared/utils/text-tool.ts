// Unicode 标点与符号类别是无正文标点判断的唯一事实源
const PUNCTUATION_OR_SYMBOL_PATTERN = /[\p{P}\p{S}]/u;
const UTF8_BOM = "\uFEFF"; // TextDecoder 会保留 BOM 字符，格式解析前必须显式剥掉

/**
 * 解码后统一移除 UTF-8 BOM，保持各格式处理器不感知文件头
 */
function strip_utf8_bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/**
 * 统一历史编码名归一化规则，避免探测入口之间出现大小写和 BOM 差异
 */
function normalize_detected_encoding(encoding: string, add_sig_to_utf8: boolean): string {
  let normalized_encoding = encoding;
  let normalized_key = normalized_encoding.toLowerCase().replace(/_/gu, "-");
  if (normalized_key === "ascii") {
    normalized_encoding = "utf-8";
    normalized_key = "utf-8";
  }
  if (add_sig_to_utf8 && (normalized_key === "utf-8" || normalized_key === "utf8")) {
    return "utf-8-sig";
  }
  return normalized_encoding;
}

/**
 * 自动探测二进制内容编码，失败时回退 UTF-8
 */
async function detect_text_encoding(content: Uint8Array, add_sig_to_utf8: boolean): Promise<string> {
  let encoding = "utf-8";

  try {
    const chardet = await import("chardet");
    const detected = chardet.detect(content as never);
    if (typeof detected === "string" && detected.trim() !== "") {
      encoding = detected.trim();
    }
  } catch {
    // 编码探测失败时回退 UTF-8，保持解析主流程可继续
  }

  return normalize_detected_encoding(encoding, add_sig_to_utf8);
}

/**
 * 统一标点/符号判断入口，规则预过滤不在语言层重复维护符号集合
 */
export function is_punctuation_character(char: string): boolean {
  return PUNCTUATION_OR_SYMBOL_PATTERN.test(char);
}

/**
 * 按标点和可选空格切分文本，用于术语分段等前置处理
 */
export function split_by_punctuation(text: string, split_by_space: boolean): string[] {
  const result: string[] = [];
  let current = "";
  for (const char of text) {
    if (
      is_punctuation_character(char) ||
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
 * 基于字符集合的 Jaccard 相似度，与历史轻量去重判断一致
 */
export function check_similarity_by_jaccard(left: string, right: string): number {
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
 * 解码文件内容，探测失败或 iconv 不支持时回退 UTF-8
 */
export async function decode_text_content(
  content: Uint8Array,
  add_sig_to_utf8 = true,
): Promise<string> {
  const encoding = await detect_text_encoding(content, add_sig_to_utf8);
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
