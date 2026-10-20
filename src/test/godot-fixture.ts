import { zstdCompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pad, string, u32, u64 } from "../backend/file/godot/binary";
import { variant_string, variant_strings } from "../backend/file/godot/variant";

/** 按 Godot 二进制协议构造自有工程，测试资产全部由当前测试代码持有。 */
export function create_godot_fixture(version = "4.6"): Map<string, Buffer> {
  const resource_strings = (values: readonly string[]) =>
    Buffer.concat([u32(34), u32(values.length), ...values.map((value) => string(value, true))]);
  const integers = (values: readonly number[]) =>
    Buffer.concat([u32(32), u32(values.length), ...values.map(u32)]);
  const integer = (value: number) => Buffer.concat([u32(3), u32(value)]);
  const bundled = new Map([
    [
      "names",
      resource_strings([
        "Control",
        "Root",
        "Label",
        "Display",
        "Unchanged",
        "text",
        "Inner",
        "ui",
        "pressed",
        "_on_pressed",
      ]),
    ],
    ["variants", Buffer.concat([u32(30), u32(1), u32(5), string("Shared", true)])],
    ["node_count", integer(4)],
    // 节点：parent, owner, type, name, instance, 属性数, (属性, 值)×n, 分组数, 分组×n。
    [
      "nodes",
      integers([
        -1, -1, 0, 1, -1, 0, 0, 0, 0, 2, 3, -1, 1, 5, 0, 0, 0, 0, 2, 4, -1, 1, 5, 0, 0, 1, 0, 0, 6,
        -1, 0, 1, 7,
      ]),
    ],
    ["conn_count", integer(1)],
    ["conns", integers([3, 0, 8, 9, 0, 0, 0])], // Inner.pressed → 根节点 _on_pressed。
    ["node_paths", Buffer.concat([u32(30), u32(0)])],
    ["editable_instances", Buffer.concat([u32(30), u32(0)])],
    ["version", integer(3)],
  ]);
  const scene = build_resource(
    "PackedScene",
    new Map([
      [
        "_bundled",
        Buffer.concat([
          u32(26),
          u32(bundled.size),
          ...[...bundled].flatMap(([name, value]) => [u32(5), string(name, true), value]),
        ]),
      ],
    ]),
    true,
  );
  const messages = ["Translated message", "Shared message"].map((text) => Buffer.from(text + "\0"));
  const strings = Buffer.concat(messages);
  const translation = build_resource(
    "OptimizedTranslation",
    new Map([
      ["hash_table", integers([0])],
      // 一级桶只有一个，二级 seed 为 1，两个消息键的哈希由 Godot 的 FNV 算法确定。
      [
        "bucket_table",
        integers([
          2,
          1,
          3264355950,
          0,
          messages[0]!.length,
          messages[0]!.length,
          2189416014,
          messages[0]!.length,
          messages[1]!.length,
          messages[1]!.length,
        ]),
      ],
      [
        "strings",
        Buffer.concat([u32(31), u32(strings.length), strings, Buffer.alloc(pad(strings.length))]),
      ],
    ]),
  );
  const string_name = (value: string) => Buffer.concat([u32(44), string(value, true)]);
  const array = (items: readonly Buffer[]) => Buffer.concat([u32(30), u32(items.length), ...items]);
  const dictionary = (pairs: readonly (readonly [Buffer, Buffer])[]) =>
    Buffer.concat([u32(26), u32(pairs.length), ...pairs.flat()]);
  // 消息 (msgctxt, msgid → 译文)：("", key → old)、(fruit, apple → one、many)。
  const po = build_resource(
    version === "4.3" ? "TranslationPO" : "Translation",
    new Map([
      [
        "messages",
        version === "4.3"
          ? // TranslationPO：msgctxt → { msgid → PackedStringArray }。
            dictionary([
              [string_name(""), dictionary([[string_name("key"), resource_strings(["old"])]])],
              [
                string_name("fruit"),
                dictionary([[string_name("apple"), resource_strings(["one", "many"])]]),
              ],
            ])
          : // Translation：[msgctxt, msgid] → 译文数组。
            dictionary([
              [array([string_name(""), string_name("key")]), array([string_name("old")])],
              [
                array([string_name("fruit"), string_name("apple")]),
                array([string_name("one"), string_name("many")]),
              ],
            ]),
      ],
      [
        "plural_rules_override",
        Buffer.concat([u32(5), string("nplurals=2; plural=(n != 1);", true)]),
      ],
    ]),
  );
  return new Map([
    [
      "project.binary",
      godot_project_fixture(
        new Map([
          ["application/run/main_scene", variant_string("res://scene.scn")],
          ["internationalization/locale/fallback", variant_string("fr")],
          [
            "internationalization/locale/translations",
            variant_strings(["res://messages.translation"]),
          ],
        ]),
      ),
    ],
    ["main.gdc", game_script_fixture(version === "4.3" ? 100 : 101)],
    ["scene.scn", scene],
    ["messages.translation", translation],
    ["po.translation", po],
    [".godot/global_script_class_cache.cfg", Buffer.from("list=[]\n")],
  ]);
}

