import assert from "node:assert/strict";
import { read_resource, patch_resource, resource_string } from "./resource";
import { string, u32, type Edit } from "./binary";
import type { Value } from "./variant";
/** 场景字典按键值交替存储，键必须是字符串。 */
export function dictionary(node: Value): Map<string, Value> {
  assert(node.type === 26);
  const m = new Map<string, Value>();
  const c = node.children!;
  for (let i = 0; i < c.length; i += 2) {
    assert(typeof c[i]!.value === "string");
    m.set(c[i]!.value as string, c[i + 1]!);
  }
  return m;
}
/** PackedScene 的节点属性引用共享 Variant 表，记录引用位置供定点改写。 */
export function read_scene(bytes: Buffer) {
  const doc = read_resource(bytes);
  assert.equal(doc.type, "PackedScene");
  const bundled = doc.properties.find((p) => p.name === "_bundled")!.value,
    d = dictionary(bundled),
    names = d.get("names")!.children!.map((v) => v.value as string),
    variants = d.get("variants")!,
    nodes = d.get("nodes")!,
    buf = nodes.value;
  assert(Buffer.isBuffer(buf));
  const properties: {
    node: number;
    nodeName: string;
    nodeType: string;
    property: string;
    reference: number;
    referenceAt: number;
    value: Value;
  }[] = [];
  let index = 0;
  const next = () => {
    assert((index + 1) * 4 <= buf.length);
    return buf.readUInt32LE(index++ * 4);
  };
  for (let i = 0; i < Number(d.get("node_count")!.value); i++) {
    next();
    next();
    const type = next(),
      nodeName = names[next() & 0x3ffff]!;
    next();
    const count = next();
    for (let j = 0; j < count; j++) {
      const prop = next() & 0x3fffffff,
        referenceAt = nodes.start + 8 + index * 4,
        ref = next();
      assert(ref < variants.children!.length);
      properties.push({
        node: i,
        nodeName,
        nodeType: names[type] ?? "",
        property: names[prop]!,
        reference: ref,
        referenceAt,
        value: variants.children![ref]!,
      });
    }
    const groups = next();
    for (let j = 0; j < groups; j++) next();
  }
  assert.equal(index * 4, buf.length);
  return { doc, properties, variants };
}
/** 追加目标属性的 Variant 并重定向引用，避免修改其它节点的共享值。 */
export function patch_scene(
  bytes: Buffer,
  changes: ReadonlyMap<string, { original: string; text: string }>,
): Buffer {
  if (!changes.size) return bytes;
  const s = read_scene(bytes),
    edits: Edit[] = [],
    added: Buffer[] = [];
  let count = s.variants.children!.length;
  for (const [key, c] of changes) {
    const p = s.properties.find((p) => `${p.node}:${p.property}` === key);
    assert(p && (p.value.type === 5 || p.value.type === 44), "Invalid scene property");
    assert.equal(p.value.value, c.original, "Stale scene text");
    added.push(
      p.value.type === 44
        ? Buffer.concat([u32(44), string(c.text, true)])
        : resource_string(c.text),
    );
    edits.push({ start: p.referenceAt, end: p.referenceAt + 4, bytes: u32(count++) });
  }
  edits.push(
    { start: s.variants.start + 4, end: s.variants.start + 8, bytes: u32(count) },
    { start: s.variants.end, end: s.variants.end, bytes: Buffer.concat(added) },
  );
  return patch_resource(bytes, edits);
}
