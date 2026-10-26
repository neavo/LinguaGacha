import { godot_member_kind } from "./member";
import assert from "node:assert/strict";
import { GODOT_RESOURCE_MAX_BYTES } from "./binary";
import type { JsonRecord, JsonValue } from "../../../domain/json";
import type { GameFiles } from "../shared/game/format";
import {
  readable_json,
  write_projection,
  type ProjectionFailure,
  type ReadableFile,
} from "../shared/game/readable";
import type { GodotLocation } from "./item";
import { read_gdsc, print_gdsc } from "./gdsc";
import { read_source } from "./gdscript";
import { read_project } from "./project";
import { read_po } from "./po";
import { read_resource, read_resource_type, RESOURCE_VARIANT_TYPES } from "./resource";
import { read_scene, scene_strings } from "./scene";
import {
  check_locale_member,
  plan_translation_locale,
  read_messages,
  read_translation,
  translation_slot,
  type LocalePlan,
} from "./translation";
import { all_values, MARSHAL_VARIANT_TYPES, type Value } from "./variant";

type ReadableString = { location: GodotLocation; text: string; context: string | null };
type VariantTypes = Readonly<Record<number, string>>;

/**
 * 只生成可读视图，`strings[].location` 与条目的 `godot.location` 结构相同。
 * 语言表最后处理：优化表只存哈希，用其他成员和语言表中出现过的字符串反查消息键。
 */
export async function* read_godot_projections(
  files: GameFiles,
  report?: ProjectionFailure,
  signal?: AbortSignal,
): AsyncGenerator<ReadableFile> {
  const members = new Map<string, Buffer>();
  for (const [name, member] of files) {
    signal?.throwIfAborted();
    try {
      const bytes = Buffer.from(await member.async("uint8array"));
      signal?.throwIfAborted();
      assert(
        bytes.length <= GODOT_RESOURCE_MAX_BYTES,
        "Godot member exceeds format processing limit: " + name,
      );
      members.set(name, bytes);
    } catch (error) {
      signal?.throwIfAborted();
      report?.(name, error);
    }
  }
  const context = new Map<string, Buffer>();
  for (const [name, bytes] of members) {
    try {
      if (check_locale_member(name, bytes)) context.set(name, bytes);
    } catch {
      // 与适配器一致，坏成员不参与语言表计划，错误由该成员自己的投影报告。
    }
  }
  const plan = plan_translation_locale(context),
    keys = new Set<string>(),
    tables = new Map<string, string>(); // 语言表路径 → 资源类型。
  for (const [file, bytes] of members) {
    const type = table_type(file, bytes);
    if (type !== null) tables.set(file, type);
    else yield* write_projection(file, () => read_member(file, bytes, plan, keys), report, signal);
  }
  // 非优化表的消息键也是优化表的候选，先写出非优化表。
  const order = [...tables].sort(
    ([, a], [, b]) => +(a === "OptimizedTranslation") - +(b === "OptimizedTranslation"),
  );
  for (const [file] of order) {
    const bytes = members.get(file)!;
    yield* write_projection(file, () => read_table(file, bytes, plan, keys), report, signal);
  }
}

/** 语言表成员的资源类型，其余成员为 `null`。坏成员也为 `null`，由 `read_member` 写出错误投影。 */
function table_type(file: string, bytes: Buffer): string | null {
  try {
    return godot_member_kind(file, bytes) === "translation"
      ? read_resource_type((length) => bytes.subarray(0, length))
      : null;
  } catch {
    return null;
  }
}

