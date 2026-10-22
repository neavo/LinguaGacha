import {
  PythonSyntaxError,
  type PythonMode,
  type PythonFacts,
  type PythonSession,
  type PythonDiagnostic,
} from "./python-syntax";
import { attributes, class_name, node_string, resolve_node, type PickleNode } from "./pickle";
import type { CompiledSlot } from "./compiled";
import type { ScriptDiagnostic } from "../file-format-types";

export const node_value = (node: PickleNode | undefined): PickleNode["value"] =>
  node ? resolve_node(node).value : null;
export const node_children = (node: PickleNode | undefined): PickleNode[] =>
  node ? resolve_node(node).children : [];
export const node_text = (node: PickleNode | undefined): string => (node ? node_string(node) : "");

/** 新旧身份字段采用同一口径，翻译包装后缀不创建新的语句身份。 */
export function statement_identity(node: PickleNode): string | null {
  const fields = attributes(node),
    cls = class_name(node);
  if (cls === "renpy.sl2.slast.SLDisplayable")
    return JSON.stringify([
      String(node_value(fields.get("serial"))),
      node_text(node_children(fields.get("location"))[0]),
      String(node_value(node_children(fields.get("location"))[1])),
    ]);
  if (!cls.startsWith("renpy.ast.") || cls === "renpy.ast.PyCode" || is_pyexpr(node)) return null;
  const name = fields.get("name") ?? fields.get("_name");
  if (name && resolve_node(name).kind === "tuple") {
    const parts = node_children(name).map((part) => String(node_value(part)));
    if (parts.at(-1) === "translate" || parts.at(-1) === "end_translate") parts.pop();
    return JSON.stringify(parts);
  }
  if (node_value(name) !== null) return JSON.stringify(["label", String(node_value(name))]);
  if (fields.has("name_version") && fields.has("name_serial"))
    return JSON.stringify([
      node_text(fields.get("filename")),
      String(node_value(fields.get("name_version"))),
      String(node_value(fields.get("name_serial"))),
    ]);
  if (fields.has("linenumber"))
    return JSON.stringify([
      cls,
      node_text(fields.get("filename")),
      String(node_value(fields.get("linenumber"))),
    ]);
  return null;
}

/** 新版引擎将 PyExpr 移入 astsupport，序列化职责保持相同。 */
export function is_pyexpr(node: PickleNode): boolean {
  return /^renpy\.(?:ast|astsupport)\.PyExpr$/u.test(class_name(node));
}

/** 保留字符串消费边，只有承载代码的对象才穿透引用。 */
export function code_edge(node: PickleNode): PickleNode | undefined {
  const edge = node;
  node = resolve_node(node);
  if (node.kind === "unicode" || node.kind === "bytes") return edge;
  if (is_pyexpr(node)) return node_children(node.args)[0];
  if (class_name(node) === "renpy.ast.PyCode") {
    const source = node_children(node.state)[1];
    return source ? code_edge(source) : undefined;
  }
  return undefined;
}

/** Define 的命名空间与变量名可能分开序列化。 */
function definition_target(fields: Map<string, PickleNode>): string {
  const store = node_text(fields.get("store"));
  return (
    (store && store !== "store" ? store.replace(/^store\./u, "") + "." : "") +
    node_text(fields.get("varname"))
  );
}

/** next 是执行链，不属于当前语句的结构子树。 */
function script_children(node: PickleNode): PickleNode[] {
  const fields = attributes(node);
  return [
    ...node.children,
    ...[...fields].filter(([key]) => key !== "next").map(([, child]) => child),
    ...(node.args ? [node.args] : []),
    ...(fields.size === 0 && node.state ? [node.state] : []),
  ];
}

/** 反向索引容器消费者。标量 GET 保持独立边，容器 GET 才共享子字段。 */
export function script_consumers(root: PickleNode): (edge: PickleNode) => ReadonlySet<string> {
  const parents = new Map<PickleNode, Set<PickleNode>>(),
    identities = new Map<PickleNode, string>();
  const pending = [root],
    visited = new Set<PickleNode>();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    const owner = statement_identity(node);
    if (owner !== null) identities.set(node, owner);
    for (const edge of script_children(node)) {
      const resolved = resolve_node(edge);
      const child = resolved.kind === "object" || resolved.children.length > 0 ? resolved : edge;
      const owners = parents.get(child) ?? new Set<PickleNode>();
      owners.add(node);
      parents.set(child, owners);
      pending.push(child);
    }
  }
  const cache = new Map<PickleNode, ReadonlySet<string>>();
  return (edge) => {
    const cached = cache.get(edge);
    if (cached) return cached;
    const owners = new Set<string>(),
      seen = new Set<PickleNode>(),
      pending = [edge];
    while (pending.length) {
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const identity = identities.get(node);
      if (identity !== undefined) owners.add(identity);
      else if (node === root) owners.add("<script>");
      else pending.push(...(parents.get(node) ?? []));
    }
    cache.set(edge, owners);
    return owners;
  };
}

