import { create_checkpoint } from "./checkpoint";
import assert from "node:assert/strict";
import type { PythonMode, PythonFacts, PythonSession, PythonDiagnostic } from "./python-syntax";
import { attributes, class_name, node_string, resolve_node, type PickleNode } from "./pickle";
import type { CompiledSlot } from "./compiled";
import type { ScriptDiagnostic } from "../file-format-types";
import { DISPLAY_DEFINES, DISPLAY_SCREEN_DISPLAYABLES, DISPLAY_SCREEN_KEYWORDS } from "./usage";

/** 可选字段缺失时沿用 Pickle 的空值语义。 */
export const node_value = (node: PickleNode | undefined): PickleNode["value"] =>
  node ? resolve_node(node).value : null;
/** 容器引用先解析，缺失字段视为空集合。 */
export const node_children = (node: PickleNode | undefined): PickleNode[] =>
  node ? resolve_node(node).children : [];
/** 缺失文本字段为空，已有字段仍执行协议字符串校验。 */
export const node_text = (node: PickleNode | undefined): string => (node ? node_string(node) : "");
/** 早期 Ren’Py 引擎界面脚本的字节串按 UTF-8 解码，保留玩家实际看到的替换字符。 */
export const display_text = (node: PickleNode): string => {
  const scalar = resolve_node(node).value;
  return Buffer.isBuffer(scalar) ? scalar.toString("utf8") : node_string(node);
};

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

/** 其他语言子图不提供基础语言身份或候选，`next` 可指向块外语句。 */
export async function script_excluded(
  slots: readonly Pick<CompiledSlot, "graph">[],
  signal?: AbortSignal,
): Promise<ReadonlySet<PickleNode>> {
  const checkpoint = create_checkpoint(signal);
  const excluded = new Set<PickleNode>();
  const pending: PickleNode[] = [];
  for (const slot of slots)
    for (const node of slot.graph.nodes) {
      const pause = checkpoint();
      if (pause) await pause;
      if (node.kind !== "object" || class_name(node) !== "renpy.ast.Translate") continue;
      const fields = attributes(node),
        block = fields.get("block");
      if (node_value(fields.get("language")) !== null && block) pending.push(block);
    }
  // 显式栈让深层与循环子图共用同一批次预算。
  while (pending.length) {
    const pause = checkpoint();
    if (pause) await pause;
    const node = resolve_node(pending.pop()!);
    if (excluded.has(node)) continue;
    excluded.add(node);
    for (const child of script_children(node)) pending.push(child);
  }
  return excluded;
}

