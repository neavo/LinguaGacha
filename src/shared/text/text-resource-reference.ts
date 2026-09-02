/** 文本内资源引用的原始半开区间。 */
export type TextResourceReference = {
  start: number; // 引用起始 UTF-16 offset
  end: number; // 引用结束 UTF-16 offset
  value: string; // 原始引用文本
};

/** 单次翻译任务内临时 token 与原文的恢复关系。 */
export type TextResourceReferenceMapping = {
  token: string; // 发给模型的短 token
  value: string; // 译后恢复的原始引用
};

/** 单个字段的投影结果和后续字段应使用的序号。 */
export type TextResourceReferenceProjection = {
  text: string; // 已替换引用的模型输入
  mappings: TextResourceReferenceMapping[]; // 当前字段的恢复映射
  next_ordinal: number; // 下一个字段延续使用的扁平序号
};

// 无 scheme 路径没有结构化边界，只对明确的资源扩展名建立候选。
const RESOURCE_EXTENSIONS = [
  // 音频
  "mp3", // MP3 音频
  "wav", // 波形音频
  "ogg", // Ogg 音频
  "mid", // MIDI 音序
  "flac", // FLAC 无损音频
  "opus", // Opus 音频
  "m4a", // MPEG-4 音频
  "aac", // AAC 音频
  // 图片
  "png", // PNG 位图
  "jpg", // JPEG 位图常用扩展
  "jpeg", // JPEG 位图完整扩展
  "gif", // GIF 位图或动图
  "psd", // Photoshop 图像工程
  "webp", // WebP 图像
  "heif", // HEIF 图像
  "heic", // HEIC 图像
  "bmp", // BMP 位图
  "svg", // SVG 矢量图
  "ico", // 图标文件
  "avif", // AVIF 图像
  // 视频
  "avi", // AVI 视频
  "mp4", // MPEG-4 视频
  "webm", // WebM 视频
  "mkv", // Matroska 视频
  "mov", // QuickTime 视频
  // 字体
  "ttf", // TrueType 字体
  "otf", // OpenType 字体
  "woff", // Web 开放字体
  "woff2", // Web 开放字体第二版
  // 数据
  "txt", // 纯文本资源
  "json", // JSON 数据
  "sav", // 存档数据
  "mps", // MPS 数据
  "xml", // XML 数据
  "yaml", // YAML 数据完整扩展
  "yml", // YAML 数据常用扩展
  "csv", // CSV 表格数据
  "bin", // 二进制数据
  // 文档
  "md", // Markdown 文档
  "pdf", // PDF 文档
  "html", // HTML 文档完整扩展
  "htm", // HTML 文档短扩展
  "xhtml", // XHTML 文档完整扩展
  "xhtm", // XHTML 文档短扩展
  "doc", // Word 二进制文档
  "docx", // Word Open XML 文档
  "xls", // Excel 二进制工作簿
  "xlsx", // Excel Open XML 工作簿
  "ppt", // PowerPoint 二进制演示文稿
  "pptx", // PowerPoint Open XML 演示文稿
  "odt", // OpenDocument 文本文档
  "ods", // OpenDocument 电子表格
  "odp", // OpenDocument 演示文稿
  "rtf", // 富文本格式文档
  "epub", // EPUB 电子书
  // 压缩包
  "7z", // 7-Zip 压缩包
  "gz", // Gzip 压缩包
  "rar", // RAR 压缩包
  "zip", // ZIP 压缩包
  "tar", // Tar 归档包
] as const;

// data URI 必须优先于一般 URI 和路径匹配，避免长载荷被拆成较短候选。
const DATA_URI_BASE64_PATTERN =
  /\bdata:[a-z][a-z\d.+-]*\/[a-z\d.+-]+(?:;[a-z\d!#$&^_.+-]+(?:=[a-z\d!#$&^_.+%-]*)?)*;base64,[a-z\d+/=_-]+/giu;
const URI_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`，。；：！？、（）【】「」『』]+/giu;
const RESOURCE_PATH_PATTERN = new RegExp(
  String.raw`[\p{L}\p{M}\p{N}_@%+~.-]+(?:[\\/][\p{L}\p{M}\p{N}_@%+~.-]+)*\.(?:${RESOURCE_EXTENSIONS.join(
    "|",
  )})(?![\p{L}\p{M}\p{N}_-])(?:[?#][^\s<>"'\x60，。；：！？、（）【】「」『』]+)?`,
  "giu",
);

// URI 正则允许常见 ASCII 标点，命中结束后再按成对结构裁掉句末标点。
const SIMPLE_TRAILING_PUNCTUATION = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "。",
  "，",
  "；",
  "：",
  "！",
  "？",
  "、",
]);
const CLOSING_TO_OPENING = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["】", "【"],
  ["」", "「"],
  ["』", "『"],
]);

type TextResourceReferenceCandidate = TextResourceReference & {
  priority: number; // 同起点候选的裁决顺序
};

