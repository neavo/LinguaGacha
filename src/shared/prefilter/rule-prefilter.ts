import { is_non_standalone_language_character } from "../../domain/language";
import { is_punctuation_character } from "../utils/text-tool";

const LINE_BREAK_PATTERN = /\r\n|\r|\n/gu; // 统一兼容 Windows、Unix 和旧 Mac 换行，确保多行过滤判断稳定

/**
 * 集中维护当前模块的稳定常量。
 */
export const RULE_PREFILTER_PREFIXES = ["mapdata/", "se/", "bgs", "0=", "bgm/", "ficon/"]; // 前缀、后缀和正则清单集中描述可翻译候选预过滤口径，保持资源路径排除一致

// 资源文件扩展名直接排除，避免图片、音频、字体和存档名进入翻译
/**
 * 集中维护当前模块的稳定常量。
 */
export const RULE_PREFILTER_SUFFIXES = [
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

// 正则规则覆盖事件编号、RenPy 默认字体和 RenPy 存档时间占位
/**
 * 集中维护当前模块的稳定常量。
 */
export const RULE_PREFILTER_PATTERNS = [
  /^EV\d+$/iu,
  // RenPy 默认字体名称
  /^DejaVu Sans$/iu,
  /^Opendyslexic$/iu,
  // RenPy 存档时间
  /^\{#file_time\}/iu,
];

// 无正文价值行只允许由空白、数字、标点/符号和非独立语言字符组成
/**
 * 判断当前值是否满足业务条件。
 */
function is_non_translatable_content_line(line: string): boolean {
  return [...line].every((char) => {
    return (
      /\s/u.test(char) ||
      /\p{N}/u.test(char) ||
      is_punctuation_character(char) ||
      is_non_standalone_language_character(char)
    );
  });
}

/**
 * 单行规则预过滤复刻历史 filter_line：空行、资源路径和纯数字标点都排除
 */
function should_skip_rule_prefilter_line(raw_line: string): boolean {
  const line = raw_line.trim().toLowerCase();
  // 空字符串
  if (line === "") {
    return true;
  }

  if (is_non_translatable_content_line(line)) {
    return true;
  }

  // 以目标前缀开头
  if (RULE_PREFILTER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true;
  }

  // 以目标后缀结尾
  if (RULE_PREFILTER_SUFFIXES.some((suffix) => line.endsWith(suffix))) {
    return true;
  }

  // 符合目标规则
  return RULE_PREFILTER_PATTERNS.some((pattern) => pattern.test(line));
}

// 返回值 true 表示需要过滤（即需要排除）
/**
 * 判断当前值是否满足业务条件。
 */
export function should_skip_by_rule_prefilter(text: string): boolean {
  if (text.trim() === "") {
    return true;
  }
  return text.split(LINE_BREAK_PATTERN).every(should_skip_rule_prefilter_line);
}
