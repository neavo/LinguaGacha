import { splice } from "../shared/splice";
import { read_speaker_expression, static_character_name } from "./speaker";
import type { ScriptDiagnostic } from "../file-format-types";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { read_compiled, write_compiled, type CompiledSlot } from "./compiled";
import {
  attributes,
  class_name,
  node_string,
  resolve_node,
  edge_edit,
  pickle_string,
  read_pickle,
  type PickleNode,
} from "./pickle";
import { encode_python } from "./python";
import {
  type PythonSession,
  PythonSyntaxError,
  type PythonFacts,
  type PythonMode,
} from "./python-syntax";
import { LEGACY_DISPLAY_CALLS, string_usage, type RenpyUsage } from "./usage";
import {
  node_value as value,
  node_children as children,
  node_text as text,
  script_identities,
  script_excluded,
  code_edge,
  is_pyexpr,
  script_consumers,
  script_codes,
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
export type RenpyCandidate = {
  key: string;
  text: string;
  usage: RenpyUsage;
  coordinates: RenpyCoordinate[];
  owners: string[]; // 本次解析确定的全部语句消费者，不作为可编辑元数据保存。
  percent: boolean; // 代码字面量是 `%` 格式化的左操作数，导出要求译文保持格式记号。不持久化。
  line: number | null; // 原始 `.rpy` 行号，供可读视图定位。不持久化。
};
export type RenpyString = {
  language: string | null;
  old: string;
  text: string;
};
export type RenpyScript = {
  bytes: Buffer;
  digest: string;
  slots: CompiledSlot[];
  candidates: RenpyCandidate[];
  strings: RenpyString[];
  warnings: ScriptDiagnostic[];
  extraction_complete: boolean;
  python2: boolean;
  names: Map<string, string>; // 当前正文写入组到当前姓名写入组，不持久化。
};

/** 早期 Ren’Py 引擎界面脚本的字节串按 UTF-8 解码，保留玩家实际看到的替换字符。 */
const display_text = (node: PickleNode): string => {
  const scalar = resolve_node(node).value;
  return Buffer.isBuffer(scalar) ? scalar.toString("utf8") : node_string(node);
};

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
function write_groups(
  candidates: RenpyCandidate[],
  required: ReadonlyMap<string, Set<string>>,
  slots: readonly CompiledSlot[],
  warnings: ScriptDiagnostic[],
): { candidates: RenpyCandidate[]; extraction_complete: boolean } {
  let extraction_complete = true;
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
      const key = coordinate_key(coordinate),
        prior = targets.get(key);
      if (prior) parents.set(find(candidate), find(prior));
      else targets.set(key, candidate);
    }
  const groups = new Map<RenpyCandidate, RenpyCandidate[]>();
  for (const candidate of candidates) {
    const root = find(candidate),
      group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }
  const result: RenpyCandidate[] = [];
  for (const group of groups.values()) {
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
      extraction_complete = false;
      warnings.push({
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
      extraction_complete = false;
      warnings.push({
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
      percent: group.some((candidate) => candidate.percent),
      coordinates: [
        ...new Map(
          group
            .flatMap((candidate) => candidate.coordinates)
            .map((coordinate) => [coordinate_key(coordinate), coordinate]),
        ).values(),
      ],
    });
  }
  return { candidates: result, extraction_complete };
}

/** 全部槽位先解析，必要索引缺失时让资产创建失败，避免生成不完整的字符串表。 */
export async function extract_script(
  input: Uint8Array,
  python2: boolean,
  session: PythonSession,
): Promise<RenpyScript> {
  const bytes = Buffer.from(input);
  const slots = read_compiled(bytes);
  let extraction_complete = true;
  const candidates = new Map<string, RenpyCandidate>(),
    required = new Map<string, Set<string>>(),
    strings: RenpyString[] = [],
    names = new Map<string, RenpyCoordinate[]>(),
    warnings: ScriptDiagnostic[] = [];
  const excluded = script_excluded(slots);
  const identities = script_identities(slots, excluded);
  const records = script_codes({ slots }, identities);
  for (const slot of slots) {
    const consumers = script_consumers(slot.graph.root, identities);
    const seen_legacy = new Map<PickleNode, Set<string>>();
    /** 同一语句在多个槽位和别名节点中出现时，合并其消费边。 */
    const add = (
      owner: string,
      field: string,
      edge: PickleNode,
      source: string,
      usage: RenpyUsage,
      line: number | null,
      { start, end, percent = false }: { start?: number; end?: number; percent?: boolean } = {},
    ): void => {
      // 用途由位置与当前规则推出，不属于身份。规则调整后，既有条目仍能按位置找回。
      const key = JSON.stringify([owner, field, start ?? null, source]);
      const candidate = candidates.get(key) ?? {
        key,
        text: source,
        usage,
        coordinates: [],
        owners: [owner],
        percent,
        line,
      };
      const required_owners = required.get(key) ?? new Set<string>();
      for (const consumer of consumers(edge)) required_owners.add(consumer);
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
    const legacy = (
      edge: PickleNode,
      record: RenpyCode,
      field: string,
      display = false,
      ancestors = new Set<PickleNode>(),
      name_usage?: boolean, // 外层动态姓名的 code 资格不能被内部 _() 覆盖。
    ) => {
      const node = resolve_node(edge);
      if (ancestors.has(node)) return;
      const next = new Set(ancestors);
      next.add(node);
      const fields = attributes(node);
      if (class_name(node) === "_ast.Str") {
        const string = fields.get("s");
        const seen = seen_legacy.get(node) ?? new Set<string>();
        if (string && !seen.has(record.owner)) {
          seen.add(record.owner);
          seen_legacy.set(node, seen);
          add(
            record.owner,
            field,
            string,
            display_text(string),
            (name_usage ?? display) ? "display" : "code",
            record.line,
          );
        }
        return;
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
          legacy(
            arg,
            record,
            field + ".args." + index,
            index === 0 && LEGACY_DISPLAY_CALLS.includes(name),
            next,
            name_usage ?? (index === 0 ? character_name_usage : undefined),
          ),
        );
        keywords.forEach((keyword, index) =>
          legacy(
            keyword,
            record,
            field + ".keywords." + index,
            false,
            next,
            name_usage ??
              (text(attributes(keyword).get("arg")) === "name" ? character_name_usage : undefined),
          ),
        );
        for (const [key, child] of fields)
          if (key !== "args" && key !== "keywords")
            legacy(child, record, field + "." + key, false, next, name_usage);
      } else {
        node.children.forEach((child, index) =>
          legacy(child, record, field + "." + index, display, next, name_usage),
        );
        for (const [key, child] of fields)
          legacy(child, record, field + "." + key, display, next, name_usage);
      }
    };
    for (const record of records.filter((entry) => entry.slot === slot.slot && !entry.translated)) {
      if (record.source === null) {
        legacy(record.legacy, record, record.field);
        continue;
      }
      let tokens: PythonFacts;
      try {
        tokens = await analyze_code(record, session, python2);
      } catch (error) {
        if (!(error instanceof PythonSyntaxError)) throw error;
        extraction_complete = false;
        warnings.push(code_diagnostic(record, error.diagnostic));
        continue;
      }
      for (const diagnostic of tokens.diagnostics) {
        extraction_complete = false;
        warnings.push(code_diagnostic(record, diagnostic));
      }
      const speaker = await read_speaker_expression(record, tokens, session);
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
      for (const token of tokens.constants) {
        const usage =
          record.field === "who" && speaker.name?.start === token.start
            ? "display"
            : (speaker.usages.get(token.start) ?? string_usage(token, record.display));
        if (!token.writable || (token.dynamic && usage !== "code")) {
          extraction_complete = false;
          warnings.push(
            code_diagnostic(record, {
              start: token.start,
              end: token.end,
              reason: "Dynamic Python string expression",
            }),
          );
          continue;
        }
        if (token.value)
          add(
            record.owner,
            record.field,
            record.edge,
            token.value,
            usage,
            code_line(record, token.start),
            token,
          );
      }
    }
    for (const node of slot.graph.nodes) {
      if (node.kind !== "object" || excluded.has(node)) continue;
      const cls = class_name(node),
        fields = attributes(node),
        owner = identities.get(node) ?? "<script>",
        line = statement_line(node);
      if (cls === "renpy.ast.Say" || cls === "renpy.ast.TranslateSay") {
        const edge = fields.get("what");
        if (edge && value(fields.get("language")) === null)
          add(owner, "what", edge, text(edge), "say", line);
      } else if (cls === "renpy.ast.Menu") {
        const lines = menu_item_lines(node);
        children(fields.get("items")).forEach((item, index) => {
          const edge = children(item)[0];
          if (edge && text(edge))
            add(owner, "items." + index, edge, text(edge), "menu", lines[index]!);
        });
      } else if (cls === "renpy.ast.TranslateString") {
        const language_value = value(fields.get("language"));
        assert(
          language_value === null ||
            typeof language_value === "string" ||
            Buffer.isBuffer(language_value),
          "Invalid translation language",
        );
        const language = language_value === null ? null : text(fields.get("language"));
        const original = text(fields.get("old")),
          translated = text(fields.get("new"));
        const new_line = value(children(fields.get("newloc"))[1]); // `new` 可在 `old` 之后另起一行。
        if (language === null)
          add(
            owner,
            "new",
            fields.get("new")!,
            translated,
            "string",
            typeof new_line === "number" ? new_line : line,
          );
        if (slot === slots.at(-1))
          strings.push({
            language,
            old: original,
            text: translated,
          });
      }
    }
  }
  const grouped = write_groups([...candidates.values()], required, slots, warnings);
  const coordinates = new Map(
    grouped.candidates.flatMap((candidate) =>
      candidate.coordinates.map((coordinate) => [coordinate_key(coordinate), candidate] as const),
    ),
  );
  const dialogue_names = new Map<string, string>();
  for (const dialogue of grouped.candidates) {
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
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    slots,
    candidates: grouped.candidates,
    extraction_complete: extraction_complete && grouped.extraction_complete,
    strings,
    warnings,
    python2,
    names: dialogue_names,
  };
}

export type RenpyChange = { candidate: RenpyCandidate; text: string };
export type RenpyLoadingChange = Required<
  Pick<RenpyCoordinate, "slot" | "edge" | "start" | "end">
> & {
  original: string;
};
/** 同一代码字符串的多个 UTF-16 区间先合并，再按原始消费边写回全部槽位。 */
export async function patch_script(
  script: Pick<RenpyScript, "bytes" | "slots" | "python2">,
  changes: readonly RenpyChange[],
  loading: readonly RenpyLoadingChange[],
  session: PythonSession,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (!changes.length && !loading.length) return script.bytes;
  assert(
    loading.every((change) => script.slots.some((slot) => slot.slot === change.slot)),
    "Missing Ren'Py loading slot",
  );
  for (const { candidate } of changes)
    assert(
      script.slots.every((slot) =>
        candidate.coordinates.some((coordinate) => coordinate.slot === slot.slot),
      ),
      "Incomplete Ren'Py slot write group",
    );
  const slots = [];
  const identities = script_identities(script.slots);
  const records = script_codes(script, identities);
  for (const slot of script.slots) {
    const consumers = changes.length ? script_consumers(slot.graph.root, identities) : null;
    const edits = new Map<number, { edge: PickleNode; replacement: Buffer }>();
    const codes = new Map<
      number,
      { edge: PickleNode; changes: { start: number; end: number; text: string }[] }
    >();
    const nodes = new Map(slot.graph.nodes.map((node) => [node.start, node]));
    const literals = new Map<number, Map<number, PythonFacts["constants"][number]>>(); // 同一代码字符串只扫描一次。
    const code_updates = new Map<PickleNode, string>(); // 哈希更新在全部代码区间合并后执行。
    const sources = new Map<number, { source: string; mode: PythonMode; consistent: boolean }>();
    for (const code of records.filter((entry) => entry.slot === slot.slot)) {
      if (code.source === null) continue;
      const prior = sources.get(code.edge.start);
      sources.set(code.edge.start, {
        source: code.source,
        mode: code.mode,
        consistent: !prior || (prior.consistent && prior.mode === code.mode),
      });
    }
    // 只在写回消费边时拒绝模式冲突，未修改的共享源码保留原样。
    const source_record = (edge: PickleNode) => {
      const record = sources.get(edge.start);
      assert(record, "Missing Ren'Py source record");
      assert(record.consistent, "Conflicting Ren'Py compile modes");
      return record;
    };
    for (const change of loading) {
      if (change.slot !== slot.slot) continue;
      const edge = nodes.get(change.edge);
      assert(edge, "Missing Ren'Py loading coordinate");
      const source = source_record(edge).source;
      assert(
        change.start >= 0 &&
          change.end > change.start &&
          change.end <= source.length &&
          source.slice(change.start, change.end) === change.original,
        "Ren'Py loading span changed",
      );
      const entry = codes.get(edge.start) ?? { edge, changes: [] };
      entry.changes.push({ start: change.start, end: change.end, text: "False" });
      codes.set(edge.start, entry);
    }
    const set = (edge: PickleNode, replacement: Buffer) => {
      const existing = edits.get(edge.start);
      assert(
        !existing || existing.replacement.equals(replacement),
        "Conflicting shared Ren'Py consumer at " + edge.start,
      );
      edits.set(edge.start, { edge, replacement });
    };
    for (const change of changes) {
      const covered = new Set<string>();
      for (const coordinate of change.candidate.coordinates) {
        if (coordinate.slot !== slot.slot) continue;
        const edge = nodes.get(coordinate.edge);
        assert(edge, "Missing Ren'Py coordinate");
        for (const owner of consumers!(edge)) {
          assert(change.candidate.owners.includes(owner), "Unresolved Ren'Py shared consumer");
          covered.add(owner);
        }
        if (coordinate.start === undefined) {
          assert.equal(display_text(edge), change.candidate.text, "Ren'Py original text changed");
          set(edge, pickle_string(change.text));
        } else {
          let tokens = literals.get(edge.start);
          if (!tokens) {
            const facts = await session.analyze(source_record(edge), script.python2, signal);
            tokens = new Map(
              facts.constants
                .filter((token) => token.writable)
                .map((token) => [token.start, token]),
            );
            literals.set(edge.start, tokens);
          }
          const token = tokens.get(coordinate.start);
          assert(
            token &&
              (!token.dynamic || change.candidate.usage === "code") &&
              token.end === coordinate.end &&
              token.value === change.candidate.text,
            "Ren'Py code span changed",
          );
          const entry = codes.get(edge.start) ?? { edge, changes: [] };
          entry.changes.push({
            start: coordinate.start,
            end: coordinate.end!,
            text: encode_python(change.text),
          });
          codes.set(edge.start, entry);
        }
      }
      assert(
        change.candidate.owners.every((owner) => covered.has(owner)),
        "Incomplete Ren'Py slot consumer group",
      );
    }
    for (const { edge, changes: spans } of codes.values()) {
      const original = text(edge);
      let at = 0;
      const parts: string[] = [];
      for (const span of spans.sort((a, b) => a.start - b.start)) {
        assert(
          span.start >= at && span.end >= span.start && span.end <= original.length,
          "Overlapping Ren'Py code changes",
        );
        parts.push(original.slice(at, span.start), span.text);
        at = span.end;
      }
      parts.push(original.slice(at));
      const source = parts.join("");
      await session.analyze({ ...source_record(edge), source }, script.python2, signal);
      set(edge, pickle_string(source));
      code_updates.set(edge, source);
    }
    for (const node of slot.graph.nodes) {
      if (node.kind !== "object") continue;
      const edge = code_edge(node),
        source = edge ? code_updates.get(edge) : undefined;
      if (source === undefined) continue;
      if (is_pyexpr(node)) {
        const hash = children(node.args)[4];
        if (hash) {
          // 引擎按 Unicode 码点计算 FNV-1a，不能按 UTF-8 字节计算。
          let number = 0x811c9dc5;
          for (const char of source)
            number = Math.imul(number ^ char.codePointAt(0)!, 0x01000193) >>> 0;
          const encoded = Buffer.alloc(7);
          encoded[0] = 0x8a;
          encoded[1] = 5;
          encoded.writeUInt32LE(number, 2);
          set(hash, encoded);
        }
      } else if (class_name(node) === "renpy.ast.PyCode") {
        const hash = children(node.state)[5];
        if (hash) set(hash, Buffer.from([0x4e])); // None 让引擎重算代码哈希，保留各版本的内部处理规则。
      }
    }
    const data = splice(
      slot.data,
      [...edits.values()].map((edit) => edge_edit(edit.edge, edit.replacement)),
    );
    read_pickle(data);
    slots.push({ slot: slot.slot, data });
  }
  return write_compiled(script.bytes, slots);
}