/** 语言表以外的成员。`.gd`、`.po` 原文可读，不生成投影，只提供反查消息键的候选。 */
function read_member(
  file: string,
  bytes: Buffer,
  plan: LocalePlan,
  keys: Set<string>,
): (readonly [string, string])[] {
  const kind = godot_member_kind(file, bytes);
  if (kind === "gd")
    for (const literal of read_source(bytes.toString("utf8"))) keys.add(literal.text);
  if (kind === "po")
    for (const field of read_po(bytes.toString("utf8")))
      if (field.kind === "msgid") keys.add(field.text);
  if (kind === "project") {
    const settings: JsonRecord = {};
    for (const s of read_project(bytes))
      settings[s.name] = variant_json(s.value, MARSHAL_VARIANT_TYPES);
    return [
      [
        file + ".reference.json",
        readable_json({
          internal_file_path: file,
          type: "ProjectSettings",
          settings,
          translation: { fallback: plan.fallback, locale: plan.locale, tables: [...plan.tables] },
        }),
      ],
    ];
  }
  if (kind === "gdsc") {
    const g = read_gdsc(bytes),
      strings: ReadableString[] = [];
    for (const c of g.constants) if (typeof c.value === "string") keys.add(c.value);
    for (const t of g.tokens) {
      const v = g.constants[t.reference];
      if (t.kind === "LITERAL" && v?.type === 4 && typeof v.value === "string")
        strings.push({
          location: { kind: "gdsc", token: t.index },
          text: v.value,
          context: `line ${t.line}`,
        });
    }
    return [
      [file + ".reference.gd", print_gdsc(g)],
      [
        file + ".reference.json",
        readable_json({ internal_file_path: file, type: "GDSC", strings }),
      ],
    ];
  }
  if (kind !== "resource") return [];
  const doc = read_resource(bytes),
    strings: ReadableString[] = [];
  const resources = doc.internal.map(({ path, className }) => ({
    path,
    class: className,
    properties: {} as JsonRecord,
  }));
  // 场景主体 `_bundled` 按节点展开，不重复写入资源属性。
  for (const p of doc.properties)
    if (p.name !== "_bundled")
      resources[p.resource]!.properties[p.name] = variant_json(p.value, RESOURCE_VARIANT_TYPES);
  let body: JsonRecord;
  if (doc.type === "PackedScene") {
    const scene = read_scene(doc),
      nodes = scene.nodes.map(({ path, type, instance, groups }) => ({
        path,
        type,
        instance: instance && variant_json(instance, RESOURCE_VARIANT_TYPES),
        groups,
        properties: {} as JsonRecord,
      }));
    for (const p of scene.properties) {
      nodes[p.node]!.properties[p.property] = variant_json(p.value, RESOURCE_VARIANT_TYPES);
      for (const entry of scene_strings(p))
        strings.push({ location: entry.location, text: entry.value.value, context: entry.context });
    }
    body = { external: doc.external, resources, nodes, connections: scene.connections };
  } else {
    for (const p of doc.properties)
      for (const v of all_values(p.value))
        if ((v.type === 5 || v.type === 44) && typeof v.value === "string")
          strings.push({
            location: { kind: "resource", offset: v.start },
            text: v.value,
            context: `${p.className}.${p.name}`,
          });
    body = { external: doc.external, resources };
  }
  for (const s of strings) keys.add(s.text);
  return [
    [
      file + ".reference.json",
      readable_json({ internal_file_path: file, type: doc.type, ...body, strings }),
    ],
  ];
}

/** 全部 locale 的语言表都写出投影，未选中的表只作对照语料，`selected` 与条目范围一致。 */
function read_table(
  file: string,
  bytes: Buffer,
  plan: LocalePlan,
  keys: Set<string>,
): (readonly [string, string])[] {
  const doc = read_resource(bytes),
    strings: ReadableString[] = [];
  if (doc.type === "OptimizedTranslation") {
    const translation = read_translation(doc),
      slot = translation_slot(translation),
      found = new Map<number, string>();
    for (const key of keys) {
      const index = slot(key);
      if (index !== undefined && !found.has(index)) found.set(index, key);
    }
    for (const s of translation.slots)
      strings.push({
        location: { kind: "slot", word: s.index },
        text: s.text,
        context: found.get(s.index) ?? null, // 其他成员中没有出现的键无法还原。
      });
  } else
    for (const { key, texts } of read_messages(doc)) {
      keys.add(key);
      for (const v of texts)
        strings.push({
          location: { kind: "resource", offset: v.start },
          text: v.value as string,
          context: key,
        });
    }
  return [
    [
      file + ".reference.json",
      readable_json({
        internal_file_path: file,
        type: doc.type,
        locale: String(doc.properties.find((p) => p.name === "locale")?.value.value ?? "en"),
        selected: plan.tables.has(file),
        strings,
      }),
    ],
  ];
}

/** 非 JSON 原生的 Variant 用 `$` 前缀对象标注，向量等数值类型只给出类型名。 */
function variant_json(v: Value, types: VariantTypes): JsonValue {
  if (v.ref)
    return "external" in v.ref ? { $ext: v.ref.external } : { $sub_resource: v.ref.internal };
  const type = types[v.type] ?? String(v.type),
    children = v.children ?? [];
  switch (type) {
    case "NIL":
    case "BOOL":
    case "INT":
    case "FLOAT":
    case "STRING":
      return v.value as JsonValue;
    case "STRING_NAME":
      return { $string_name: v.value as string };
    case "NODE_PATH":
      return { $node_path: v.value as string };
    case "ARRAY":
    case "PACKED_STRING_ARRAY":
      return children.map((child) => variant_json(child, types));
    case "DICTIONARY": {
      const pairs: JsonValue[] = [];
      for (let i = 0; i + 1 < children.length; i += 2)
        pairs.push([variant_json(children[i]!, types), variant_json(children[i + 1]!, types)]);
      return { $dictionary: pairs };
    }
  }
  return { $type: type, ...(v.length === undefined ? {} : { $length: v.length }) };
}
