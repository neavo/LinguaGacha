import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as Prism from "@ruby/prism";
import type { ScriptDiagnostic } from "../file-format-types";

type Parser = Awaited<ReturnType<typeof Prism.loadPrism>>;
/** 持久定位只保存归一化 UTF-8 原稿中的语法字节范围。 */
export type RubyLocation = { start: number; end: number };
export type RubyString = RubyLocation & { src: string };
type SyntaxString = {
  node: Prism.StringNode;
  location: RubyLocation;
  ancestors: readonly Prism.Node[];
};
/** AST、祖先链与解析器仅在运行时使用，持久定位只保存字节范围。 */
export type RubySyntax = {
  source: Buffer;
  root: Prism.Node;
  prism: typeof Prism;
  strings: ReadonlyMap<string, SyntaxString>;
};
type RubyEdit = RubyLocation & { text: string };
const location_key = (location: RubyLocation) => location.start + ":" + location.end; // 相同字节范围共用索引键。
/** 将解析器的起点和长度转为写回使用的半开区间。 */
const range = (location: Prism.Location): RubyLocation => ({
  start: location.startOffset,
  end: location.startOffset + location.length,
});
/** 容器只能消费完整落在自身范围内的编辑。 */
const contains = (outer: RubyLocation, inner: RubyLocation) =>
  inner.start >= outer.start && inner.end <= outer.end;
