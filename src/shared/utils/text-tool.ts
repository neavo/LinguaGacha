// Unicode 标点与符号类别是无正文标点判断的唯一事实源
const PUNCTUATION_OR_SYMBOL_PATTERN = /[\p{P}\p{S}]/u;
const UTF8_BOM = "\uFEFF"; // TextDecoder 会保留 BOM 字符，格式解析前必须显式剥掉

/**
 * 解码后统一移除 UTF-8 BOM，保持各格式处理器不感知文件头
 */
function strip_utf8_bom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** 自动探测二进制内容编码；失败或无结果时由调用方回退 UTF-8。 */
async function detect_text_encoding(content: Uint8Array): Promise<string | null> {
  try {
    const chardet = await import("chardet");
    const detected = chardet.detect(content as never);
    if (typeof detected === "string" && detected.trim() !== "") {
      return detected.trim();
    }
  } catch {
    // 编码探测失败时回退 UTF-8，保持解析主流程可继续
  }
  return null;
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
  return text
    .split(split_by_space ? /[\p{P}\p{S}\u0020\u3000]+/u : /[\p{P}\p{S}]+/u)
    .filter(Boolean);
}

/** UTF-8 JSONL 等 LF 协议只按 U+000A 分行；CRLF 去掉 CR，其它 Unicode 分隔符保留为正文。 */
export async function* iterate_utf8_lf_lines(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8");
  let buffered = "";
  for await (const chunk of chunks) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      yield buffered.slice(0, newline).replace(/\r$/u, "");
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf("\n");
    }
  }
  buffered += decoder.decode();
  if (buffered !== "") yield buffered.replace(/\r$/u, "");
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

/** 按声明编码、自动探测、UTF-8 的固定优先级解码文本。 */
export async function decode_text_content(
  content: Uint8Array,
  options?: { declaredEncoding?: string },
): Promise<string> {
  try {
    const iconv = await import("iconv-lite");
    const declared_encoding = options?.declaredEncoding?.trim();
    if (declared_encoding !== undefined && iconv.encodingExists(declared_encoding)) {
      return strip_utf8_bom(iconv.decode(content as never, declared_encoding));
    }
    const detected_encoding = await detect_text_encoding(content);
    if (detected_encoding !== null && iconv.encodingExists(detected_encoding)) {
      return strip_utf8_bom(iconv.decode(content as never, detected_encoding));
    }
  } catch {
    // iconv 不可用或不支持探测结果时统一回退 UTF-8。
  }
  return strip_utf8_bom(new TextDecoder("utf-8").decode(content));
}
