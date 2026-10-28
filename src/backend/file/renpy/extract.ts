import { create_checkpoint } from "./checkpoint";
import { static_character_name } from "./speaker";
import type { ScriptDiagnostic, SourceFileParseWarning } from "../file-format-types";
import assert from "node:assert/strict";
import type { CompiledSlot } from "./compiled";
import { attributes, class_name, resolve_node, type PickleNode } from "./pickle";
import {
  type PythonSession,
  PythonSyntaxError,
  type PythonDiagnostic,
  type PythonFacts,
} from "./python-syntax";
import { LEGACY_DISPLAY_CALLS, string_usage, type RenpyUsage } from "./usage";
import { member_digest, type RenpyMember } from "./member";
import {
  node_value as value,
  node_children as children,
  node_text as text,
  display_text,
  analyze_code,
  code_diagnostic,
  code_line,
  menu_item_lines,
  statement_line,
  type RenpyCode,
} from "./script";

export type RenpyCoordinate = {
  slot: number;
  edge: number; // 未分帧 Pickle 中的消费边偏移。
  field: string;
  start?: number; // 代码字符串内的 UTF-16 区间。
  end?: number;
};
/** `text` 的原文是解码后的文字，写回按字段编码。`source` 的原文是 Python 源码片段，译文直接替换源码区间。 */
export type RenpyWriteMode = "text" | "source";
export type RenpyCandidate = {
  key: string;
  text: string;
  usage: RenpyUsage;
  write_mode: RenpyWriteMode; // 由原稿结构决定，导出从固化原稿恢复，不持久化。
  coordinates: RenpyCoordinate[];
  owners: string[]; // 本次解析确定的全部语句消费者，不作为可编辑元数据保存。
  line: number | null; // 原始 `.rpy` 行号，供可读视图定位。不持久化。
};
/** 诊断按语法错误和提取遗漏分类，供日志区分原因。 */
export type RenpyWarning = ScriptDiagnostic & {
  code: Extract<
    SourceFileParseWarning["code"],
    "script_syntax_error" | "script_extraction_incomplete"
  >;
};
export type RenpyString = {
  language: string | null;
  old: string;
  text: string;
};
export type RenpyScript = {
  digest: string;
  candidates: RenpyCandidate[];
  strings: RenpyString[];
  warnings: RenpyWarning[]; // 解释遗漏原因，正常的默认排除项不产生警告。
  extraction_complete: boolean; // 存在遗漏的写回位置时为 `false`，由遗漏分支记录。
  names: Map<string, string>; // 当前正文写入组到当前姓名写入组，不持久化。
};

/** `TranslateString` 的语言与新旧文本。完整提取与轻量字符串表读取共用。 */
export function string_entry(node: PickleNode): RenpyString {
  const fields = attributes(node);
  const language = value(fields.get("language"));
  assert(
    language === null || typeof language === "string" || Buffer.isBuffer(language),
    "Invalid translation language",
  );
  return {
    language: language === null ? null : text(fields.get("language")),
    old: text(fields.get("old")),
    text: text(fields.get("new")),
  };
}

/** 从早期 Ren’Py 引擎保存的 Python AST 读取静态属性链，不执行游戏代码。 */
function legacy_reference(node: PickleNode | undefined): string {
  if (!node) return "";
  const fields = attributes(node);
  if (class_name(node) === "_ast.Name") return text(fields.get("id"));
  if (class_name(node) === "_ast.Attribute")
    return legacy_reference(fields.get("value")) + "." + text(fields.get("attr"));
  return "";
}

/** 参数展开会使姓名绑定或 dynamic 值不确定。 */
function legacy_has_expansion(fields: ReadonlyMap<string, PickleNode>): boolean {
  return (
    [fields.get("starargs"), fields.get("kwargs")].some(
      (node) => node !== undefined && resolve_node(node).kind !== "none",
    ) ||
    children(fields.get("args")).some((arg) => class_name(arg) === "_ast.Starred") ||
    children(fields.get("keywords")).some((entry) => value(attributes(entry).get("arg")) === null)
  );
}

