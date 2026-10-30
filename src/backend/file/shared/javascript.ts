import { createRequire } from "node:module";
import path from "node:path";
import type * as Oxc from "oxc-parser";
import type { ScriptDiagnostic } from "../file-format-types";

/** 字符串范围相对于完整脚本，供译文写回使用。 */
export type JavascriptString = {
  start: number;
  end: number;
  template: boolean;
  complete: boolean; // 含插值的模板片段不能作为完整 JSON 容器展开。
  src: string;
};
/** 语法错误只返回诊断，阻止调用者使用不可靠的 AST 偏移。 */
export type JavascriptReadResult =
  | { ok: true; strings: JavascriptString[] }
  | { ok: false; diagnostics: ScriptDiagnostic[] };
let parser_require = createRequire(import.meta.url); // 发行目录拥有原生解析器绑定。

/** 组合根提供发行运行目录，原生绑定按标准 Node 规则加载。 */
export function configure_javascript_parser(directory: string): void {
  parser_require = createRequire(path.join(directory, "package.json"));
}

/** 解析器给出 UTF-16 偏移，模板片段保留表达式边界。 */
export function read_javascript_strings(source: string): JavascriptReadResult {
  const { parseSync, visitorKeys } = parser_require("oxc-parser") as typeof Oxc;
  const result = parseSync("source.js", source, { sourceType: "commonjs" });
  if (result.errors.length > 0) {
    // 错误 AST 的偏移不用于写回，整段脚本交给调用方保留原稿。
    return {
      ok: false,
      diagnostics: result.errors.map((error) => {
        const offset = error.labels[0]?.start; // 首个标记给出主要错误位置，无标记时不猜测位置。
        const lines =
          offset === undefined ? null : source.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/u);
        return {
          message: error.message,
          line: lines?.length ?? null,
          column: lines === null ? null : lines.at(-1)!.length + 1,
        };
      }),
    };
  }
  const strings: JavascriptString[] = [];
  /** 按 `visitorKeys` 手动递归，免去每次为全部节点类型编译 `Visitor`。 */
  function visit(node: Oxc.Node, parent?: Oxc.Node): void {
    const src =
      node.type === "Literal" && typeof node.value === "string"
        ? node.value
        : node.type === "TemplateElement"
          ? node.value.cooked
          : null;
    if (src) {
      strings.push({
        start: node.start,
        end: node.end,
        template: node.type === "TemplateElement",
        complete:
          node.type !== "TemplateElement" ||
          (parent?.type === "TemplateLiteral" && parent.expressions.length === 0),
        src,
      });
    }
    for (const key of visitorKeys[node.type]!) {
      const child = (node as unknown as Record<string, Oxc.Node | (Oxc.Node | null)[] | null>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry) visit(entry, node);
        }
      } else if (child) {
        visit(child, node);
      }
    }
  }
  visit(result.program);
  return { ok: true, strings: strings.sort((a, b) => a.start - b.start) };
}

/** 模板片段保留表达式与分隔符，普通字符串统一使用 JSON 转义。 */
export function encode_javascript_string(value: string, template: boolean): string {
  const encoded = JSON.stringify(value)
    .slice(1, -1)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  return template ? encoded.replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${") : `"${encoded}"`;
}

/** 仅解码保存范围内的完整字面量，不执行脚本，也不重新提取定位。 */
export function decode_javascript_string(source: string, template: boolean): string {
  const { parseSync } = parser_require("oxc-parser") as typeof Oxc;
  const literal = template ? `\`${source}\`` : source;
  const result = parseSync("literal.js", literal, { sourceType: "commonjs" });
  const statement = result.program.body[0];
  const expression = statement?.type === "ExpressionStatement" ? statement.expression : null;
  if (result.errors.length === 0 && expression?.start === 0 && expression.end === literal.length) {
    if (!template && expression?.type === "Literal" && typeof expression.value === "string")
      return expression.value;
    if (template && expression?.type === "TemplateLiteral" && expression.expressions.length === 0) {
      const value = expression.quasis[0]?.value.cooked;
      if (typeof value === "string") return value;
    }
  }
  throw new Error("Invalid JavaScript string container");
}
