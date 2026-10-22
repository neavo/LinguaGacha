import { PythonSession } from "./python-syntax";
import { expect, it } from "vitest";
import {
  compiled_nodes,
  compiled_slots,
  dictionary,
  object,
  opcode,
  tuple,
} from "../../../test/renpy-fixture";
import { class_name, pickle_string } from "./pickle";
import { read_compiled } from "./compiled";
import { script_codes, analyze_code, code_diagnostic, menu_item_lines } from "./script";

it("PyCode 内的 PyExpr 只按外层 hide 模式分析一次", () => {
  const expression = Buffer.concat([
    Buffer.from("crenpy.astsupport\nPyExpr\n"),
    tuple(pickle_string("    x = 'text'")),
    opcode(0x52),
  ]);
  const code = object("PyCode", tuple(opcode(0x4b, 1), expression, tuple(), pickle_string("hide")));
  const statement = object(
    "Init",
    dictionary({ block: tuple(object("Python", dictionary({ code }))) }),
  );
  expect(script_codes({ slots: read_compiled(compiled_nodes([statement])) })).toMatchObject([
    { source: "    x = 'text'", mode: "hide", phase: "init" },
  ]);
});
it("旧 PyCode 的 Python AST 直接提供加载访问事实", async () => {
  const ast = (name: string, fields: Record<string, Buffer>) =>
    Buffer.concat([
      Buffer.from("c_ast\n" + name + "\n"),
      opcode(0x29, 0x81),
      dictionary(fields),
      opcode(0x62),
    ]);
  const expression = ast("Attribute", {
    value: ast("Name", { id: pickle_string("config") }),
    attr: pickle_string("searchpath"),
  });
  const code = object("PyCode", tuple(opcode(0x4b, 1), expression, tuple(), pickle_string("exec")));
  const statement = object("Screen", dictionary({ name: pickle_string("legacy"), code }));
  const records = script_codes({ slots: read_compiled(compiled_nodes([statement])) });
  expect(records[0]?.source).toBeNull();
  using session = await PythonSession.create();
  const facts = await analyze_code(records[0]!, session, true);
  expect(facts.references).toContain("config.searchpath");
  expect(facts.bare_references).not.toContain("config");
  expect(facts.constants).toEqual([]);
});

const pycode = (source: string, line?: number) =>
  object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      pickle_string(source),
      line === undefined ? tuple() : tuple(pickle_string("game/source.rpy"), opcode(0x4b, line)),
      pickle_string("eval"),
    ),
  );
it("相同源码保留各自来源与槽位，Define 目标不改变源码范围", async () => {
  const define = (name: string, line: number) =>
    object(
      "Define",
      dictionary({
        name: pickle_string(name),
        varname: pickle_string(name),
        code: pycode('"Same"', line),
      }),
    );
  const records = script_codes({
    slots: read_compiled(
      compiled_slots([
        [define("config.name", 10), define("other", 20)],
        [define("config.name", 10), define("other", 20)],
      ]),
    ),
  });
  expect(records).toHaveLength(4);
  expect(new Set(records.map((entry) => entry.slot))).toEqual(new Set([1, 2]));
  expect(records.slice(0, 2).map(({ source, target, line }) => ({ source, target, line }))).toEqual(
    [
      { source: '"Same"', target: "config.name", line: 10 },
      { source: '"Same"', target: "other", line: 20 },
    ],
  );
  expect(records[0]!.edge).not.toBe(records[1]!.edge);
  using session = await PythonSession.create();
  const facts = await analyze_code(records[0]!, session, false);
  expect(facts.constants[0]).toMatchObject({ start: 0, end: 6, value: "Same" });
  expect(facts.assignments).toMatchObject([
    { target: "config.name", start: 0, end: 6, value: "Same" },
  ]);
});
it("共享代码保留每个消费者的用途上下文，缺失编译位置保持未知", () => {
  const shared = Buffer.concat([pycode('"Shared"'), opcode(0x71, 0)]);
  const define = (name: string, code: Buffer) =>
    object("Define", dictionary({ name: pickle_string(name), varname: pickle_string(name), code }));
  const records = script_codes({
    slots: read_compiled(
      compiled_nodes([define("config.name", shared), define("identifier", opcode(0x68, 0))]),
    ),
  });
  expect(records).toHaveLength(2);
  expect(records.map((entry) => entry.display)).toEqual([true, false]);
  expect(records[0]!.edge).toBe(records[1]!.edge);
  const diagnostic = code_diagnostic(records[0]!, { start: 1, end: 4, reason: "uncertain" });
  expect(diagnostic).toMatchObject({ line: null, column: null });
  expect(diagnostic.message).toContain("[1, 4)");
});

it("菜单项行号：选项取子块首行的上一行，标题紧跟上一项", () => {
  const pass = (line: number) => object("Pass", dictionary({ linenumber: opcode(0x4b, line) }));
  const item = (label: string, block: Buffer) =>
    tuple(pickle_string(label), pickle_string("True"), block);
  const menu = object(
    "Menu",
    dictionary({
      linenumber: opcode(0x4b, 10),
      items: tuple(
        item("Caption", opcode(0x4e)),
        item("A", tuple(pass(13))),
        item("B", tuple(pass(16), pass(17))),
        item("After", opcode(0x4e)),
      ),
    }),
  );
  const nodes = read_compiled(compiled_slots([[menu]]))[0]!.graph.nodes;
  expect(menu_item_lines(nodes.find((node) => class_name(node) === "renpy.ast.Menu")!)).toEqual([
    11, 12, 15, 18,
  ]);
});
