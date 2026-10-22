import { read_loading } from "./loading";
import { read_compiled, write_compiled } from "./compiled";
import { PythonSession } from "./python-syntax";
import { script_codes } from "./script";
import {
  code_fixture,
  compiled_fixture,
  compiled_nodes,
  compiled_slots,
  object,
  dictionary,
  tuple,
  opcode,
} from "../../../test/renpy-fixture";
import { expect, it } from "vitest";
import { extract_script, patch_script } from "./extract";
import { attributes, class_name, node_string, resolve_node, pickle_string } from "./pickle";

const menu = (serial: number, items: Buffer) =>
  object(
    "Menu",
    dictionary({
      name: tuple(pickle_string("game/shared.rpy"), opcode(0x4b, 1), opcode(0x4b, serial)),
      items,
    }),
  );
const option = () => tuple(tuple(pickle_string("Shared choice"), pickle_string("True"), tuple()));

it.each(["config.window_title", "identifier"])(
  "共享源码的消费者 %s 参与完整写回组",
  async (target) => {
    using session = await PythonSession.create();
    const code = object(
      "PyCode",
      tuple(opcode(0x4b, 1), pickle_string('"Shared"'), tuple(), pickle_string("eval")),
    );
    const define = (name: string, source: Buffer) =>
      object(
        "Define",
        dictionary({ name: pickle_string(name), varname: pickle_string(name), code: source }),
      );
    const script = await extract_script(
      compiled_nodes([
        define("config.name", Buffer.concat([code, opcode(0x71, 0)])),
        define(target, opcode(0x68, 0)),
      ]),
      false,
      session,
    );
    if (target === "identifier") {
      expect(script.candidates).toEqual([]);
      expect(script.warnings.some((entry) => entry.message.includes("shared consumer"))).toBe(true);
    } else {
      expect(script.candidates).toHaveLength(1);
      expect(script.candidates[0]!.owners).toHaveLength(2);
      const output = await extract_script(
        await patch_script(
          script,
          [{ candidate: script.candidates[0]!, text: "共同标题" }],
          [],
          session,
        ),
        false,
        session,
      );
      expect(output.candidates.map((entry) => entry.text)).toEqual(["共同标题"]);
    }
  },
);

it("跨语句共享容器归为一个写回组，各槽位中的独立消费者同时更新", async () => {
  using session = await PythonSession.create();
  const shared = Buffer.concat([option(), opcode(0x71, 0)]);
  const script = await extract_script(
    compiled_slots([
      [menu(1, option()), menu(2, option())],
      [menu(1, shared), menu(2, opcode(0x68, 0))],
    ]),
    false,
    session,
  );
  expect(script.candidates).toHaveLength(1);
  const candidate = script.candidates[0]!;
  expect(candidate.coordinates).toHaveLength(3);
  const output = await extract_script(
    await patch_script(script, [{ candidate, text: "共同译文" }], [], session),
    false,
    session,
  );
  expect(output.candidates.map((entry) => entry.text)).toEqual(["共同译文"]);
  for (const slot of output.slots) {
    const menus = slot.graph.nodes.filter((node) => class_name(node) === "renpy.ast.Menu");
    expect(
      menus.map((node) =>
        node_string(
          resolve_node(resolve_node(attributes(node).get("items")!).children[0]!).children[0]!,
        ),
      ),
    ).toEqual(["共同译文", "共同译文"]);
  }
});

it("共享容器的未知消费者阻止候选写回，不连带修改程序字段", async () => {
  using session = await PythonSession.create();
  const shared = Buffer.concat([option(), opcode(0x71, 0)]);
  const unknown = object(
    "UserStatement",
    dictionary({
      name: tuple(pickle_string("game/shared.rpy"), opcode(0x4b, 1), opcode(0x4b, 2)),
      parsed: opcode(0x68, 0),
    }),
  );
  const script = await extract_script(compiled_nodes([menu(1, shared), unknown]), false, session);
  expect(script.candidates).toEqual([]);
  expect(script.warnings.map((entry) => entry.message).join("\n")).toMatch(/consumer/u);
});

it("只共享字符串 memo 的独立字段仍可分别翻译", async () => {
  using session = await PythonSession.create();
  const label = Buffer.concat([pickle_string("Shared choice"), opcode(0x71, 0)]);
  const options = (text: Buffer) => tuple(tuple(text, pickle_string("True"), tuple()));
  const script = await extract_script(
    compiled_nodes([menu(1, options(label)), menu(2, options(opcode(0x68, 0)))]),
    false,
    session,
  );
  expect(script.candidates).toHaveLength(2);
  const output = await extract_script(
    await patch_script(
      script,
      [{ candidate: script.candidates[0]!, text: "独立译文" }],
      [],
      session,
    ),
    false,
    session,
  );
  expect(output.candidates.map((candidate) => candidate.text)).toEqual([
    "独立译文",
    "Shared choice",
  ]);
});