/** 识别文本内的 Base64 data URI、带 `://` scheme 的 URI 与无 scheme 资源路径。 */
export function collect_text_resource_references(text: string): TextResourceReference[] {
  const candidates = [
    ...collect_pattern_candidates(text, DATA_URI_BASE64_PATTERN, 0),
    ...collect_pattern_candidates(text, URI_PATTERN, 1),
    ...collect_pattern_candidates(text, RESOURCE_PATH_PATTERN, 2),
  ].sort(
    (left, right) =>
      left.start - right.start || left.priority - right.priority || right.end - left.end,
  );

  const references: TextResourceReference[] = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor || candidate.end <= candidate.start) {
      continue;
    }
    references.push({
      start: candidate.start,
      end: candidate.end,
      value: candidate.value,
    });
    cursor = candidate.end;
  }
  return references;
}

/** 移除全部已识别引用，供调用方按自己的正文规则判断剩余内容。 */
export function remove_text_resource_references(
  text: string,
  references: readonly TextResourceReference[] = collect_text_resource_references(text),
): string {
  return replace_reference_ranges(text, references, () => "");
}

/** 把引用替换为任务内扁平编号 token，并返回后续字段应继续使用的序号。 */
export function project_text_resource_references(
  text: string,
  start_ordinal = 0,
): TextResourceReferenceProjection {
  const references = collect_text_resource_references(text);
  const mappings: TextResourceReferenceMapping[] = [];
  let next_ordinal = Math.max(0, Math.trunc(start_ordinal));
  const projected_text = replace_reference_ranges(text, references, (reference) => {
    let token = `lg-uri/${next_ordinal.toString()}`;
    while (text.includes(token)) {
      next_ordinal += 1;
      token = `lg-uri/${next_ordinal.toString()}`;
    }
    next_ordinal += 1;
    mappings.push({ token, value: reference.value });
    return token;
  });
  return { text: projected_text, mappings, next_ordinal };
}

/** 单次替换当前任务实际生成的 token，恢复值不再参与后续匹配。 */
export function restore_text_resource_references(
  text: string,
  mappings: readonly TextResourceReferenceMapping[],
): string {
  const pattern = build_mapping_token_pattern(mappings);
  if (pattern === null) {
    return text;
  }
  const value_by_token = new Map(mappings.map((mapping) => [mapping.token, mapping.value]));
  return text.replace(pattern, (token) => value_by_token.get(token) ?? token);
}

/** 仅转换临时 token 之间的文本，保证本地清理和替换不改写引用占位符。 */
export function transform_projected_text_resource_references(
  text: string,
  mappings: readonly TextResourceReferenceMapping[],
  transform: (value: string) => string,
): string {
  const pattern = build_mapping_token_pattern(mappings);
  if (pattern === null) {
    return transform(text);
  }
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? "";
    const index = match.index ?? -1;
    if (token === "" || index < cursor) {
      continue;
    }
    result += transform(text.slice(cursor, index)) + token;
    cursor = index + token.length;
  }
  return result + transform(text.slice(cursor));
}

/** 将单个识别模式的命中转成带裁决优先级的候选区间。 */
function collect_pattern_candidates(
  text: string,
  pattern: RegExp,
  priority: number,
): TextResourceReferenceCandidate[] {
  pattern.lastIndex = 0;
  const candidates: TextResourceReferenceCandidate[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw_value = match[0] ?? "";
    const start = match.index ?? -1;
    if (start < 0 || raw_value === "") {
      continue;
    }
    const end = trim_reference_end(text, start, start + raw_value.length);
    candidates.push({
      start,
      end,
      value: text.slice(start, end),
      priority,
    });
  }
  pattern.lastIndex = 0;
  return candidates;
}

/** 裁掉句末标点和未配对闭合符，同时保留 URI 自身的成对括号。 */
function trim_reference_end(text: string, start: number, initial_end: number): number {
  let end = initial_end;
  while (end > start) {
    const last = text[end - 1] ?? "";
    if (SIMPLE_TRAILING_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    const opening = CLOSING_TO_OPENING.get(last);
    if (opening === undefined) {
      break;
    }
    const value = text.slice(start, end);
    if (count_character(value, last) <= count_character(value, opening)) {
      break;
    }
    end -= 1;
  }
  return end;
}

/** 统计单个字符，用于判断 URI 末尾闭合符是否有对应开符。 */
function count_character(text: string, character: string): number {
  return text.split(character).length - 1;
}

/** 转义动态 token，保证恢复映射只按字面量匹配。 */
function escape_regexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 构建精确 token 联合正则，长 token 优先且不得命中更长序号的前缀。 */
function build_mapping_token_pattern(
  mappings: readonly TextResourceReferenceMapping[],
): RegExp | null {
  const tokens = [...new Set(mappings.map((mapping) => mapping.token))];
  if (tokens.length === 0) {
    return null;
  }
  return new RegExp(
    `(?:${tokens
      .sort((left, right) => right.length - left.length)
      .map(escape_regexp)
      .join("|")})(?!\\d)`,
    "gu",
  );
}

/** 按已排序且互不重叠的半开区间重建文本。 */
function replace_reference_ranges(
  text: string,
  references: readonly TextResourceReference[],
  replacement: (reference: TextResourceReference) => string,
): string {
  let result = "";
  let cursor = 0;
  for (const reference of references) {
    result += text.slice(cursor, reference.start) + replacement(reference);
    cursor = reference.end;
  }
  return result + text.slice(cursor);
}
