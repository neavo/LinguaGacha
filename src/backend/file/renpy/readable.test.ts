import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  compiled_nodes,
  create_renpy_fixture,
  dictionary,
  object,
  opcode,
  tuple,
} from "../../../test/renpy-fixture";
import { GAME_METADATA_MEMBER, GameFormat, read_game_container } from "../shared/game/format";
import { read_renpy_metadata } from "./item";
import { pickle_string } from "./pickle";
import { read_renpy_sources } from "./readable";
import { create_renpy_adapter } from "./renpy-format";
import { build_renpy_metadata, collect_renpy_files, discover_renpy_source } from "./source";

type Projection = {
  strings: {
    key: string;
    text: string;
    usage: string;
    line: number | null;
    source_line: number | null;
  }[];
};

/** 第 3 行起的 Python 块与同在第 7 行的两句对白（三引号对白拆分），行号来自编译数据。 */
function lines_fixture(): Buffer {
  const identity = (serial: number) =>
    tuple(pickle_string("game/lines.rpy"), opcode(0x4b, 1), opcode(0x4b, serial));
  const code = object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      pickle_string("\nx = 1\ny = Text('Hi')"),
      tuple(pickle_string("game/lines.rpy"), opcode(0x4b, 3)),
      pickle_string("exec"),
    ),
  );
  return compiled_nodes([
    object("Python", dictionary({ name: identity(1), linenumber: opcode(0x4b, 3), code })),
    object(
      "Say",
      dictionary({
        name: identity(2),
        linenumber: opcode(0x4b, 7),
        who: pickle_string("e"),
        what: pickle_string("Hello"),
      }),
    ),
    object(
      "Say",
      dictionary({
        name: identity(3),
        linenumber: opcode(0x4b, 7),
        who: pickle_string("e"),
        what: pickle_string("World"),
      }),
    ),
  ]);
}

it("可读视图按原行号还原脚本，字符串的视图行与原稿行分开给出，键与条目一致", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-readable-"));
  const native = create_renpy_fixture(temp.path);
  const game = (await discover_renpy_source(temp.path, native))!;
  const files = collect_renpy_files(game, native);
  const members = new Map([...files.data, ["game/lines.rpyc", lines_fixture()]]);
  const container = await new GameFormat(create_renpy_adapter(), native).create_container(
    members,
    "demo.renpy",
    temp.path,
    undefined,
    await build_renpy_metadata(game, files, native),
  );
  const { input } = await read_game_container(container.content, "demo.renpy", true);
  const outputs = new Map<string, string>();
  for await (const [name, bytes] of read_renpy_sources(input))
    outputs.set(name, Buffer.from(bytes).toString());
  const projection = (name: string) => JSON.parse(outputs.get(name + ".json")!) as Projection;

  expect(JSON.parse(outputs.get(GAME_METADATA_MEMBER)!)).toMatchObject({
    common: ["Common question?"],
  });

  const script = outputs.get("game/lines.rpyc.rpy")!.split("\n");
  expect(script.slice(2, 8)).toEqual([
    "python:",
    "    x = 1",
    "    y = Text('Hi')",
    "",
    'e "Hello"',
    'e "World"',
  ]);
  const strings = projection("game/lines.rpyc").strings;
  expect(strings.map(({ text, line, source_line }) => [text, line, source_line])).toEqual([
    ["Hi", 5, 5],
    ["Hello", 7, 7],
    ["World", 8, 7],
  ]);

  const handler = await create_renpy_adapter().create_members(input);
  const read = await handler.read_file(new Uint8Array(), "game/script.rpyc");
  expect(
    projection("game/script.rpyc")
      .strings.map((entry) => entry.key)
      .sort(),
  ).toEqual(read.items.map((item) => read_renpy_metadata(item.extra_field).key).sort());
});
