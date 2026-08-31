// Unicode 标点与符号类别是无正文标点判断的唯一事实源
const PUNCTUATION_OR_SYMBOL_PATTERN = /[\p{P}\p{S}]/u;
const UNICODE_BOM = "\uFEFF"; // 所有 Unicode 编码解码后都用同一字符表示 BOM。

// UTF-32 与 UTF-16 的 LE 前缀重叠，长 BOM 必须排在短 BOM 前匹配。
const TEXT_BOM_ENCODINGS = [
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: "utf-32be" },
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: "utf-32le" },
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
] as const;

/**
 * 解码后统一移除 Unicode BOM，保持各格式处理器不感知文件头。
 */
function strip_unicode_bom(text: string): string {
  return text.startsWith(UNICODE_BOM) ? text.slice(1) : text;
}

/** BOM 是内容自身携带的编码事实，必须先于外部声明使用。 */
function read_bom_encoding(content: Uint8Array): string | null {
  for (const candidate of TEXT_BOM_ENCODINGS) {
    if (candidate.bytes.every((byte, index) => content[index] === byte)) {
      return candidate.encoding;
    }
  }
  return null;
}

/** 严格 UTF-8 成功时直接返回文本，失败才进入传统编码探测。 */
function decode_utf8_strict(content: Uint8Array): string | null {
  try {
    return strip_unicode_bom(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } catch {
    return null;
  }
}

/** 优先使用平台严格解码，平台不认识的编码标签再交给兼容解码器。 */
async function decode_known_encoding(
  content: Uint8Array,
  encoding: string,
): Promise<string | null> {
  try {
    return strip_unicode_bom(new TextDecoder(encoding, { fatal: true }).decode(content));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  const iconv = await import("iconv-lite");
  if (!iconv.encodingExists(encoding)) {
    return null;
  }
  return strip_unicode_bom(iconv.decode(content as never, encoding));
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

/** 按 BOM、声明编码、严格 UTF-8、传统编码探测的唯一顺序解码文本。 */
export async function decode_text_content(
  content: Uint8Array,
  options?: { declaredEncoding?: string },
): Promise<string> {
  const bom_encoding = read_bom_encoding(content);
  if (bom_encoding !== null) {
    const decoded = await decode_known_encoding(content, bom_encoding);
    if (decoded !== null) return decoded;
  }

  const declared_encoding = options?.declaredEncoding?.trim();
  if (declared_encoding !== undefined && declared_encoding !== "") {
    const decoded = await decode_known_encoding(content, declared_encoding);
    if (decoded !== null) return decoded;
  }

  const utf8 = decode_utf8_strict(content);
  if (utf8 !== null) return utf8;

  const chardet = await import("chardet");
  const detected_encoding = chardet.detect(content as never)?.trim();
  if (detected_encoding === undefined || detected_encoding === "") {
    throw new TypeError("Text encoding could not be determined.");
  }
  const decoded = await decode_known_encoding(content, detected_encoding);
  if (decoded === null) {
    throw new TypeError(`Text encoding is not supported: ${detected_encoding}`);
  }
  return decoded;
}