it("旧界面的 Python AST 仍提取显示文本并保留可写坐标", async () => {
  using session = await PythonSession.create();
  const ast = (name: string, fields: Record<string, Buffer>) =>
    Buffer.concat([
      Buffer.from("c_ast\n" + name + "\n"),
      opcode(0x29, 0x81),
      dictionary(fields),
      opcode(0x62),
    ]);
  const call = ast("Call", {
    func: ast("Name", { id: pickle_string("text") }),
    args: tuple(ast("Str", { s: pickle_string("Legacy caption") })),
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
  const screen = object("Screen", dictionary({ name: pickle_string("legacy"), code }));
  const script = await extract_script(compiled_nodes([screen]), false, session);
  expect(script.warnings).toEqual([]);
  expect(script.candidates).toHaveLength(1);
  expect(script.candidates[0]!.usage).toBe("display");
  expect(
    (
      await extract_script(
        await patch_script(
          script,
          [{ candidate: script.candidates[0]!, text: "旧界面译文" }],
          [],
          session,
        ),
        false,
        session,
      )
    ).candidates[0]!.text,
  ).toBe("旧界面译文");
});

it("无法覆盖全部槽位的候选不开放，写回入口拒绝不完整坐标", async () => {
  using session = await PythonSession.create();
  const bytes = compiled_slots([[menu(1, option())], [menu(2, option())]]);
  const script = await extract_script(bytes, false, session);
  expect(script.candidates).toEqual([]);
  expect(script.warnings.map((entry) => entry.message).join("\n")).toMatch(/slot/u);
  const complete = await extract_script(compiled_fixture(), false, session);
  const original = complete.candidates.find((candidate) => candidate.usage === "say")!;
  const partial = {
    ...original,
    coordinates: original.coordinates.filter((coordinate) => coordinate.slot === 1),
  };
  await expect(
    async () => await patch_script(complete, [{ candidate: partial, text: "译文" }], [], session),
  ).rejects.toThrow(/slot/u);
});

it("新版 PyExpr 界面和角色名可写回，代码缓存哈希同步失效", async () => {
  using session = await PythonSession.create();
  const script = await extract_script(compiled_fixture(), false, session);
  for (const original of ["Raw Caption", "Raw Button", "Raw Hero"]) {
    const candidate = script.candidates.find((entry) => entry.text === original)!;
    expect(candidate?.usage).toBe("display");
    expect(new Set(candidate.coordinates.map((entry) => entry.slot)).size).toBe(2);
    const output = await extract_script(
      await patch_script(script, [{ candidate, text: "新文本🙂" }], [], session),
      false,
      session,
    );
    expect(output.candidates.some((entry) => entry.text === "新文本🙂")).toBe(true);
    for (const slot of output.slots)
      for (const node of slot.graph.nodes) {
        if (node.kind !== "object" || class_name(node) !== "renpy.astsupport.PyExpr") continue;
        const args = resolve_node(node.args!).children;
        if (!node_string(args[0]!).includes("65b0")) continue;
        let hash = 0x811c9dc5;
        for (const char of node_string(args[0]!))
          hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
        expect(Number(resolve_node(args[4]!).value)).toBe(hash);
      }
  }
});
it.each(["legacy", "modern"] as const)(
  "%s 多槽位写回保持身份，重复生成稳定，未修改原字节保留",
  async (layout) => {
    using session = await PythonSession.create();
    const bytes = compiled_fixture(layout);
    const script = await extract_script(bytes, false, session);
    const candidate = script.candidates.find((entry) => entry.usage === "say")!;
    const output = await patch_script(script, [{ candidate, text: "编译译文🙂" }], [], session);
    const rendered = await extract_script(output, false, session);
    const translated = rendered.candidates.find((entry) => entry.text === "编译译文🙂")!;
    expect(new Set(translated.coordinates.map((entry) => entry.slot))).toEqual(new Set([1, 2]));
    const identities = (value: typeof script) =>
      value.slots.flatMap((slot) =>
        slot.graph.nodes
          .filter((node) => node.kind === "object")
          .map((node) => {
            const fields = attributes(node);
            return [
              class_name(node),
              ...["name", "_name", "name_serial", "identifier"].map((key) => {
                const field = fields.get(key);
                if (!field) return null;
                const resolved = resolve_node(field);
                return resolved.children.length
                  ? resolved.children.map((child) => String(resolve_node(child).value))
                  : String(resolved.value);
              }),
            ];
          }),
      );
    expect(identities(rendered)).toEqual(identities(script));
    expect(await patch_script(script, [{ candidate, text: "编译译文🙂" }], [], session)).toEqual(
      output,
    );
    expect(await patch_script(script, [], [], session)).toBe(script.bytes);
    expect(output.subarray(-16)).not.toEqual(bytes.subarray(-16));
  },
);

it("相邻常量按完整区间写回，保留区间外源码并拒绝不完整常量区间", async () => {
  using session = await PythonSession.create();
  const source =
    "renpy.say(actor(a, b), (u'中文🙂' # kept inside constant\r\n '续行')) # outside\r\n";
  const pyexpr = Buffer.concat([
    Buffer.from("crenpy.ast\nPyExpr\n"),
    tuple(pickle_string(source), pickle_string("test.rpy"), opcode(0x4b, 1)),
    opcode(0x52),
  ]);
  const pycode = object(
    "PyCode",
    tuple(
      opcode(0x4b, 1),
      pyexpr,
      tuple(pickle_string("test.rpy"), opcode(0x4b, 1)),
      pickle_string("exec"),
    ),
  );
  const statement = object(
    "Python",
    dictionary({ name: tuple(pickle_string("test.rpy"), opcode(0x4b, 1)), code: pycode }),
  );
  const script = await extract_script(compiled_nodes([statement]), false, session);
  expect(script.warnings).toEqual([]);
  expect(script.candidates).toHaveLength(1);
  const candidate = script.candidates[0]!;
  expect(candidate).toMatchObject({ text: "中文🙂续行", usage: "say" });
  const output = await extract_script(
    await patch_script(script, [{ candidate, text: "新文" }], [], session),
    false,
    session,
  );
  const strings = output.slots[0]!.graph.nodes.filter(
    (node) => node.kind === "unicode" || node.kind === "bytes",
  ).map((node) => node_string(node));
  expect(strings).toContain('renpy.say(actor(a, b), (u"\\u65b0\\u6587")) # outside\r\n');
  const partial = {
    ...candidate,
    coordinates: candidate.coordinates.map((coordinate) => ({
      ...coordinate,
      end: coordinate.start! + 7,
    })),
  };
  await expect(
    patch_script(script, [{ candidate: partial, text: "新文" }], [], session),
  ).rejects.toThrow("code span changed");
});

it("Python 2 原稿与写回使用同一解码条件，不确定常量不能通过手造坐标写入", async () => {
  using session = await PythonSession.create();
  const source = String.raw`Text(u"Known"); Text("\u0061")`;
  const code = object(
    "PyCode",
    tuple(opcode(0x4b, 1), pickle_string(source), tuple(), pickle_string("exec")),
  );
  const bytes = compiled_nodes([
    object("Python", dictionary({ name: pickle_string("decode"), code })),
  ]);
  const script = await extract_script(bytes, true, session);
  expect(script.candidates.map((entry) => entry.text)).toEqual(["Known"]);
  expect(script.warnings[0]?.message).toContain("Ambiguous Python 2");
  const patched = await patch_script(
    script,
    [{ candidate: script.candidates[0]!, text: "确定译文" }],
    [],
    session,
  );
  expect((await extract_script(patched, true, session)).candidates[0]?.text).toBe("确定译文");
  const python3 = await extract_script(bytes, false, session);
  const uncertain = python3.candidates.find((entry) => entry.text === "a")!;
  await expect(
    patch_script(script, [{ candidate: uncertain, text: "unsafe" }], [], session),
  ).rejects.toThrow("code span changed");
});

it("改写消费原始坐标与原值，并保留配置读取和后续赋值", async () => {
  using session = await PythonSession.create();
  const data = read_compiled(
    code_fixture(
      "config.force_archives = (True)\nprevious = config.force_archives\nconfig.force_archives = False",
    ),
  )[0]!.data;
  const bytes = write_compiled(
    compiled_fixture(),
    [1, 2].map((slot) => ({ slot, data })),
  );
  const script = { bytes, slots: read_compiled(bytes), python2: false };
  const loading = await read_loading(script, "game/test.rpyc", { archives: "top-level" }, session);
  const output = await patch_script(script, [], loading.changes, session);
  expect(script_codes({ slots: read_compiled(output) }).map((code) => code.source)).toEqual([
    "config.force_archives = False\nprevious = config.force_archives\nconfig.force_archives = False",
    "config.force_archives = False\nprevious = config.force_archives\nconfig.force_archives = False",
  ]);
  await expect(
    patch_script(
      script,
      [],
      loading.changes.map((change) => ({ ...change, original: "False" })),
      session,
    ),
  ).rejects.toThrow("loading span changed");
});

it("候选行号指向原始脚本行：代码字面量按源码内换行偏移，对白取语句行号", async () => {
  using session = await PythonSession.create();
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
  const script = await extract_script(
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
    false,
    session,
  );
  expect(Object.fromEntries(script.candidates.map((entry) => [entry.text, entry.line]))).toEqual({
    Second: 11,
    Line: 20,
  });
});