type RenpyPhase = "top" | "init" | "runtime";
export type RenpyCode = Readonly<{
  source: string | null;
  mode: PythonMode;
  slot: number | null;
  edge: PickleNode | undefined;
  legacy: PickleNode | undefined;
  owner: string;
  field: string;
  phase: RenpyPhase;
  priority: number | null; // 初始化优先级缺失时保留未知，加载声明读取负责拒绝。
  early: boolean; // `EarlyPython` 先于所有 `Init` 优先级执行。
  target: string;
  display: boolean;
  translated: boolean;
  filename: string | null;
  line: number | null;
}>;
/** 原源码偏移始终保留。编译坐标缺失时不制造文件行列。 */
export function code_diagnostic(code: RenpyCode, diagnostic: PythonDiagnostic): ScriptDiagnostic {
  const before = code.source?.slice(0, diagnostic.start) ?? "";
  const lines = before.split("\n");
  return {
    message: `${code.filename ?? "<unknown>"}:${code.line === null ? "?" : code.line + lines.length - 1} / ${code.owner} / slot ${code.slot} / ${code.field}@${code.edge?.start ?? code.legacy?.start}: [${diagnostic.start}, ${diagnostic.end}) ${diagnostic.reason}`,
    line: code.line === null ? null : code.line + lines.length - 1,
    column: code.line === null || lines.length === 1 ? null : lines.at(-1)!.length + 1,
  };
}
/** PyCode 的源码 PyExpr 继承外层编译模式。 */
function code_mode(node: PickleNode): PythonMode {
  const mode =
    class_name(node) === "renpy.ast.PyCode"
      ? node_text(node_children(resolve_node(node).state)[3])
      : "eval";
  if (mode !== "eval" && mode !== "exec" && mode !== "hide")
    throw new Error("Unknown Ren'Py compile mode: " + mode);
  return mode;
}
/** 编译结构只在此处解释，记录保留每个槽位、语句和消费边的实际上下文。 */
export function script_codes(script: { slots: readonly CompiledSlot[] }): RenpyCode[] {
  const result: RenpyCode[] = [];
  for (const slot of script.slots) {
    type Context = {
      owner: string;
      field: string;
      phase: RenpyPhase;
      priority: number | null;
      early: boolean;
      target: string;
      display: boolean;
      translated: boolean;
      filename: string | null;
      line: number | null;
    };
    const seen = new Map<PickleNode, Set<string>>();
    const visit = (edge: PickleNode, context: Context): void => {
      const node = resolve_node(edge),
        cls = class_name(node),
        fields = attributes(node);
      const identity = statement_identity(node);
      let current = { ...context };
      if (identity !== null)
        current = { ...current, owner: identity, field: "", target: "", display: false };
      const filename = node_text(fields.get("filename")),
        line = node_value(fields.get("linenumber"));
      if (filename) current.filename = filename;
      if (typeof line === "number") current.line = line;
      if (cls === "renpy.ast.Init" || cls === "renpy.ast.EarlyPython") {
        current.phase = current.phase === "top" ? "init" : "runtime";
        current.early = cls === "renpy.ast.EarlyPython";
        const priority = node_value(fields.get("priority"));
        current.priority = current.early ? 0 : typeof priority === "number" ? priority : null;
      } else if (
        cls.startsWith("renpy.ast.") &&
        !["renpy.ast.Python", "renpy.ast.Define", "renpy.ast.PyCode", "renpy.ast.PyExpr"].includes(
          cls,
        )
      )
        current.phase = "runtime";
      if (cls === "renpy.ast.Translate" && node_value(fields.get("language")) !== null)
        current.translated = true;
      const compiled = cls === "renpy.ast.PyCode" || is_pyexpr(node);
      const scalar = node.kind === "unicode" || node.kind === "bytes";
      // 同一容器可有多个消费者；同一消费者的循环和别名只访问一次。
      const key = JSON.stringify([
        current.owner,
        current.phase,
        current.priority,
        current.early,
        current.translated,
        current.target,
        current.display,
        scalar ? edge.start : null,
        compiled || scalar ? current.field : null,
      ]);
      const contexts = seen.get(node) ?? new Set<string>();
      if (contexts.has(key)) return;
      contexts.add(key);
      seen.set(node, contexts);
      if (
        compiled ||
        (scalar &&
          (current.display || /^(?:code|positional\.\d+|keyword\.\d+)$/u.test(current.field)))
      ) {
        const source_edge = code_edge(edge);
        const location = is_pyexpr(node)
          ? node_children(node.args).slice(1, 3)
          : node_children(node_children(node.state)[2]);
        const location_line = node_value(location[1]);
        const legacy =
          !source_edge && cls === "renpy.ast.PyCode" ? node_children(node.state)[1] : undefined;
        result.push({
          ...current,
          slot: slot.slot,
          source: source_edge ? node_text(source_edge) : null,
          edge: source_edge,
          legacy,
          mode: code_mode(node),
          field: current.field || "expression",
          filename: node_text(location[0]) || current.filename,
          line: typeof location_line === "number" ? location_line : current.line,
        });
        return;
      }
      const descend = (child: PickleNode, field: string, extra: Partial<Context> = {}) =>
        visit(child, {
          ...current,
          field: current.field ? current.field + "." + field : field,
          ...extra,
        });
      if (cls === "renpy.ast.Define" || cls === "renpy.ast.Default") {
        const code = fields.get("code"),
          target = definition_target(fields);
        if (code)
          descend(code, "code", {
            target,
            display: /^(?:config\.(?:name|window_title)|gui\.about)$/u.test(target),
          });
      }
      if (cls === "renpy.sl2.slast.SLDisplayable") {
        const display = /(?:text\.Text|ui\._textbutton|ui\._label)$/u.test(
          node_text(fields.get("displayable")),
        );
        node_children(fields.get("positional")).forEach((child, index) =>
          descend(child, "positional." + index, { display: display && index === 0 }),
        );
        node_children(fields.get("keyword")).forEach((entry, index) => {
          const pair = node_children(entry);
          if (pair[1])
            descend(pair[1], "keyword." + index, {
              display: /^(?:text|tooltip|alt)$/u.test(node_text(pair[0])),
            });
        });
      }
      node.children.forEach((child, index) => descend(child, String(index)));
      for (const [field, child] of fields) {
        if (
          field === "next" ||
          ((cls === "renpy.ast.Define" || cls === "renpy.ast.Default") && field === "code") ||
          (cls === "renpy.sl2.slast.SLDisplayable" && ["positional", "keyword"].includes(field))
        )
          continue;
        descend(child, field);
      }
      if (node.args) descend(node.args, "args");
      if (fields.size === 0 && node.state) descend(node.state, "state");
    };
    visit(slot.graph.root, {
      owner: "<script>",
      field: "",
      phase: "top",
      priority: 0,
      early: false,
      target: "",
      display: false,
      translated: false,
      filename: null,
      line: null,
    });
  }
  return result;
}
/** 引擎保存的旧 Python AST 直接提供加载访问事实，不创建伪源码。 */
function legacy_facts(root: PickleNode): PythonFacts {
  const facts: PythonFacts = {
    constants: [],
    assignments: [],
    references: [],
    bare_references: [],
    diagnostics: [],
    expression: undefined,
  };
  const seen = new Map<PickleNode, Set<boolean>>();
  const name = (node: PickleNode | undefined): string => {
    if (!node) return "";
    const fields = attributes(node);
    if (class_name(node) === "_ast.Name") return node_text(fields.get("id"));
    if (class_name(node) === "_ast.Attribute")
      return name(fields.get("value")) + "." + node_text(fields.get("attr"));
    return "";
  };
  const visit = (edge: PickleNode, attribute = false) => {
    const node = resolve_node(edge);
    const contexts = seen.get(node) ?? new Set<boolean>();
    if (contexts.has(attribute)) return;
    contexts.add(attribute);
    seen.set(node, contexts);
    const reference = name(node);
    if (reference) {
      facts.references.push(reference);
      if (!attribute) facts.bare_references.push(reference);
    }
    for (const child of node.children) visit(child);
    for (const [key, child] of attributes(node))
      visit(child, class_name(node) === "_ast.Attribute" && key === "value");
    if (node.args) visit(node.args);
    if (attributes(node).size === 0 && node.state) visit(node.state);
  };
  visit(root);
  return facts;
}
/** 语法事实与语句提供的赋值目标关联，范围仍属于未经改写的表达式。 */
export async function analyze_code(
  code: RenpyCode,
  session: PythonSession,
  python2: boolean,
  signal?: AbortSignal,
): Promise<PythonFacts> {
  const facts =
    code.source === null
      ? legacy_facts(code.legacy!)
      : await session.analyze({ source: code.source, mode: code.mode }, python2, signal);
  if (code.target && facts.expression) {
    facts.references.push(code.target);
    facts.assignments.push({
      target: code.target,
      root: true,
      operation: "=",
      ...facts.expression,
    });
  }
  return facts;
}
/** 翻译语义分析失败附加成员与编译位置，资源故障和取消保持原始异常。 */
export async function audit_code(
  code: RenpyCode,
  member: string,
  session: PythonSession,
  python2: boolean,
  signal?: AbortSignal,
): Promise<PythonFacts> {
  try {
    return await analyze_code(code, session, python2, signal);
  } catch (cause) {
    if (!(cause instanceof PythonSyntaxError)) throw cause;
    throw new Error(member + ": " + code_diagnostic(code, cause.diagnostic).message, { cause });
  }
}