/** 早期 Ren’Py 引擎的 Python AST 中，普通字符串或单参数标记调用才提供明确姓名。 */
function legacy_name_literal(node: PickleNode | undefined): boolean {
  if (!node) return false;
  if (class_name(node) === "_ast.Str") return true;
  const fields = attributes(node);
  const args = children(fields.get("args"));
  return (
    class_name(node) === "_ast.Call" &&
    legacy_reference(fields.get("func")) === "_" &&
    args.length === 1 &&
    class_name(args[0]!) === "_ast.Str" &&
    children(fields.get("keywords")).length === 0 &&
    !legacy_has_expansion(fields)
  );
}

/** 消费边与源码区间共同确定写入位置，字段名不参与共享边判定。 */
const coordinate_key = (coordinate: RenpyCoordinate) =>
  JSON.stringify([coordinate.slot, coordinate.edge, coordinate.start, coordinate.end]);

/** 共享边连接跨槽位的消费者。缺少任一消费者或槽位时不提供可写条目。 */
async function write_groups(
  candidates: RenpyCandidate[],
  required: ReadonlyMap<string, Set<string>>,
  slots: readonly CompiledSlot[],
  omit: (warning: RenpyWarning) => void,
  signal?: AbortSignal,
): Promise<RenpyCandidate[]> {
  const checkpoint = create_checkpoint(signal);
  const parents = new Map(candidates.map((candidate) => [candidate, candidate])); // 并查集合并经共享边间接相连的候选。
  const find = (candidate: RenpyCandidate): RenpyCandidate => {
    let root = candidate;
    while (parents.get(root) !== root) root = parents.get(root)!;
    while (candidate !== root) {
      const next = parents.get(candidate)!;
      parents.set(candidate, root);
      candidate = next;
    }
    return root;
  };
  const targets = new Map<string, RenpyCandidate>();
  for (const candidate of candidates)
    for (const coordinate of candidate.coordinates) {
      const pause = checkpoint();
      if (pause) await pause;
      const key = coordinate_key(coordinate),
        prior = targets.get(key);
      if (prior) parents.set(find(candidate), find(prior));
      else targets.set(key, candidate);
    }
  const groups = new Map<RenpyCandidate, RenpyCandidate[]>();
  for (const candidate of candidates) {
    const pause = checkpoint();
    if (pause) await pause;
    const root = find(candidate),
      group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }
  const result: RenpyCandidate[] = [];
  for (const group of groups.values()) {
    const pause = checkpoint();
    if (pause) await pause;
    const first = group[0]!,
      owners = [...new Set(group.flatMap((candidate) => candidate.owners))];
    const missing_slot = owners.some((owner) =>
      slots.some(
        (slot) =>
          !group.some(
            (candidate) =>
              candidate.owners.includes(owner) &&
              candidate.coordinates.some((coordinate) => coordinate.slot === slot.slot),
          ),
      ),
    );
    if (missing_slot) {
      omit({
        code: "script_extraction_incomplete",
        message: "Incomplete Ren'Py slot write group: " + first.key,
        line: first.line,
        column: null,
      });
      continue;
    }
    if (
      group.some(
        (candidate) =>
          candidate.text !== first.text ||
          candidate.usage !== first.usage ||
          [...(required.get(candidate.key) ?? [])].some((owner) => !owners.includes(owner)),
      )
    ) {
      omit({
        code: "script_extraction_incomplete",
        message: "Unresolved Ren'Py shared consumer: " + first.key,
        line: first.line,
        column: null,
      });
      continue;
    }
    result.push({
      ...first,
      key:
        group.length === 1
          ? first.key
          : JSON.stringify(group.map((candidate) => candidate.key).sort()),
      owners,
      coordinates: [
        ...new Map(
          group
            .flatMap((candidate) => candidate.coordinates)
            .map((coordinate) => [coordinate_key(coordinate), coordinate]),
        ).values(),
      ],
    });
  }
  return result;
}