let parser_require = createRequire(import.meta.url); // 由运行目录配置入口切换解析器来源。
let parser: Promise<{ parse: Parser; prism: typeof Prism }> | undefined;
/** WASM 与解析器 JS 必须从同一发行运行目录加载。 */
export function configure_rgss_parser(directory: string): void {
  parser_require = createRequire(path.join(directory, "package.json"));
  parser = undefined;
}
/** 每个运行线程复用一份 WASM 解析器，发行目录切换时由配置入口重置。 */
async function load_parser() {
  parser ??= import(
    /* @vite-ignore */ pathToFileURL(parser_require.resolve("@ruby/prism")).href
  ).then(async (module: typeof Prism) => ({ prism: module, parse: await module.loadPrism() }));
  return parser;
}
/** 语法解析独立于翻译资格，导入和导出共同使用原稿 AST。 */
export async function parse_ruby(
  source: string,
): Promise<{ ok: true; syntax: RubySyntax } | { ok: false; diagnostics: ScriptDiagnostic[] }> {
  const { parse, prism } = await load_parser();
  const buffer = Buffer.from(source);
  const result = parse(buffer, { encoding: false });
  if (result.errors.length)
    return {
      ok: false,
      diagnostics: result.errors.map((error) => {
        const lines = buffer.subarray(0, error.location.startOffset).toString().split("\n");
        return { message: error.message, line: lines.length, column: lines.at(-1)!.length + 1 };
      }),
    };
  const strings = new Map<string, SyntaxString>();
  // 只建立语法位置，不在此过滤翻译用途。
  function visit(node: Prism.Node, ancestors: readonly Prism.Node[]): void {
    if (node instanceof prism.StringNode) {
      const opening = node.openingLoc
        ? buffer
            .subarray(
              node.openingLoc.startOffset,
              node.openingLoc.startOffset + node.openingLoc.length,
            )
            .toString()
        : "";
      const parent = ancestors.at(-1);
      // 字符字面量及正则、符号、命令容器的直接文本不具有普通字符串语义。
      if (
        opening !== "?" &&
        node.unescaped.validEncoding &&
        !(parent && /(?:RegularExpression|Symbol|XString)/u.test(parent.constructor.name))
      ) {
        const location = range(node.location);
        strings.set(location_key(location), { node, location, ancestors });
      }
      return;
    }
    for (const child of node.childNodes()) if (child) visit(child, [...ancestors, node]);
  }
  visit(result.value, []);
  return { ok: true, syntax: { source: buffer, root: result.value, prism, strings } };
}
/** 提取普通字符串，翻译资格由容器来源统一决定。 */
export function select_ruby_strings(syntax: RubySyntax): RubyString[] {
  const strings: RubyString[] = [];
  for (const { node, location, ancestors } of syntax.strings.values()) {
    if (
      !node.unescaped.value ||
      ancestors.some((parent) =>
        /(?:RegularExpression|Symbol|XString)/u.test(parent.constructor.name),
      )
    )
      continue;
    strings.push({ ...location, src: node.unescaped.value });
  }
  return strings;
}
/** 语法解析后筛选普通字符串节点，诊断交给文件读取入口。 */
export async function read_ruby_strings(
  source: string,
): Promise<{ ok: true; strings: RubyString[] } | { ok: false; diagnostics: ScriptDiagnostic[] }> {
  const result = await parse_ruby(source);
  return result.ok ? { ok: true, strings: select_ruby_strings(result.syntax) } : result;
}
/** 统一生成普通字符串，转义插值起始符以保持译文的字面值。 */
function quote(text: string): string {
  return (
    '"' +
    text
      .replace(/\\/gu, "\\\\")
      .replace(/"/gu, '\\"')
      .replace(/#(?=[{@$])/gu, "\\#")
      .replace(/\n/gu, "\\n")
      .replace(/\r/gu, "\\r")
      .replace(/\t/gu, "\\t")
      .replace(/\0/gu, "\\000") +
    '"'
  );
}
/** 每个容器按原稿字节坐标倒序应用修改，越界和交叠在输出前拒绝。 */
function apply_edits(source: Buffer, location: RubyLocation, edits: readonly RubyEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let previous = location.end;
  const parts: Buffer[] = []; // 原稿切片按倒序收集，最后一次拼接避免反复复制整个容器。
  for (const edit of ordered) {
    assert(contains(location, edit) && edit.end <= previous, "Conflicting Ruby edits");
    parts.push(source.subarray(edit.end, previous), Buffer.from(edit.text));
    previous = edit.start;
  }
  parts.push(source.subarray(location.start, previous));
  return Buffer.concat(parts.reverse()).toString();
}
/** 原稿 AST 拥有转义、插值和 heredoc 范围，保存的位置仅用于选择文本节点。 */
export async function write_ruby_strings(
  source: string,
  changes: readonly { span: RubyLocation; src: string; dst: string }[],
): Promise<string> {
  const parsed = await parse_ruby(source);
  assert(parsed.ok, "Invalid original Ruby script");
  const { syntax } = parsed,
    { prism } = syntax;
  const values = new Map<Prism.StringNode, string>();
  for (const change of changes) {
    const actual = syntax.strings.get(location_key(change.span));
    assert(actual && actual.node.unescaped.value === change.src, "Stale Ruby string location");
    const previous = values.get(actual.node);
    assert(previous === undefined || previous === change.dst, "Conflicting Ruby string changes");
    values.set(actual.node, change.dst);
  }
  // 缺失分隔符按空串处理，供隐式拼接和 heredoc 共用。
  const slice = (location: Prism.Location | null) =>
    location
      ? syntax.source
          .subarray(location.startOffset, location.startOffset + location.length)
          .toString()
      : "";
  const edited = new Map<Prism.Node, boolean>();
  // 复用子树命中结果，嵌套容器无需反复扫描相同 AST。
  function has_changes(node: Prism.Node): boolean {
    if (edited.has(node)) return edited.get(node)!;
    const result =
      node instanceof prism.StringNode
        ? values.has(node)
        : node.childNodes().some((child) => child !== null && has_changes(child));
    edited.set(node, result);
    return result;
  }
  // 嵌套表达式沿自身范围消费编辑，外部 heredoc 正文由容器处理。
  function render_range(location: Prism.Location, edits: readonly RubyEdit[]): string {
    const target = range(location);
    return apply_edits(
      syntax.source,
      target,
      edits.filter((edit) => contains(target, edit)),
    );
  }
  // 有译文时取替换值，其余片段使用解析器解码的原始值。
  function string_value(node: Prism.StringNode): string {
    assert(node.unescaped.validEncoding, "Invalid Ruby string encoding");
    return values.get(node) ?? node.unescaped.value;
  }
  // 插值读取直接文本子节点。表达式里的字符串由 `render` 处理，词数组状态不会向下传播。
  function expression(
    node: Prism.StringNode | Prism.InterpolatedStringNode,
    nested: readonly RubyEdit[],
  ): string {
    if (node instanceof prism.StringNode) return quote(string_value(node));
    return (
      '"' +
      node.parts
        .map((part) =>
          part instanceof prism.StringNode
            ? quote(string_value(part)).slice(1, -1)
            : render_range(part.location, nested),
        )
        .join("") +
      '"'
    );
  }
  // 容器替换统一收口非连续 heredoc 范围，已消费的子编辑不再向外传播。
  function replace_container(
    node: Prism.StringNode | Prism.InterpolatedStringNode,
    value: string,
    nested: readonly RubyEdit[],
  ): RubyEdit[] {
    const main = range(node.location),
      covered: RubyLocation[] = [main];
    if (slice(node.openingLoc).startsWith("<<")) {
      assert(node.closingLoc, "Missing Ruby heredoc terminator");
      const start =
        node instanceof prism.StringNode
          ? node.contentLoc.startOffset
          : (node.parts[0]?.location.startOffset ?? node.closingLoc.startOffset);
      covered.push({ start, end: node.closingLoc.startOffset + node.closingLoc.length });
    }
    return [
      ...nested.filter((edit) => !covered.some((target) => contains(target, edit))),
      { ...main, text: value },
      ...covered.slice(1).map((target) => ({ ...target, text: "" })),
    ];
  }
  // 先生成内部表达式的编辑，再重建外层字符串容器。
  function render(node: Prism.Node, inline_heredocs = false): RubyEdit[] {
    if (!has_changes(node) && !inline_heredocs) return [];
    if (node instanceof prism.StringNode)
      return values.has(node) || (inline_heredocs && slice(node.openingLoc).startsWith("<<"))
        ? replace_container(node, quote(string_value(node)), [])
        : [];
    if (node instanceof prism.InterpolatedStringNode) {
      // 隐式拼接的各片段具有自身引号，保留原来的片段边界。
      if (
        !node.openingLoc &&
        node.parts.some((part) => part instanceof prism.StringNode && part.openingLoc)
      )
        return node.parts.flatMap((part) => render(part, inline_heredocs));
      const direct = node.parts.some(
        (part) => part instanceof prism.StringNode && values.has(part),
      );
      // 外层容器改为引号字符串时，插值内 heredoc 的正文也必须迁回表达式，否则原正文会随外层删除。
      const inline = inline_heredocs || direct;
      const nested = node.parts
        .filter((part) => !(part instanceof prism.StringNode))
        .flatMap((part) => render(part, inline));
      if (!direct && !(inline_heredocs && slice(node.openingLoc).startsWith("<<"))) return nested;
      return replace_container(node, expression(node, nested), nested);
    }
    if (node instanceof prism.ArrayNode && /^%[wW]/u.test(slice(node.openingLoc))) {
      const nested = node.elements.flatMap((element) =>
        element instanceof prism.InterpolatedStringNode
          ? element.parts
              .filter((part) => !(part instanceof prism.StringNode))
              .flatMap((part) => render(part, true))
          : [],
      );
      // 词数组统一重建为普通数组，使空译文、空白和嵌套插值都拥有明确的字符串边界。
      const value =
        "[" +
        node.elements
          .map((element) => {
            assert(
              element instanceof prism.StringNode ||
                element instanceof prism.InterpolatedStringNode,
              "Invalid Ruby word array element",
            );
            return expression(element, nested);
          })
          .join(", ") +
        "]";
      const target = range(node.location);
      return [...nested.filter((edit) => !contains(target, edit)), { ...target, text: value }];
    }
    return node.childNodes().flatMap((child) => (child ? render(child, inline_heredocs) : []));
  }
  const output = apply_edits(
    syntax.source,
    { start: 0, end: syntax.source.length },
    render(syntax.root),
  );
  const { parse } = await load_parser();
  assert(
    parse(Buffer.from(output), { encoding: false }).errors.length === 0,
    "Translated Ruby script is invalid",
  );
  return output;
}
