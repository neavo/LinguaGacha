import { is_punctuation_character } from "../../../utils/text-tool";

// 统一兼容 Windows、Unix 和旧 Mac 换行，确保多行过滤判断稳定。
const LINE_BREAK_PATTERN = /\r\n|\r|\n/gu;

// 前缀、后缀和正则清单从 Python 规则过滤迁移，保持资源路径排除一致。
export const RULE_FILTER_PREFIXES = ["mapdata/", "se/", "bgs", "0=", "bgm/", "ficon/"];

// 资源文件扩展名直接排除，避免图片、音频、字体和存档名进入翻译。
export const RULE_FILTER_SUFFIXES = [
  ".mp3",
  ".wav",
  ".ogg",
  ".mid",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".psd",
  ".webp",
  ".heif",
  ".heic",
  ".avi",
  ".mp4",
  ".webm",
  ".txt",
  ".7z",
  ".gz",
  ".rar",
  ".zip",
  ".json",
  ".sav",
  ".mps",
  ".ttf",
  ".otf",
  ".woff",
];

// 正则规则覆盖事件编号、RenPy 默认字体和 RenPy 存档时间占位。
export const RULE_FILTER_PATTERNS = [
  /^EV\d+$/iu,
  // RenPy 默认字体名称
  /^DejaVu Sans$/iu,
  /^Opendyslexic$/iu,
  // RenPy 存档时间
  /^\{#file_time\}/iu,
];

// 对齐 Python isnumeric：跳过只包含空白、数字字符和标点的行。
function is_numeric_or_punctuation_line(line: string): boolean {
  return [...line].every((char) => {
    return /\s/u.test(char) || /\p{N}/u.test(char) || is_punctuation_character(char);
  });
}

/**
 * 单行规则过滤复刻 Python filter_line：空行、资源路径和纯数字标点都排除。
 */
function should_skip_rule_filter_line(raw_line: string): boolean {
  const line = raw_line.trim().toLowerCase();
  // 空字符串
  if (line === "") {
    return true;
  }

  if (is_numeric_or_punctuation_line(line)) {
    return true;
  }

  // 以目标前缀开头
  if (RULE_FILTER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true;
  }

  // 以目标后缀结尾
  if (RULE_FILTER_SUFFIXES.some((suffix) => line.endsWith(suffix))) {
    return true;
  }

  // 符合目标规则
  return RULE_FILTER_PATTERNS.some((pattern) => pattern.test(line));
}

// 返回值 true 表示需要过滤（即需要排除）。
export function should_skip_by_rule_filter(text: string): boolean {
  const lines = text.split(LINE_BREAK_PATTERN);
  return lines.length > 0 && lines.every(should_skip_rule_filter_line);
}
