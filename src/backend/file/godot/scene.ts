import assert from "node:assert/strict";
import { patch_resource, type ResourceDocument } from "./resource";
import { string, u32 } from "./binary";
import { splice, type Edit } from "../shared/splice";
import type { Value } from "./variant";
import type { GodotLocation } from "./item";
const FLAG_ID_IS_PATH = 1 << 30, // 节点编号改为 `node_paths` 下标。
  FLAG_MASK = (1 << 24) - 1, // 去掉标志位后的下标。
  NO_PARENT_SAVED = 0x7fffffff, // 父节点不在本场景保存。
  TYPE_INSTANTIATED = 0x7fffffff, // 实例化节点的类型由被实例化的场景决定。
  NAME_MASK = (1 << 18) - 1, // 名称下标之上是兄弟序号。
  PROPERTY_MASK = (1 << 30) - 1; // 属性名下标，高位标记 NodePath 属性。
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
/** 打包整数数组按 `int32` 顺序读取，`-1` 表示没有父节点或实例。 */
function int32s(array: Value) {
  const buf = array.value;
  assert(Buffer.isBuffer(buf));
  let index = 0;
  return {
    /** 消费下一个整数，越过数组边界时拒绝场景。 */
    next() {
      assert((index + 1) * 4 <= buf.length);
      return buf.readInt32LE(index++ * 4);
    },
    at: () => array.start + 8 + index * 4, // 跳过类型号与元素数。
    done: () => index * 4 === buf.length, // 场景记录必须恰好消费完整数组。
  };
}
/** PackedScene 的节点属性引用共享 Variant 表，记录引用位置供定点改写。 */
export function read_scene(doc: ResourceDocument) {
  assert.equal(doc.type, "PackedScene");
  const bundled = doc.properties.find((p) => p.name === "_bundled")!.value,
    d = dictionary(bundled),
    names = d.get("names")!.children!.map((v) => v.value as string),
    variants = d.get("variants")!,
    node_paths = (d.get("node_paths")?.children ?? []).map((v) => String(v.value)),
    nodes = int32s(d.get("nodes")!);
  const properties: {
    node: number;
    path: string;
    nodeType: string;
    property: string;
    referenceAt: number;
    value: Value;
  }[] = [];
  const tree: { path: string; type: string | null; instance: Value | null; groups: string[] }[] =
    [];
  // 父节点总在子节点之前，`node_paths` 中的路径相对场景根。
  const path_of = (id: number): string => {
    const path = id & FLAG_ID_IS_PATH ? node_paths[id & FLAG_MASK] : tree[id & FLAG_MASK]?.path;
    assert(path !== undefined, "Invalid scene node reference");
    return path;
  };
  for (let i = 0; i < Number(d.get("node_count")!.value); i++) {
    const parent = nodes.next();
    nodes.next(); // owner
    const type = nodes.next(),
      name = names[nodes.next() & NAME_MASK]!,
      instance = nodes.next(),
      base = parent < 0 || parent === NO_PARENT_SAVED ? null : path_of(parent),
      path = base === null ? "." : base === "." ? name : `${base}/${name}`;
    for (let j = 0, count = nodes.next(); j < count; j++) {
      const prop = nodes.next() & PROPERTY_MASK,
        referenceAt = nodes.at(),
        ref = nodes.next();
      assert(ref < variants.children!.length);
      properties.push({
        node: i,
        path,
        nodeType: names[type] ?? "",
        property: names[prop]!,
        referenceAt,
        value: variants.children![ref]!,
      });
    }
    const groups: string[] = [];
    for (let j = 0, count = nodes.next(); j < count; j++) groups.push(names[nodes.next()]!);
    tree.push({
      path,
      type: type === TYPE_INSTANTIATED ? null : names[type]!,
      instance: instance < 0 ? null : variants.children![instance & FLAG_MASK]!,
      groups,
    });
  }
  assert(nodes.done());
  const conns = int32s(d.get("conns")!),
    version = Number(d.get("version")?.value ?? 1),
    connections: { from: string; signal: string; to: string; method: string }[] = [];
  for (let i = 0; i < Number(d.get("conn_count")!.value); i++) {
    const from = path_of(conns.next()),
      to = path_of(conns.next()),
      signal = names[conns.next()]!,
      method = names[conns.next()]!;
    conns.next(); // flags
    for (let j = 0, count = conns.next(); j < count; j++) conns.next(); // binds
    if (version >= 3) conns.next(); // unbinds
    connections.push({ from, signal, to, method });
  }
  return { doc, properties, variants, nodes: tree, connections };
}
type SceneProperty = ReturnType<typeof read_scene>["properties"][number];
type SceneLocation = Extract<GodotLocation, { kind: "scene" | "scene_value" }>;
export type SceneChange = { location: SceneLocation; original: string; text: string };
type SceneString = {
  location: SceneLocation;
  value: Value & { value: string };
  isKey: boolean;
  context: string;
};

