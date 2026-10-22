import { configure_python_parser } from "../backend/file/renpy-game/python-syntax";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { pickle_string } from "../backend/file/renpy-game/pickle";
import { NativeFs } from "../native/native-fs";

configure_python_parser(path.resolve("build/resources/workspace"));

/** 测试自有 RPA，包含多片段与前缀，和读取器的偏移计算独立。 */
export function archive_fixture(entries: ReadonlyMap<string, Uint8Array>, version = 3): Buffer {
  const header_size = version === 3 ? 34 : 25,
    body: Buffer[] = [],
    index: Buffer[] = [Buffer.from([0x80, 2, 0x7d, 0x28])];
  let offset = header_size;
  const integer = (value: number) => {
    const bytes = Buffer.alloc(7);
    bytes[0] = 0x8a;
    bytes[1] = 5;
    bytes.writeUInt32LE(value, 2);
    return bytes;
  };
  for (const [name, data] of entries) {
    const bytes = Buffer.from(data),
      split = Math.floor(bytes.length / 2);
    index.push(pickle_string(name), Buffer.from([0x5d, 0x28]));
    for (const segment of [bytes.subarray(0, split), bytes.subarray(split)]) {
      const prefix = segment.subarray(0, Math.min(2, segment.length)),
        payload = segment.subarray(prefix.length);
      index.push(
        integer(offset),
        integer(segment.length),
        Buffer.from([0x43, prefix.length]),
        prefix,
        Buffer.from([0x87]),
      );
      body.push(payload);
      offset += payload.length;
    }
    index.push(Buffer.from([0x65]));
  }
  index.push(Buffer.from([0x75, 0x2e]));
  const header = Buffer.from(
    `RPA-${version}.0 ${offset.toString(16).padStart(16, "0")}${version === 3 ? " 00000000" : ""}\n`,
  );
  return Buffer.concat([header, ...body, deflateSync(Buffer.concat(index))]);
}
/** 按测试需要构造协议 2 和带 FRAME 的协议 5，不依赖外置编译样本。 */
export function compiled_fixture(layout: "legacy" | "modern" = "modern"): Buffer {
  const modern = layout === "modern";
  const identity = (serial: number): Record<string, Buffer> =>
    modern
      ? {
          filename: pickle_string("game/test.rpy"),
          name_version: opcode(0x4b, 1),
          name_serial: opcode(0x4b, serial),
        }
      : { name: tuple(pickle_string("game/test.rpy"), opcode(0x4b, 1), opcode(0x4b, serial)) };
  const expression = (source: string, line: number) =>
    Buffer.concat([
      Buffer.from(`crenpy.${modern ? "astsupport" : "ast"}\nPyExpr\n`),
      tuple(
        pickle_string(source),
        pickle_string("game/test.rpy"),
        opcode(0x4b, line),
        ...(modern ? [opcode(0x4b, 3), opcode(0x4b, 0)] : []),
      ),
      opcode(0x52),
    ]);
  const definition = (name: string, source: string, serial: number) =>
    object(
      "Define",
      dictionary({
        ...identity(serial),
        store: pickle_string("store"),
        varname: pickle_string(name),
        code: object(
          "PyCode",
          tuple(
            opcode(0x4b, 1),
            expression(source, serial),
            tuple(pickle_string("game/test.rpy"), opcode(0x4b, serial)),
            pickle_string("eval"),
            ...(modern ? [opcode(0x4b, 3), opcode(0x4b, 0)] : []),
          ),
        ),
      }),
    );
  const display = (source: string, serial: number, callable: string) =>
    Buffer.concat([
      Buffer.from("crenpy.sl2.slast\nSLDisplayable\n"),
      opcode(0x29, 0x81),
      dictionary({
        serial: opcode(0x4b, serial),
        location: tuple(pickle_string("game/test.rpy"), opcode(0x4b, serial)),
        displayable: Buffer.from(callable),
        positional: tuple(expression(source, serial)),
        keyword: tuple(),
      }),
      opcode(0x62),
    ]);
  const slots = [1, 2].map((slot) => {
    const say = object(
      modern && slot === 2 ? "TranslateSay" : "Say",
      dictionary({
        ...identity(1),
        identifier: pickle_string("first_line"),
        what: pickle_string("First line [lg_name]."),
      }),
    );
    const nodes = [
      say,
      definition("hero", "Character('Raw Hero')", 2),
      definition("value", "'Program value'", 3),
      display("'Raw Caption'", 4, "crenpy.text.text\nText\n"),
      display("'Raw Button'", 5, "crenpy.ui\n_textbutton\n"),
    ];
    const body = Buffer.concat([
      tuple(
        dictionary({ key: pickle_string("unlocked") }),
        Buffer.concat([opcode(0x5d, 0x28), ...nodes, opcode(0x65)]),
      ),
      opcode(0x2e),
    ]);
    const frame = Buffer.alloc(9);
    frame[0] = 0x95;
    frame.writeBigUInt64LE(BigInt(body.length), 1);
    return deflateSync(
      Buffer.concat([opcode(0x80, modern ? 5 : 2), ...(modern ? [frame] : []), body]),
    );
  });
  const header = Buffer.alloc(46);
  header.write("RENPY RPC2");
  let offset = header.length;
  slots.forEach((bytes, index) => {
    header.writeUInt32LE(index + 1, 10 + index * 12);
    header.writeUInt32LE(offset, 14 + index * 12);
    header.writeUInt32LE(bytes.length, 18 + index * 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...slots, Buffer.alloc(16)]);
}
export const opcode = (...values: number[]) => Buffer.from(values);
export const tuple = (...values: Buffer[]) =>
  Buffer.concat([opcode(0x28), ...values, opcode(0x74)]);
export const dictionary = (values: Record<string, Buffer>) =>
  Buffer.concat([
    opcode(0x7d, 0x28),
    ...Object.entries(values).flatMap(([key, value]) => [pickle_string(key), value]),
    opcode(0x75),
  ]);
export const object = (name: string, state: Buffer) =>
  Buffer.concat([
    Buffer.from("crenpy.ast\n" + name + "\n"),
    opcode(0x29, 0x81),
    state,
    opcode(0x62),
  ]);
export const compiled_nodes = (nodes: readonly Buffer[]) =>
  deflateSync(
    Buffer.concat([
      opcode(0x80, 2),
      tuple(
        dictionary({ key: pickle_string("unlocked") }),
        Buffer.concat([opcode(0x5d, 0x28), ...nodes, opcode(0x65)]),
      ),
      opcode(0x2e),
    ]),
  );
/** 槽位分别构造，测试可以表达静态变换前后不同的节点与共享关系。 */
export function compiled_slots(nodes: readonly (readonly Buffer[])[]): Buffer {
  const header = Buffer.alloc(46);
  header.write("RENPY RPC2");
  let offset = header.length;
  const slots = nodes.map((statements, index) => {
    const bytes = compiled_nodes(statements);
    header.writeUInt32LE(index + 1, 10 + index * 12);
    header.writeUInt32LE(offset, 14 + index * 12);
    header.writeUInt32LE(bytes.length, 18 + index * 12);
    offset += bytes.length;
    return bytes;
  });
  return Buffer.concat([header, ...slots, Buffer.alloc(16)]);
}
export function strings_fixture(
  entries: { language: string | null; old: string; text: string }[],
): Buffer {
  return compiled_nodes(
    entries.map((entry, index) =>
      object(
        "TranslateString",
        dictionary({
          language: entry.language === null ? opcode(0x4e) : pickle_string(entry.language),
          old: pickle_string(entry.old),
          new: pickle_string(entry.text),
          name: tuple(pickle_string("game/strings.rpy"), opcode(0x4b, 1), opcode(0x4b, index)),
        }),
      ),
    ),
  );
}
/** 独立构造初始化与运行时编译结构，不依赖外部游戏或 Python。 */
export function code_fixture(
  source: string,
  context: "init" | "conditional" | "runtime" | "early" = "init",
  priority = 0,
): Buffer {
  const code = object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      pickle_string(source),
      tuple(pickle_string("game/test.rpy"), opcode(0x4b, 1)),
      pickle_string("exec"),
    ),
  );
  const statement = object(
    context === "early" ? "EarlyPython" : "Python",
    dictionary({
      name: tuple(pickle_string("game/test.rpy"), opcode(0x4b, 1), opcode(0x4b, 1)),
      code,
    }),
  );
  if (context === "runtime" || context === "early") return compiled_nodes([statement]);
  const block =
    context === "conditional"
      ? object(
          "If",
          dictionary({ entries: tuple(tuple(pickle_string("persistent.flag"), tuple(statement))) }),
        )
      : statement;
  return compiled_nodes([
    object("Init", dictionary({ priority: opcode(0x4b, priority), block: tuple(block) })),
  ]);
}
/** 最小标准引擎只服务静态发现，测试不启动或执行这些源码。 */
export function create_renpy_fixture(root: string, recursive = false): NativeFs {
  const native = new NativeFs();
  const files = {
    "Game.exe": "MZ",
    "renpy/loader.py":
      "if not renpy.config.force_archives:\n    pass\n" +
      (recursive
        ? "arc_files.sort(reverse=True)\nfor stem, ext, fn in arc_files:\n    pass\nfor j in walkdir(i):\n    pass\n"
        : ""),
    "renpy/main.py":
      "for i in sorted(os.listdir(directory)):\n    pass\nrenpy.config.archives.reverse()\n",
    "renpy/script.py":
      'with open(rpyfn, "rb") as f:\n    rpydigest = hashlib.md5(f.read()).digest()\nrpycdigest = None\nlock = "lock.txt"\n',
    "renpy/config.py": "old_substitutions = True\nforce_archives = False\n",
    "renpy/translation.py":
      "STRING_RE = r'''(?x) __? \\( ((?:[uU]?\"[^\"]*\"|[uU]?'[^']*')+) \\)'''\n",
    "renpy/__init__.py": "version_tuple = (8, 0, 3, 0)\n",
    "renpy/common/00test.rpy": 'init python:\n    message = _("Common question?")\n',
    "game/script.rpyc": compiled_fixture(),
  };
  for (const [name, bytes] of Object.entries(files))
    native.write_file_sync(path.join(root, name), bytes);
  fs.mkdirSync(path.join(root, "lib/py3-windows-x86_64"), { recursive: true });
  return native;
}
