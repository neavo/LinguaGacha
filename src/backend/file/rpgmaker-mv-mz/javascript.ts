import { createRequire } from "node:module";
import path from "node:path";
import type * as Oxc from "oxc-parser";

export type JavascriptString = { start: number; end: number; template: boolean; src: string };
let parser_require = createRequire(import.meta.url); // 发行目录拥有原生解析器绑定。

/** 组合根提供发行运行目录，原生绑定按标准 Node 规则加载。 */
export function configure_rpgmaker_parser(directory: string): void {
  parser_require = createRequire(path.join(directory, "package.json"));
}

/** 解析器给出 UTF-16 偏移，模板片段保留表达式边界。 */
export function read_javascript_strings(source: string): JavascriptString[] {
  const { parseSync, Visitor } = parser_require("oxc-parser") as typeof Oxc;
  const result = parseSync("source.js", source, { sourceType: "commonjs" });
  if (result.errors.length > 0)
    throw new SyntaxError(result.errors.map((error) => error.message).join("\n"));
  const strings: JavascriptString[] = [];
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string" && node.value !== "")
        strings.push({ start: node.start, end: node.end, template: false, src: node.value });
    },
    TemplateElement(node) {
      if (node.value.cooked)
        strings.push({ start: node.start, end: node.end, template: true, src: node.value.cooked });
    },
  }).visit(result.program);
  return strings.sort((a, b) => a.start - b.start);
}

/** 模板片段保留表达式与分隔符，普通字符串统一使用 JSON 转义。 */
export function encode_javascript_string(value: string, template: boolean): string {
  const encoded = JSON.stringify(value)
    .slice(1, -1)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  return template ? encoded.replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${") : `"${encoded}"`;
}
