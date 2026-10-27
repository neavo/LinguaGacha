import assert from "node:assert/strict";
import { Parser } from "htmlparser2";

const TYRANO_CONFIG_TITLE = "System.title"; // 窗口标题，Config.tjs 中唯一开放翻译的显示字段。
export const TYRANO_KEEP_SPACE = "KeepSpaceInParameterValue"; // 新版引擎的参数空白规则。

/** 一行配置的引擎取值与原稿位置。`value_start/value_end` 只在值可被无损改写时存在。 */
type ConfigEntry = Readonly<{
  key: string;
  value: string;
  value_start?: number;
  value_end?: number;
}>;

/**
 * 按引擎 `compileConfig` 逐行解释：分号开头的行有效，`//` 截断注释，删除全部分号与双引号后按首个等号拆分。
 * 值两侧的引号、分号与空白保留为外围格式，其余部分不含这些字符时才能原位改写。
 */
function scan_config(text: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  let offset = 0;
  for (const row of text.split("\n")) {
    const line_start = offset + row.length - row.trimStart().length;
    offset += row.length + 1;
    const line = row.trim();
    if (!line.startsWith(";")) continue;
    const body = line.split("//")[0]!;
    const equal = body.indexOf("=");
    const clean = body.replaceAll(";", "").replaceAll('"', "").split("=");
    const key = clean[0]!.trim();
    const value = (clean[1] ?? "").trim();
    const raw = equal < 0 ? "" : body.slice(equal + 1);
    const start = raw.length - raw.replace(/^[\s";]+/u, "").length;
    const end = Math.max(start, raw.replace(/[\s";]+$/u, "").length);
    entries.push(
      equal >= 0 && !/[;"=]/u.test(raw.slice(start, end))
        ? {
            key,
            value,
            value_start: line_start + equal + 1 + start,
            value_end: line_start + equal + 1 + end,
          }
        : { key, value },
    );
  }
  return entries;
}

/** 引擎读取的配置，同名键以最后一行为准。 */
export function read_tyrano_config(text: string): Map<string, string> {
  return new Map(scan_config(text).map((entry) => [entry.key, entry.value]));
}

/** 入口页面在游戏初始化时按文档顺序用 `<input tyrano="config" key value>` 覆盖配置，其他元素不解释。 */
export function apply_config_overrides(
  base: ReadonlyMap<string, string>,
  html: string,
): Map<string, string> {
  const config = new Map(base);
  new Parser({
    onopentag(name, attributes) {
      if (name === "input" && attributes["tyrano"] === "config" && attributes["key"] !== undefined)
        config.set(attributes["key"], attributes["value"] ?? "");
    },
  }).end(html);
  return config;
}

/** 最后一行标题的原稿范围，值中含引擎会删除或截断的字符时不可写。 */
export function read_config_title(
  text: string,
): { start: number; end: number; value: string } | null {
  const entry = scan_config(text).findLast((entry) => entry.key === TYRANO_CONFIG_TITLE);
  return entry?.value_start === undefined
    ? null
    : { start: entry.value_start, end: entry.value_end!, value: entry.value };
}

/** 替换标题后按引擎语义回读，标题不等或其他配置变化都拒绝。 */
export function write_config_title(text: string, value: string): string {
  const target = read_config_title(text);
  assert(target, "Config.tjs title is not writable");
  const output = text.slice(0, target.start) + value + text.slice(target.end);
  const expected = read_tyrano_config(text).set(TYRANO_CONFIG_TITLE, value);
  assert(
    JSON.stringify([...read_tyrano_config(output)]) === JSON.stringify([...expected]),
    "Config.tjs title cannot represent translation: " + value,
  );
  return output;
}
