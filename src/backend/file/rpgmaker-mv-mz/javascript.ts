import { createRequire } from "node:module";
import path from "node:path";
import type * as Oxc from "oxc-parser";

export type JavascriptString = {
  start: number;
  end: number;
  template: boolean;
  src: string;
  source_context: string;
};
const SOURCE_CONTEXT_MAX_LENGTH = 1200; // 限制每个条目重复保存的原稿量，包含省略标记。
const CONTEXT_NODE_TYPES = new Set([
  "CallExpression",
  "NewExpression",
  "VariableDeclarator",
  "AssignmentExpression",
  "Property",
  "ReturnStatement",
  "ThrowStatement",
]);
let parser_require = createRequire(import.meta.url); // 发行目录拥有原生解析器绑定。

/** 组合根提供发行运行目录，原生绑定按标准 Node 规则加载。 */
export function configure_rpgmaker_parser(directory: string): void {
  parser_require = createRequire(path.join(directory, "package.json"));
}

/** 解析器给出 UTF-16 偏移，模板片段保留表达式边界。 */
export function read_javascript_strings(source: string): JavascriptString[] {
  const { parseSync, Visitor, visitorKeys } = parser_require("oxc-parser") as typeof Oxc;
  const result = parseSync("source.js", source, { sourceType: "commonjs" });
  if (result.errors.length > 0)
    throw new SyntaxError(result.errors.map((error) => error.message).join("\n"));
  const strings: JavascriptString[] = [];
  const ancestors: Oxc.Node[] = []; // 收集字符串时只含父节点，进入后压栈、退出时弹栈。
  /** 同一次遍历收集写回定位与原稿上下文。 */
  function enter(node: Oxc.Node): void {
    const src =
      node.type === "Literal" && typeof node.value === "string"
        ? node.value
        : node.type === "TemplateElement"
          ? node.value.cooked
          : null;
    if (src) {
      const context = select_source_context(node, ancestors);
      strings.push({
        start: node.start,
        end: node.end,
        template: node.type === "TemplateElement",
        src,
        source_context: read_source_context(source, context, node),
      });
    }
    ancestors.push(node);
  }
  new Visitor(
    Object.fromEntries(
      Object.keys(visitorKeys).flatMap((type) => [
        [type, enter],
        [`${type}:exit`, () => ancestors.pop()],
      ]),
    ),
  ).visit(result.program);
  return strings.sort((a, b) => a.start - b.start);
}

/** 用途节点优先，函数边界阻止外层包装改变局部语境。 */
function select_source_context(node: Oxc.Node, ancestors: readonly Oxc.Node[]): Oxc.Node {
  let statement: Oxc.Node | undefined;
  let template: Oxc.Node | undefined;
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const parent = ancestors[index]!;
    if (
      parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression"
    ) {
      if (
        parent.type === "ArrowFunctionExpression" &&
        parent.body.type !== "BlockStatement" &&
        (ancestors[index + 1] ?? node) === parent.body // 参数中的字符串不能使用函数体兜底。
      )
        return parent.body;
      break;
    }
    if (CONTEXT_NODE_TYPES.has(parent.type)) return parent;
    if (parent.type.endsWith("Statement") && parent.type !== "BlockStatement") statement ??= parent;
    if (parent.type === "TemplateLiteral") template ??= parent;
  }
  return statement ?? template ?? node;
}

/** 摘录预留两端省略标记，截断避开 UTF-16 代理对中间。 */
function read_source_context(source: string, context: Oxc.Node, target: Oxc.Node): string {
  if (context.end - context.start <= SOURCE_CONTEXT_MAX_LENGTH)
    return source.slice(context.start, context.end);
  const budget = SOURCE_CONTEXT_MAX_LENGTH - 2;
  const padding = Math.max(0, Math.floor((budget - (target.end - target.start)) / 2)); // 长字符串从起始处展示。
  let start = Math.max(context.start, Math.min(target.start - padding, context.end - budget));
  let end = start + budget;
  // 切点位于低代理项时向摘录内部收缩，保持长度上限。
  const is_low_surrogate = (offset: number): boolean => {
    const code = source.charCodeAt(offset);
    return code >= 0xdc00 && code <= 0xdfff;
  };
  if (is_low_surrogate(start)) start++;
  if (is_low_surrogate(end)) end--;
  return `${start > context.start ? "…" : ""}${source.slice(start, end)}${end < context.end ? "…" : ""}`;
}

/** 模板片段保留表达式与分隔符，普通字符串统一使用 JSON 转义。 */
export function encode_javascript_string(value: string, template: boolean): string {
  const encoded = JSON.stringify(value)
    .slice(1, -1)
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
  return template ? encoded.replace(/`/gu, "\\`").replace(/\$\{/gu, "\\${") : `"${encoded}"`;
}
