import { setImmediate } from "node:timers";
import { extract_script } from "./extract";
import { PythonSession } from "./python-syntax";
import {
  code_fixture,
  compiled_nodes,
  compiled_slots,
  object,
  dictionary,
  tuple,
  opcode,
  extract_fixture,
  strings_fixture,
  menu_fixture as menu,
  menu_option_fixture as option,
} from "../../../test/renpy-fixture";
import { expect, it } from "vitest";
import { read_member } from "./member";
import { pickle_string } from "./pickle";

it.each(["开始前", "提取中"])("纯字符串表在%s取消时拒绝交付候选", async (when) => {
  using session = await PythonSession.create();
  const member = await read_member(
    strings_fixture(
      Array.from({ length: 2048 }, (_, index) => ({
        language: null,
        old: String(index),
        text: String(index),
      })),
    ),
    false,
  );
  expect(member.codes).toEqual([]);
  const controller = new AbortController();
  const reason = new Error("cancel extraction");
  if (when === "开始前") controller.abort(reason);
  else setImmediate(() => controller.abort(reason));
  await expect(
    extract_script(member, session, controller.signal).then(() => "completed"),
  ).rejects.toBe(reason);
});

it("各槽位的同一问题合并为一条诊断，语法错误与提取遗漏分别归类", async () => {
  const python = (source: string) =>
    object(
      "Python",
      dictionary({
        name: tuple(pickle_string("game/test.rpy"), opcode(0x4b, 1), opcode(0x4b, 1)),
        code: object(
          "PyCode",
          tuple(opcode(0x4b, 1), pickle_string(source), tuple(), pickle_string("exec")),
        ),
      }),
    );
  for (const [source, code] of [
    ["x = b'bytes'", "script_extraction_incomplete"],
    ["x = (", "script_syntax_error"],
  ] as const) {
    const script = await extract_fixture(compiled_slots([[python(source)], [python(source)]]));
    expect(script.warnings).toEqual([
      expect.objectContaining({
        code,
        message: expect.stringContaining("slot 1, 2"),
      }),
    ]);
  }
});

it("共享容器的未知消费者阻止候选写回，不连带修改程序字段", async () => {
  const shared = Buffer.concat([option(), opcode(0x71, 0)]);
  const unknown = object(
    "UserStatement",
    dictionary({
      name: tuple(pickle_string("game/shared.rpy"), opcode(0x4b, 1), opcode(0x4b, 2)),
      parsed: opcode(0x68, 0),
    }),
  );
  const script = await extract_fixture(compiled_nodes([menu(1, shared), unknown]));
  expect(script.candidates).toEqual([]);
  expect(script.warnings.map((entry) => entry.message).join("\n")).toMatch(/consumer/u);
});

it("候选行号指向原始脚本行：代码字面量按源码内换行偏移，对白取语句行号", async () => {
  const code = object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      pickle_string('a = 1\nb = Text("Second")'),
      tuple(pickle_string("game/test.rpy"), opcode(0x4b, 10)),
      pickle_string("exec"),
    ),
  );
  const identity = (serial: number) =>
    tuple(pickle_string("game/test.rpy"), opcode(0x4b, 1), opcode(0x4b, serial));
  const script = await extract_fixture(
    compiled_nodes([
      object("Python", dictionary({ name: identity(1), code })),
      object(
        "Say",
        dictionary({
          name: identity(2),
          linenumber: opcode(0x4b, 20),
          what: pickle_string("Line"),
        }),
      ),
    ]),
  );
  expect(Object.fromEntries(script.candidates.map((entry) => [entry.text, entry.line]))).toEqual({
    Second: 11,
    Line: 20,
  });
});

it.each([
  ["Character('Name')", "display"],
  ["Character(_('Name'), dynamic=True)", "code"],
])("姓名参数的默认资格只取决于当前 Character 调用：%s", async (expression, usage) => {
  const script = await extract_fixture(code_fixture(`a = ${expression}`));
  expect(script.candidates).toMatchObject([{ text: "Name", usage }]);
  expect(script.warnings).toEqual([]);
});

it.each([
  ["positional", "display"],
  ["keyword", "display"],
  ["dynamic", "code"],
  ["unknown-kind", "code"],
  ["explicit-static", "display"],
  ["expanded", "code"],
  ["dynamic-marker", "code"],
] as const)("早期 Ren’Py 引擎 Python AST 的 Character 姓名资格：%s", async (mode, usage) => {
  const ast = (name: string, fields: Record<string, Buffer>) =>
    Buffer.concat([
      Buffer.from("c_ast\n" + name + "\n"),
      opcode(0x29, 0x81),
      dictionary(fields),
      opcode(0x62),
    ]);
  const reference = (name: string) => ast("Name", { id: pickle_string(name) });
  const keyword = (name: string, value: Buffer) =>
    ast("keyword", { arg: pickle_string(name), value });
  const literal = ast("Str", { s: pickle_string("Alice") });
  const name =
    mode === "dynamic-marker"
      ? ast("Call", { func: reference("_"), args: tuple(literal) })
      : literal;
  const keywords: Buffer[] = [];
  if (mode === "keyword") keywords.push(keyword("name", name));
  if (mode === "dynamic" || mode === "dynamic-marker")
    keywords.push(keyword("dynamic", reference("True")));
  if (mode === "unknown-kind" || mode === "explicit-static")
    keywords.push(keyword("kind", reference("unknown")));
  if (mode === "explicit-static") keywords.push(keyword("dynamic", reference("False")));
  const call = ast("Call", {
    func: reference("Character"),
    args: mode === "keyword" ? tuple() : tuple(name),
    keywords: tuple(...keywords),
    ...(mode === "expanded" ? { kwargs: reference("options") } : {}),
  });
  const code = object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      ast("Module", { body: tuple(call) }),
      tuple(pickle_string("game/legacy.rpy"), opcode(0x4b, 1)),
      pickle_string("exec"),
    ),
  );
  const script = await extract_fixture(
    compiled_nodes([object("Screen", dictionary({ name: pickle_string("legacy"), code }))]),
    true,
  );
  expect(script.candidates).toHaveLength(1);
  expect(script.candidates[0]).toMatchObject({ text: "Alice", usage });
});