/** `extends RefCounted; func values(): return ["Shared", "Shared"]`，行表保留函数体缩进。 */
function game_script_fixture(version: number): Buffer {
  const entries = [
    [59, 0, 1],
    [2, 0, 1],
    [60, 0, 2],
    [2, 1, 2],
    [77, 0, 2],
    [78, 0, 2],
    [version === 100 ? 83 : 84, 0, 2],
    [48, 0, 3],
    [73, 0, 3],
    [3, 0, 3],
    [79, 0, 3],
    [3, 0, 3],
    [74, 0, 3],
  ];
  const body = Buffer.concat([
    u32(2),
    u32(1),
    u32(2),
    ...(version === 100 ? [u32(0)] : []),
    u32(entries.length),
    ...["RefCounted", "values"].flatMap((name) => [
      u32(name.length),
      ...[...name].map((char) => u32((char.codePointAt(0)! ^ 0xb6b6b6b6) >>> 0)),
    ]),
    variant_string("Shared"),
    ...[2, 2, 7, 3, 2, 1, 7, 2].map(u32),
    ...entries.flatMap(([type, reference, line]) => [
      u32((reference! << 8) | type! | 0x80),
      u32(line!),
    ]),
  ]);
  return Buffer.concat([Buffer.from("GDSC"), u32(version), u32(0), body]);
}

/** 小包构造器故意允许非法路径，供读取边界反例使用。 */
export function godot_pack_fixture(
  files: ReadonlyMap<string, Buffer>,
  options: { version?: number; prefix?: Buffer | undefined; relative?: boolean } = {},
): Buffer {
  const version = options.version ?? 2,
    prefix = options.prefix ?? Buffer.alloc(0),
    relative = options.relative ?? true;
  const directory_size =
    4 +
    [...files.keys()].reduce(
      (sum, name) =>
        sum + 40 + Buffer.byteLength("res://" + name) + pad(Buffer.byteLength("res://" + name)),
      0,
    );
  const base = 96 + directory_size + pad(96 + directory_size, 16),
    directory: Buffer[] = [u32(files.size)],
    payload: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const key = Buffer.from("res://" + name),
      padded = Buffer.concat([key, Buffer.alloc(pad(key.length))]);
    directory.push(
      u32(padded.length),
      padded,
      u64(offset),
      u64(bytes.length),
      createHash("md5").update(bytes).digest(),
      u32(0),
    );
    payload.push(bytes, Buffer.alloc(pad(bytes.length, 16)));
    offset += bytes.length + pad(bytes.length, 16);
  }
  const pack = Buffer.concat([
    Buffer.from("GDPC"),
    u32(version),
    u32(4),
    u32(6),
    u32(0),
    u32(relative ? 2 : 0),
    u64(base + (version === 2 && !relative ? prefix.length : 0)),
    ...(version >= 3 ? [u64(96), Buffer.alloc(56)] : [Buffer.alloc(64)]),
    ...directory,
    Buffer.alloc(pad(96 + directory_size, 16)),
    ...payload,
  ]);
  return prefix.length
    ? Buffer.concat([prefix, pack, u64(pack.length), Buffer.from("GDPC")])
    : pack;
}

/** 测试自定配置与 Variant 原字节，按 ECFG 记录长度封装。 */
export function godot_project_fixture(settings: ReadonlyMap<string, Buffer> = new Map()): Buffer {
  return Buffer.concat([
    Buffer.from("ECFG"),
    u32(settings.size),
    ...[...settings].flatMap(([name, value]) => [string(name), u32(value.length), value]),
  ]);
}

