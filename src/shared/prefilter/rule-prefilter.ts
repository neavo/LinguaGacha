import { has_language_body_character } from "../../domain/language";
import { remove_text_resource_references } from "../text/text-resource-reference";

const LINE_BREAK_PATTERN = /\r\n|\r|\n/gu; // 统一兼容 Windows、Unix 和旧 Mac 换行，确保多行过滤判断稳定

const RULE_PREFILTER_PREFIXES = ["mapdata/", "se/", "bgs", "0=", "bgm/", "ficon/"]; // 历史元数据前缀与正则清单集中描述可翻译候选预过滤口径

// 正则规则覆盖事件编号、RenPy 默认字体和 RenPy 存档时间占位。
const RULE_PREFILTER_PATTERNS = [
  /^EV\d+$/iu,
  // RenPy 默认字体名称
  /^DejaVu Sans$/iu,
  /^Opendyslexic$/iu,
  // RenPy 存档时间
  /^\{#file_time\}/iu,
];

// 书写系统正文是可翻译内容的最小稳定证据；附标、数字、标点、符号和控制字符不独立成文。
function is_non_translatable_content_line(line: string): boolean {
  return !has_language_body_character(line);
}

/** 单行预过滤在移除资源引用后判断正文，并保留格式元数据规则。 */
function should_skip_rule_prefilter_line(raw_line: string): boolean {
  const line = raw_line.trim();
  if (line === "") {
    return true;
  }

  const normalized_line = line.toLowerCase();
  const natural_text = remove_text_resource_references(line);

  return (
    is_non_translatable_content_line(natural_text) ||
    RULE_PREFILTER_PREFIXES.some((prefix) => normalized_line.startsWith(prefix)) ||
    RULE_PREFILTER_PATTERNS.some((pattern) => pattern.test(normalized_line))
  );
}

/** 仅当每一物理行都没有可翻译正文时跳过整个条目。 */
export function should_skip_by_rule_prefilter(text: string): boolean {
  return text.split(LINE_BREAK_PATTERN).every(should_skip_rule_prefilter_line);
}