/** 仅协调跨槽位唯一对应的回退身份，独立 `TranslateSay` 的旧键保持稳定。 */
export async function script_identities(
  slots: readonly CompiledSlot[],
  excluded?: ReadonlySet<PickleNode>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<PickleNode, string>> {
  const checkpoint = create_checkpoint(signal);
  excluded ??= await script_excluded(slots, signal);
  const identities = new Map<PickleNode, string>();
  // 同位置、同正文的全部对白共同参与判定，完整身份和重复节点会阻止协调。
  const dialogues = new Map<
    string,
    { node: PickleNode; slot: number; cls: string; fallback: boolean }[]
  >();
  for (const slot of slots)
    for (const node of slot.graph.nodes) {
      const pause = checkpoint();
      if (pause) await pause;
      if (node.kind !== "object") continue; // 只有对象节点承载语句身份，标量和引用直接跳过。
      const identity = statement_identity(node);
      if (identity !== null) identities.set(node, identity);
      const cls = class_name(node),
        fields = attributes(node);
      if (
        excluded.has(node) ||
        !["renpy.ast.Say", "renpy.ast.TranslateSay"].includes(cls) ||
        node_value(fields.get("language")) !== null
      )
        continue;
      const filename = node_text(fields.get("filename")),
        line = node_value(fields.get("linenumber"));
      if (!filename || typeof line !== "number" || !fields.has("what")) continue;
      const key = JSON.stringify([filename, line, node_text(fields.get("what"))]);
      const group = dialogues.get(key) ?? [];
      const name = fields.get("name") ?? fields.get("_name");
      // 完整身份已经参与旧条目的持久定位，不能被回退身份覆盖。
      const fallback =
        (!name || resolve_node(name).kind !== "tuple") &&
        node_value(name) === null &&
        !(fields.has("name_version") && fields.has("name_serial"));
      group.push({ node, slot: slot.slot, cls, fallback });
      dialogues.set(key, group);
    }
  for (const group of dialogues.values()) {
    const pause = checkpoint();
    if (pause) await pause;
    if (
      !group.every((entry) => entry.fallback) ||
      new Set(group.map((entry) => entry.slot)).size !== group.length ||
      new Set(group.map((entry) => entry.cls)).size !== 2
    )
      continue;
    const say = group.find((entry) => entry.cls === "renpy.ast.Say")!;
    for (const entry of group) identities.set(entry.node, identities.get(say.node)!);
  }
  return identities;
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

/** `PyExpr` 与 `PyCode` 各自保存源码位置，其他节点没有。 */
export function code_location(node: PickleNode): [filename: string, line: number | null] {
  node = resolve_node(node);
  const location = is_pyexpr(node)
    ? node_children(node.args).slice(1, 3)
    : class_name(node) === "renpy.ast.PyCode"
      ? node_children(node_children(node.state)[2])
      : [];
  const line = node_value(location[1]);
  return [node_text(location[0]), typeof line === "number" ? line : null];
}
/** 语句行号：`renpy.ast` 节点保存 `linenumber`，SL2 节点保存 `location`。 */
export function statement_line(node: PickleNode): number | null {
  const fields = attributes(node);
  const line = node_value(fields.get("linenumber") ?? node_children(fields.get("location"))[1]);
  return typeof line === "number" ? line : null;
}
/** Define 的命名空间与变量名可能分开序列化。 */
export function definition_target(fields: ReadonlyMap<string, PickleNode>): string {
  const store = node_text(fields.get("store"));
  return (
    (store && store !== "store" ? store.replace(/^store\./u, "") + "." : "") +
    node_text(fields.get("varname"))
  );
}

/** next 是执行链，不属于当前语句的结构子树。 */
export function script_children(node: PickleNode): PickleNode[] {
  const fields = attributes(node);
  return [
    ...node.children,
    ...[...fields].filter(([key]) => key !== "next").map(([, child]) => child),
    ...(node.args ? [node.args] : []),
    ...(fields.size === 0 && node.state ? [node.state] : []),
  ];
}

/** 语句子树中的最小与最大行号，不跟随 `next` 执行链。 */
export async function block_lines(
  edge: PickleNode,
  signal?: AbortSignal,
): Promise<[first: number, last: number] | null> {
  const checkpoint = create_checkpoint(signal);
  let first = Infinity,
    last = -Infinity;
  const seen = new Set<PickleNode>(),
    pending = [edge];
  while (pending.length) {
    const pause = checkpoint();
    if (pause) await pause;
    const node = resolve_node(pending.pop()!);
    if (seen.has(node)) continue;
    seen.add(node);
    const line = statement_line(node);
    if (line !== null) {
      first = Math.min(first, line);
      last = Math.max(last, line);
    }
    pending.push(...script_children(node));
  }
  return first <= last ? [first, last] : null;
}
/** 菜单项不保存行号：选项正文位于其子块首行之前，无子块的标题正文紧跟上一项。 */
export async function menu_item_lines(
  menu: PickleNode,
  signal?: AbortSignal,
): Promise<(number | null)[]> {
  const checkpoint = create_checkpoint(signal);
  const result: (number | null)[] = [];
  let previous = statement_line(menu);
  for (const item of node_children(attributes(menu).get("items"))) {
    const pause = checkpoint();
    if (pause) await pause;
    const block = node_children(item)[2];
    const lines = block ? await block_lines(block, signal) : null;
    const line = lines ? lines[0] - 1 : previous === null ? null : previous + 1;
    previous = lines ? lines[1] : line;
    result.push(line);
  }
  return result;
}

export type RenpyConsumers = (
  edge: PickleNode,
  signal?: AbortSignal,
) => Promise<ReadonlySet<string>>;

/** 反向索引容器消费者。标量 GET 保持独立边，容器 GET 才共享子字段。 */
export async function script_consumers(
  root: PickleNode,
  statements: ReadonlyMap<PickleNode, string>,
  signal?: AbortSignal,
): Promise<RenpyConsumers> {
  const checkpoint = create_checkpoint(signal);
  const parents = new Map<PickleNode, Set<PickleNode>>();
  const pending = [root],
    visited = new Set<PickleNode>();
  while (pending.length) {
    const pause = checkpoint();
    if (pause) await pause;
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
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
  return async (edge, signal) => {
    const checkpoint = create_checkpoint(signal);
    const cached = cache.get(edge);
    if (cached) return cached;
    const owners = new Set<string>(),
      seen = new Set<PickleNode>(),
      pending = [edge];
    while (pending.length) {
      const pause = checkpoint();
      if (pause) await pause;
      const node = pending.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const identity = statements.get(node);
      if (identity !== undefined) owners.add(identity);
      else if (node === root) owners.add("<script>");
      else pending.push(...(parents.get(node) ?? []));
    }
    cache.set(edge, owners);
    return owners;
  };
}

type RenpyPhase = "top" | "init" | "runtime";
/** 这些语句保持外层执行阶段，其余 `renpy.ast` 语句在运行时执行。 */
const INIT_PHASE_CLASSES = new Set([
  "renpy.ast.Python",
  "renpy.ast.Define",
  "renpy.ast.PyCode",
  "renpy.ast.PyExpr",
]);
export type RenpyCode = Readonly<{
  mode: PythonMode;
  slot: number;
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
}> &
  (
    | Readonly<{ source: string; edge: PickleNode; legacy?: never }>
    // legacy 指早期 Ren’Py 引擎写入编译文件的 Python AST，与旧 .lg 项目兼容无关。
    | Readonly<{ source: null; edge?: never; legacy: PickleNode }>
  );
/** 源码偏移所在的原始文件行。编译坐标缺失时不制造行号。 */
export function code_line(code: RenpyCode, offset: number): number | null {
  if (code.line === null) return null;
  return code.line + (code.source?.slice(0, offset).split("\n").length ?? 1) - 1;
}
/** 原源码偏移始终保留。编译坐标缺失时不制造文件行列。各槽位的同一问题合并时列出全部槽位。 */
export function code_diagnostic(
  code: RenpyCode,
  diagnostic: PythonDiagnostic,
  slots: readonly number[] = [code.slot],
): ScriptDiagnostic {
  const line = code_line(code, diagnostic.start);
  const before = code.source?.slice(0, diagnostic.start) ?? "";
  return {
    message: `${code.filename ?? "<unknown>"}:${line ?? "?"} / ${code.owner} / slot ${slots.join(", ")} / ${code.field}: [${diagnostic.start}, ${diagnostic.end}) ${diagnostic.reason}`,
    line,
    column:
      line === null || !before.includes("\n") ? null : before.length - before.lastIndexOf("\n"),
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
export async function script_codes(
  script: { slots: readonly CompiledSlot[] },
  identities?: ReadonlyMap<PickleNode, string>,
  signal?: AbortSignal,
): Promise<RenpyCode[]> {
  const checkpoint = create_checkpoint(signal);
  identities ??= await script_identities(script.slots, undefined, signal);
  const result: RenpyCode[] = [];
  for (const slot of script.slots) {
    type Context = Omit<RenpyCode, "source" | "mode" | "slot" | "edge" | "legacy">;
    const seen = new Map<PickleNode, Set<string>>();
    const pending: { edge: PickleNode; context: Context }[] = [
      {
        edge: slot.graph.root,
        context: {
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
        },
      },
    ];
    while (pending.length) {
      const pause = checkpoint();
      if (pause) await pause;
      const { edge, context } = pending.pop()!;
      const node = resolve_node(edge),
        cls = class_name(node),
        fields = attributes(node);
      const identity = identities.get(node);
      const current =
        identity === undefined
          ? { ...context }
          : { ...context, owner: identity, field: "", target: "", display: false };
      const filename = node_text(fields.get("filename")),
        line = node_value(fields.get("linenumber"));
      if (filename) current.filename = filename;
      if (typeof line === "number") current.line = line;
      if (cls === "renpy.ast.Init" || cls === "renpy.ast.EarlyPython") {
        current.phase = current.phase === "top" ? "init" : "runtime";
        current.early = cls === "renpy.ast.EarlyPython";
        const priority = node_value(fields.get("priority"));
        current.priority = current.early ? 0 : typeof priority === "number" ? priority : null;
      } else if (cls.startsWith("renpy.ast.") && !INIT_PHASE_CLASSES.has(cls))
        current.phase = "runtime";
      if (cls === "renpy.ast.Translate" && node_value(fields.get("language")) !== null)
        current.translated = true;
      const compiled = cls === "renpy.ast.PyCode" || is_pyexpr(node);
      const scalar = node.kind === "unicode" || node.kind === "bytes";
      // 同一容器可有多个消费者。同一消费者的循环和别名只访问一次。
      // 身份为 JSON、目标与字段来自 Python 名称，都不含 NUL，可作为无歧义的分隔符。
      const key = [
        current.owner,
        current.phase,
        current.priority,
        current.early,
        current.translated,
        current.target,
        current.display,
        scalar ? edge.start : null,
        compiled || scalar ? current.field : null,
      ].join("\0");
      const contexts = seen.get(node) ?? new Set<string>();
      if (contexts.has(key)) continue;
      contexts.add(key);
      seen.set(node, contexts);
      if (
        compiled ||
        (scalar &&
          (current.display ||
            /^(?:code|positional\.\d+|keyword\.\d+)$/u.test(current.field) ||
            current.field === "who"))
      ) {
        const source_edge = code_edge(edge);
        const [location_file, location_line] = code_location(node);
        const legacy =
          !source_edge && cls === "renpy.ast.PyCode" ? node_children(node.state)[1] : undefined;
        assert(
          source_edge || (legacy && class_name(legacy).startsWith("_ast.")),
          "Missing Ren'Py source or legacy Python AST",
        );
        result.push({
          ...current,
          slot: slot.slot,
          ...(source_edge
            ? { source: node_text(source_edge), edge: source_edge }
            : { source: null, legacy: legacy! }),
          mode: code_mode(node),
          field: current.field || "expression",
          filename: location_file || current.filename,
          line: location_line ?? current.line,
        });
        continue;
      }
      const next: { edge: PickleNode; context: Context }[] = [];
      const descend = (child: PickleNode, field: string, extra: Partial<Context> = {}) =>
        next.push({
          edge: child,
          context: {
            ...current,
            field: current.field ? current.field + "." + field : field,
            ...extra,
          },
        });
      if (cls === "renpy.ast.Define" || cls === "renpy.ast.Default") {
        const code = fields.get("code"),
          target = definition_target(fields);
        if (code)
          descend(code, "code", {
            target,
            display: DISPLAY_DEFINES.includes(target),
          });
      }
      if (cls === "renpy.sl2.slast.SLDisplayable") {
        const displayable = node_text(fields.get("displayable"));
        const display = DISPLAY_SCREEN_DISPLAYABLES.some((name) => displayable.endsWith(name));
        node_children(fields.get("positional")).forEach((child, index) =>
          descend(child, "positional." + index, { display: display && index === 0 }),
        );
        node_children(fields.get("keyword")).forEach((entry, index) => {
          const pair = node_children(entry);
          if (pair[1])
            descend(pair[1], "keyword." + index, {
              display: DISPLAY_SCREEN_KEYWORDS.includes(node_text(pair[0])),
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
      // 反向入栈保持原先深度优先的候选顺序。
      for (let index = next.length - 1; index >= 0; index--) pending.push(next[index]!);
    }
  }
  return result;
}
/** 早期 Ren’Py 引擎保存的 Python AST 直接提供加载访问事实，不创建伪源码。 */
async function legacy_facts(root: PickleNode, signal?: AbortSignal): Promise<PythonFacts> {
  const checkpoint = create_checkpoint(signal);
  const facts = {
    constants: [],
    formatted: [],
    assignments: [],
    references: [] as string[],
    diagnostics: [],
    expression: undefined,
    speaker: { name: undefined, usages: new Map() },
  };
  const seen = new Set<PickleNode>();
  const name = (node: PickleNode | undefined): string => {
    if (!node) return "";
    const fields = attributes(node);
    if (class_name(node) === "_ast.Name") return node_text(fields.get("id"));
    if (class_name(node) === "_ast.Attribute")
      return name(fields.get("value")) + "." + node_text(fields.get("attr"));
    return "";
  };
  const pending = [root];
  while (pending.length) {
    const pause = checkpoint();
    if (pause) await pause;
    const node = resolve_node(pending.pop()!);
    if (seen.has(node)) continue;
    seen.add(node);
    const reference = name(node);
    if (reference) facts.references.push(reference);
    const children = script_children(node);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]!);
  }
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
      ? await legacy_facts(code.legacy, signal)
      : await session.analyze({ source: code.source, mode: code.mode }, python2, signal);
  if (!code.target || !facts.expression) return facts;
  return {
    ...facts,
    references: [...facts.references, code.target],
    assignments: [
      ...facts.assignments,
      { target: code.target, root: true, operation: "=", ...facts.expression },
    ],
  };
}