/** 独立 token 序列用于验证分类，完整脚本与行表由 game_script_fixture 构造。 */
export function gdsc_fixture(
  version: number,
  tokens: readonly [number, number][],
  constants: readonly string[],
  identifiers: readonly string[] = [],
): Buffer {
  return Buffer.concat([
    Buffer.from("GDSC"),
    u32(version),
    u32(0),
    u32(identifiers.length),
    u32(constants.length),
    u32(0),
    ...(version === 100 ? [u32(0)] : []),
    u32(tokens.length),
    ...identifiers.flatMap((name) => [
      u32([...name].length),
      ...[...name].map((char) => u32((char.codePointAt(0)! ^ 0xb6b6b6b6) >>> 0)),
    ]),
    ...constants.map(variant_string),
    ...tokens.flatMap(([type, reference]) => [
      reference ? u32((reference << 8) | type | 0x80) : Buffer.from([type]),
      u32(1),
    ]),
  ]);
}
/** 单个内部资源的协议夹具，压缩布局以解压体为偏移原点。 */
export function build_resource(
  type: string,
  properties: ReadonlyMap<string, Buffer>,
  compressed = false,
): Buffer {
  const names = [...properties.keys()];
  const header = Buffer.concat([
    u32(0),
    u32(0),
    u32(4),
    u32(0),
    u32(3),
    string(type, true),
    u64(0),
    u32(0),
    Buffer.alloc(8, 255),
    Buffer.alloc(44),
    u32(names.length),
    ...names.map((s) => string(s, true)),
    u32(0),
    u32(1),
    string("local://1", true),
  ]);
  const offset = header.length + 8 + (compressed ? 0 : 4);
  const body = Buffer.concat([
    header,
    u64(offset),
    string(type, true),
    u32(names.length),
    ...names.flatMap((s, i) => [u32(i), properties.get(s)!]),
    Buffer.from("RSRC"),
  ]);
  if (!compressed) return Buffer.concat([Buffer.from("RSRC"), body]);
  const block = zstdCompressSync(body);
  return Buffer.concat([
    Buffer.from("RSCC"),
    u32(2),
    u32(65536),
    u32(body.length),
    u32(block.length),
    block,
    Buffer.from("RSCC"),
  ]);
}

/** 两个内部资源，旧 ID 42 与下标 0 故意不同，验证解析与投影使用同一引用。 */
export function godot_reference_fixture(named: boolean, version = 3): Buffer {
  const bodies = [
    Buffer.concat([string("Resource", true), u32(1), u32(0), u32(5), string("Target", true)]),
    Buffer.concat([string("Resource", true), u32(1), u32(1), u32(24), u32(2), u32(named ? 0 : 42)]),
  ];
  const header = Buffer.concat([
    u32(0),
    u32(0),
    u32(4),
    u32(0),
    u32(version),
    string("Resource", true),
    u64(0),
    u32(named ? 1 : 0),
    Buffer.alloc(8, 255),
    Buffer.alloc(44),
    u32(2),
    string("text", true),
    string("target", true),
    u32(0),
    u32(2),
  ]);
  const paths = [
    string(named ? "local://Resource_target" : "local://42", true),
    string("res://main.res", true),
  ];
  const first = 4 + header.length + paths.reduce((size, p) => size + p.length + 8, 0);
  return Buffer.concat([
    Buffer.from("RSRC"),
    header,
    paths[0]!,
    u64(first),
    paths[1]!,
    u64(first + bodies[0]!.length),
    ...bodies,
    Buffer.from("RSRC"),
  ]);
}

/** 自有脚本及官方 4.3-stable / 4.6-stable 编辑器 export-pack 的原始输出，验证真实 token 契约。 */
export const GODOT_COMPILED_SCRIPT_FIXTURE = {
  source:
    'extends Node\n@export var label: String = "Start"\n\nfunc show_label():\n\tif label == "Start":\n\t\tprint("Nested text")\n\tprint("After nested")\n',
  scripts: {
    "4.3":
      "R0RTQ2QAAAAgAgAAKLUv/WAgAVUIAHILIyiALWYN5rwF5h0i9xV4mxmnIEQtHEb40qEDEqwjCJqrchhFE9LSki1T6qNMz5oa9yImnpUG4yqcJJanOGpBOApoLbVAJRiAVKUhklhjOFAF2gNr0QJrDgxBDWiSQktg/pLfQuTPUAH+jf/jHyFRnY7f4w/5L34M6q9M1Od/P8cP8p+ojGqgMrVRF9UJOyCgAhGyPAJg8BDKGyxoMLWAD86IhQCmDzxZsyVszHkDLbZbmJVvZjjanMXTAydkZjSyPE6ETUdbz+I3cJmtUz5aMLs6W0k5MHDHyE1Li/LNU7Jvudu8aaKW36+UPQuOM9wbjFhgifKPnB8WOHcdrrD2M3DxIZzuXVMG",
    "4.6":
      "R0RTQ2UAAAAcAgAAKLUv/WAcAVUIADLLIiiALWYN5rwF5n2y+wq8zYxTEKIWDiN86dABCdYRBM1VOYyiCWlpyZYp6qNMz5oa9yImnpUG4yqcJJanOGpBOApoLbVAJRiAVKUhklhjOFAF2gNr0QJrDgxBDWiSQktg/pLfQuTPUAH+jf/jHyFRnfd7/CH/xY9B/ZWJ+vwdP8cP8p+ojGqgNuqiOgE7IKACEbrzAmDwEOaNLGYwtYAPzoglAUwbWDJmC21M8way2LYwM5+ZdbShWSxm4ITMjEaWx4mw6WgrWfwGLrNlykcLZldnqylHA3cbuWVpeb57kn3L3c27ifojv91Sdiw4xHBjMMoCC5R/5Pxe4JTrvMKKn//iozqdu6YM",
  },
} as const;