/** 从成员分析结果提取全部槽位的候选、写回组、姓名关系和字符串表片段。 */
export async function extract_script(
  member: RenpyMember,
  session: PythonSession,
  signal?: AbortSignal,
): Promise<RenpyScript> {
  const checkpoint = create_checkpoint(signal);
  const { slots, excluded, identities, python2 } = member;
  const candidates = new Map<string, RenpyCandidate>(),
    required = new Map<string, Set<string>>(),
    strings: RenpyString[] = [],
    names = new Map<string, RenpyCoordinate[]>(),
    warnings: RenpyWarning[] = [];
  let extraction_complete = true;
  /** 遗漏写回位置的唯一入口，同时记录完整性和原因。 */
  const omit = (warning: RenpyWarning) => {
    extraction_complete = false;
    warnings.push(warning);
  };
  // 各槽位保存同一源码，同一问题按语句、字段、源码区间和原因合并，并保留出现的槽位。
  const issues = new Map<
    string,
    { code: RenpyWarning["code"]; record: RenpyCode; diagnostic: PythonDiagnostic; slots: number[] }
  >();
  const report = (code: RenpyWarning["code"], record: RenpyCode, diagnostic: PythonDiagnostic) => {
    const key = JSON.stringify([
      code,
      record.owner,
      record.field,
      diagnostic.start,
      diagnostic.end,
      diagnostic.reason,
    ]);
    const issue = issues.get(key);
    if (issue) issue.slots.push(record.slot);
    else issues.set(key, { code, record, diagnostic, slots: [record.slot] });
  };
  for (const slot of slots) {
    const consumers = await member.consumers(slot, signal);
    const seen_legacy = new Map<PickleNode, Set<string>>();
    /** 同一语句在多个槽位和别名节点中出现时，合并其消费边。 */
    const add = async (
      owner: string,
      field: string,
      edge: PickleNode,
      source: string,
      usage: RenpyUsage,
      line: number | null,
      {
        start,
        end,
        write_mode = "text",
      }: { start?: number; end?: number; write_mode?: RenpyWriteMode } = {},
    ): Promise<void> => {
      const pause = checkpoint();
      if (pause) await pause;
      // 用途和写回类别由位置与当前规则推出，不属于身份。规则调整后，既有条目仍能按位置找回。
      const key = JSON.stringify([owner, field, start ?? null, source]);
      const candidate = candidates.get(key) ?? {
        key,
        text: source,
        usage,
        write_mode,
        coordinates: [],
        owners: [owner],
        line,
      };
      const required_owners = required.get(key) ?? new Set<string>();
      for (const consumer of await consumers(edge, signal)) required_owners.add(consumer);
      required.set(key, required_owners);
      const coordinate: RenpyCoordinate = {
        slot: slot.slot,
        edge: edge.start,
        field,
        ...(start !== undefined ? { start, end: end! } : {}),
      };
      if (
        !candidate.coordinates.some(
          (entry) =>
            entry.slot === coordinate.slot &&
            entry.edge === coordinate.edge &&
            entry.start === coordinate.start,
        )
      )
        candidate.coordinates.push(coordinate);
      candidates.set(key, candidate);
    };
    /** 读取早期 Ren’Py 引擎界面脚本保存的 Python AST，按调用位置区分显示字符串和程序值。 */
    const legacy = async (edge: PickleNode, record: RenpyCode, field: string) => {
      type Visit = {
        edge: PickleNode;
        field: string;
        display: boolean;
        ancestors: Set<PickleNode>;
        name_usage: boolean | undefined; // 外层动态姓名的 code 资格不能被内部 _() 覆盖。
      };
      const pending: Visit[] = [
        {
          edge,
          field,
          display: false,
          ancestors: new Set(),
          name_usage: undefined,
        },
      ];
      while (pending.length) {
        const pause = checkpoint();
        if (pause) await pause;
        const { edge, field, display, ancestors, name_usage } = pending.pop()!;
        const visits: Visit[] = [];
        const descend = (
          edge: PickleNode,
          field: string,
          display: boolean,
          ancestors: Set<PickleNode>,
          name_usage?: boolean,
        ) => {
          visits.push({ edge, field, display, ancestors, name_usage });
        };
        const node = resolve_node(edge);
        if (ancestors.has(node)) continue;
        const next = new Set(ancestors);
        next.add(node);
        const fields = attributes(node);
        if (class_name(node) === "_ast.Str") {
          const string = fields.get("s");
          const seen = seen_legacy.get(node) ?? new Set<string>();
          if (string && !seen.has(record.owner)) {
            seen.add(record.owner);
            seen_legacy.set(node, seen);
            await add(
              record.owner,
              field,
              string,
              display_text(string),
              (name_usage ?? display) ? "display" : "code",
              record.line,
            );
          }
          continue;
        }
        if (class_name(node) === "_ast.Call") {
          const func = fields.get("func"),
            function_fields = func ? attributes(func) : new Map<string, PickleNode>();
          const name = text(function_fields.get("attr") ?? function_fields.get("id"));
          const args = children(fields.get("args"));
          const keywords = children(fields.get("keywords"));
          /** 从早期引擎 AST 的参数节点恢复标准调用绑定。 */
          const argument = (name: string, index?: number) => {
            const keyword = keywords.find((entry) => text(attributes(entry).get("arg")) === name);
            return keyword
              ? attributes(keyword).get("value")
              : index === undefined
                ? undefined
                : args[index];
          };
          const dynamic = argument("dynamic"),
            kind = argument("kind", 1);
          const is_none = (node: PickleNode) =>
            legacy_reference(node) === "None" ||
            (class_name(node) === "_ast.NameConstant" &&
              value(attributes(node).get("value")) === null);
          const static_name = static_character_name(
            legacy_reference(func),
            !dynamic
              ? undefined
              : legacy_reference(dynamic) === "False" ||
                  (class_name(dynamic) === "_ast.NameConstant" &&
                    value(attributes(dynamic).get("value")) === false)
                ? false
                : "unknown",
            !!kind && !is_none(kind),
            legacy_has_expansion(fields),
          );
          const character_name_usage =
            static_name === undefined
              ? undefined
              : static_name && legacy_name_literal(argument("name", 0));
          args.forEach((arg, index) =>
            descend(
              arg,
              field + ".args." + index,
              index === 0 && LEGACY_DISPLAY_CALLS.includes(name),
              next,
              name_usage ?? (index === 0 ? character_name_usage : undefined),
            ),
          );
          keywords.forEach((keyword, index) =>
            descend(
              keyword,
              field + ".keywords." + index,
              false,
              next,
              name_usage ??
                (text(attributes(keyword).get("arg")) === "name"
                  ? character_name_usage
                  : undefined),
            ),
          );
          for (const [key, child] of fields)
            if (key !== "args" && key !== "keywords")
              descend(child, field + "." + key, false, next, name_usage);
        } else {
          node.children.forEach((child, index) =>
            descend(child, field + "." + index, display, next, name_usage),
          );
          for (const [key, child] of fields)
            descend(child, field + "." + key, display, next, name_usage);
        }
        for (let index = visits.length - 1; index >= 0; index--) pending.push(visits[index]!);
      }
    };
    for (const record of member.codes) {
      if (record.slot !== slot.slot || record.translated) continue;
      if (record.source === null) {
        await legacy(record.legacy, record, record.field);
        continue;
      }
      let tokens: PythonFacts;
      try {
        tokens = await analyze_code(record, session, python2, signal);
      } catch (error) {
        if (!(error instanceof PythonSyntaxError)) throw error;
        report("script_syntax_error", record, error.diagnostic);
        continue;
      }
      for (const diagnostic of tokens.diagnostics)
        report("script_extraction_incomplete", record, diagnostic);
      const speaker = tokens.speaker;
      if (record.field === "who") {
        const key = JSON.stringify([record.owner, record.slot]),
          entries = names.get(key) ?? [];
        entries.push({
          slot: record.slot,
          edge: record.edge.start,
          field: record.field,
          ...(speaker.name ? { start: speaker.name.start, end: speaker.name.end } : {}),
        });
        names.set(key, entries);
      }
      // 按源码顺序加入，新条目的行序与原稿一致。
      const spans = [
        ...tokens.constants.map((token) => ({ kind: "text", token }) as const),
        ...tokens.formatted.map((token) => ({ kind: "source", token }) as const),
      ].sort((a, b) => a.token.start - b.token.start);
      for (const span of spans) {
        const { start, end } = span.token,
          line = code_line(record, start);
        if (span.kind === "source") {
          // f-string 的显示与求值语义只能结合上下文判断，统一作为默认排除的源码候选。
          const source = record.source.slice(start, end);
          await add(record.owner, record.field, record.edge, source, "code", line, {
            start,
            end,
            write_mode: "source",
          });
          continue;
        }
        const token = span.token;
        const usage =
          record.field === "who" && speaker.name?.start === start
            ? "display"
            : (speaker.usages.get(start) ?? string_usage(token, record.display));
        if (token.value)
          await add(record.owner, record.field, record.edge, token.value, usage, line, {
            start,
            end,
          });
      }
    }
    for (const node of slot.graph.nodes) {
      const pause = checkpoint();
      if (pause) await pause;
      if (node.kind !== "object" || excluded.has(node)) continue;
      const cls = class_name(node),
        fields = attributes(node),
        owner = identities.get(node) ?? "<script>",
        line = statement_line(node);
      if (cls === "renpy.ast.Say" || cls === "renpy.ast.TranslateSay") {
        const edge = fields.get("what");
        if (edge && value(fields.get("language")) === null)
          await add(owner, "what", edge, text(edge), "say", line);
      } else if (cls === "renpy.ast.Menu") {
        const lines = await menu_item_lines(node, signal);
        for (const [index, item] of children(fields.get("items")).entries()) {
          const edge = children(item)[0];
          if (edge && text(edge))
            await add(owner, "items." + index, edge, text(edge), "menu", lines[index]!);
        }
      } else if (cls === "renpy.ast.TranslateString") {
        const entry = string_entry(node);
        const new_line = value(children(fields.get("newloc"))[1]); // `new` 可在 `old` 之后另起一行。
        if (entry.language === null)
          await add(
            owner,
            "new",
            fields.get("new")!,
            entry.text,
            "string",
            typeof new_line === "number" ? new_line : line,
          );
        if (slot === slots.at(-1)) strings.push(entry);
      }
    }
  }
  for (const { code, record, diagnostic, slots: found } of issues.values())
    omit({ code, ...code_diagnostic(record, diagnostic, found) });
  const grouped = await write_groups([...candidates.values()], required, slots, omit, signal);
  const coordinates = new Map(
    grouped.flatMap((candidate) =>
      candidate.coordinates.map((coordinate) => [coordinate_key(coordinate), candidate] as const),
    ),
  );
  const dialogue_names = new Map<string, string>();
  for (const dialogue of grouped) {
    const pause = checkpoint();
    if (pause) await pause;
    if (dialogue.usage !== "say") continue;
    const targets = dialogue.owners.flatMap((owner) =>
      slots.flatMap((slot) => {
        const entries = names.get(JSON.stringify([owner, slot.slot]));
        return entries
          ? entries.map((coordinate) =>
              coordinate.start === undefined
                ? undefined
                : coordinates.get(coordinate_key(coordinate)),
            )
          : [undefined];
      }),
    );
    const name = targets[0];
    // 姓名的全部消费者必须正好属于当前正文组，避免不同对白争写共享姓名。
    if (
      name &&
      targets.every((target) => target === name) &&
      name.owners.length === dialogue.owners.length &&
      name.owners.every((owner) => dialogue.owners.includes(owner)) &&
      name.coordinates.every((coordinate) => coordinate.field === "who")
    )
      dialogue_names.set(dialogue.key, name.key);
  }
  return {
    digest: member_digest(member.bytes),
    candidates: grouped,
    extraction_complete,
    strings,
    warnings,
    names: dialogue_names,
  };
}