/** 字符串偏移绑定原稿。阅读上下文只展示容器位置。 */
export function* scene_strings(property: SceneProperty): Generator<SceneString> {
  const base = { node: property.node, property: property.property };
  /** 遍历内联容器，并将字典键身份传给整个键子树。 */
  function* visit(value: Value, context: string, isKey: boolean): Generator<SceneString> {
    if ((value.type === 5 || value.type === 44) && typeof value.value === "string") {
      yield {
        location:
          value === property.value
            ? { kind: "scene", ...base }
            : { kind: "scene_value", ...base, offset: value.start },
        value: value as Value & { value: string },
        isKey,
        context,
      };
    } else if (value.type === 26) {
      const children = value.children!;
      for (let i = 0; i < children.length; i += 2) {
        const key = children[i]!;
        yield* visit(key, `${context}[${i / 2}].key`, true);
        const label = typeof key.value === "string" ? JSON.stringify(key.value) : i / 2;
        yield* visit(children[i + 1]!, `${context}[${label}].value`, isKey);
      }
    } else if (value.type === 30 || value.type === 34) {
      for (const [i, child] of value.children!.entries())
        yield* visit(child, `${context}[${i}]`, isKey);
    }
  }
  yield* visit(property.value, `${property.path}:${property.property}`, false);
}

/** 每个目标属性只追加一个 Variant 副本，保留原容器字节及其它节点的共享值。 */
export function patch_scene(
  s: ReturnType<typeof read_scene>,
  changes: readonly SceneChange[],
): Buffer {
  if (!changes.length) return s.doc.bytes;
  const properties = new Map(s.properties.map((p) => [`${p.node}:${p.property}`, p]));
  const groups = new Map<SceneProperty, SceneChange[]>();
  for (const change of changes) {
    const { location } = change;
    const property = properties.get(`${location.node}:${location.property}`);
    assert(property, "Invalid scene property");
    const group = groups.get(property) ?? [];
    group.push(change);
    groups.set(property, group);
  }
  const edits: Edit[] = [],
    added: Buffer[] = [];
  let count = s.variants.children!.length;
  for (const [property, changes] of groups) {
    // 每个属性只遍历一次。共享原值的不同属性分别收集修改。
    const values = new Map([...scene_strings(property)].map(({ value }) => [value.start, value]));
    const replacements = new Map<number, Edit>();
    for (const change of changes) {
      const offset =
        change.location.kind === "scene" ? property.value.start : change.location.offset;
      const value = values.get(offset);
      assert(value, "Invalid scene string offset");
      assert.equal(value.value, change.original, "Stale scene text");
      assert(!replacements.has(offset), "Duplicate scene string");
      replacements.set(offset, {
        start: value.start - property.value.start,
        end: value.end - property.value.start,
        bytes:
          value.encoding === "resource_string"
            ? string(change.text, true)
            : Buffer.concat([u32(value.type), string(change.text, true)]),
      });
    }
    added.push(
      splice(s.doc.body.subarray(property.value.start, property.value.end), [
        ...replacements.values(),
      ]),
    );
    edits.push({ start: property.referenceAt, end: property.referenceAt + 4, bytes: u32(count++) });
  }
  edits.push(
    { start: s.variants.start + 4, end: s.variants.start + 8, bytes: u32(count) },
    { start: s.variants.end, end: s.variants.end, bytes: Buffer.concat(added) },
  );
  return patch_resource(s.doc, edits);
}
