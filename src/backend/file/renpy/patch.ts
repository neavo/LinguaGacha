import { create_checkpoint } from "./checkpoint";
import assert from "node:assert/strict";
import { splice } from "../shared/splice";
import { write_compiled } from "./compiled";
import type { RenpyCandidate, RenpyCoordinate } from "./extract";
import type { RenpyMember } from "./member";
import { class_name, edge_edit, pickle_string, read_pickle, type PickleNode } from "./pickle";
import { encode_python } from "./python";
import type { PythonFacts, PythonMode, PythonSession } from "./python-syntax";
import { code_edge, display_text, is_pyexpr, node_children as children, node_text } from "./script";

export type RenpyChange = { candidate: RenpyCandidate; text: string };
export type RenpyLoadingChange = Required<
  Pick<RenpyCoordinate, "slot" | "edge" | "start" | "end">
> & {
  original: string;
};
/** 同一代码字符串的多个 UTF-16 区间先合并，再按原始消费边写回全部槽位。加载补丁与译文共用写回机制。 */
export async function patch_script(
  member: RenpyMember,
  changes: readonly RenpyChange[],
  loading: readonly RenpyLoadingChange[],
  session: PythonSession,
  signal?: AbortSignal,
): Promise<Buffer> {
  const checkpoint = create_checkpoint(signal);
  if (!changes.length && !loading.length) return member.bytes;
  assert(
    loading.every((change) => member.slots.some((slot) => slot.slot === change.slot)),
    "Missing Ren'Py loading slot",
  );
  const slots = [];
  for (const slot of member.slots) {
    const consumers = changes.length ? await member.consumers(slot, signal) : null;
    const edits = new Map<number, { edge: PickleNode; replacement: Buffer }>();
    const codes = new Map<
      number,
      { edge: PickleNode; changes: { start: number; end: number; text: string }[] }
    >();
    const nodes = new Map<number, PickleNode>();
    for (const node of slot.graph.nodes) {
      const pause = checkpoint();
      if (pause) await pause;
      nodes.set(node.start, node);
    }
    const literals = new Map<number, Map<number, PythonFacts["constants"][number]>>(); // 同一代码字符串只扫描一次。
    const code_updates = new Map<PickleNode, string>(); // 哈希更新在全部代码区间合并后执行。
    const sources = new Map<number, { source: string; mode: PythonMode; consistent: boolean }>();
    for (const code of member.codes) {
      const pause = checkpoint();
      if (pause) await pause;
      if (code.slot !== slot.slot || code.source === null) continue;
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
      const pause = checkpoint();
      if (pause) await pause;
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
        const pause = checkpoint();
        if (pause) await pause;
        if (coordinate.slot !== slot.slot) continue;
        const edge = nodes.get(coordinate.edge);
        assert(edge, "Missing Ren'Py coordinate");
        for (const owner of await consumers!(edge, signal)) {
          assert(change.candidate.owners.includes(owner), "Unresolved Ren'Py shared consumer");
          covered.add(owner);
        }
        if (coordinate.start === undefined) {
          assert.equal(display_text(edge), change.candidate.text, "Ren'Py original text changed");
          set(edge, pickle_string(change.text));
          continue;
        }
        const record = source_record(edge);
        if (change.candidate.write_mode === "source")
          // 源码区间的原文就是源码本身，直接比对，无需重新解析。
          assert.equal(
            record.source.slice(coordinate.start, coordinate.end),
            change.candidate.text,
            "Ren'Py code span changed",
          );
        else {
          let tokens = literals.get(edge.start);
          if (!tokens) {
            const facts = await session.analyze(record, member.python2, signal);
            tokens = new Map(facts.constants.map((token) => [token.start, token]));
            literals.set(edge.start, tokens);
          }
          const token = tokens.get(coordinate.start);
          assert(
            token && token.end === coordinate.end && token.value === change.candidate.text,
            "Ren'Py code span changed",
          );
        }
        const entry = codes.get(edge.start) ?? { edge, changes: [] };
        entry.changes.push({
          start: coordinate.start,
          end: coordinate.end!,
          // 源码译文的语法与求值语义归 AGENT 负责，写回不改写也不校验。
          text: change.candidate.write_mode === "source" ? change.text : encode_python(change.text),
        });
        codes.set(edge.start, entry);
      }
      // 每个槽位都须覆盖全部消费者，缺少整个槽位也在此拒绝。
      assert(
        change.candidate.owners.every((owner) => covered.has(owner)),
        "Incomplete Ren'Py slot consumer group",
      );
    }
    for (const { edge, changes: spans } of codes.values()) {
      const original = node_text(edge);
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
      set(edge, pickle_string(source));
      code_updates.set(edge, source);
    }
    for (const node of slot.graph.nodes) {
      const pause = checkpoint();
      if (pause) await pause;
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
    await read_pickle(data, signal); // 产物协议验证不能用原稿已解析代替。
    slots.push({ slot: slot.slot, data });
  }
  return write_compiled(member.bytes, slots);
}
