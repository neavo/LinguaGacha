import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { configure_python_parser, PythonSession } from "./python-syntax";

configure_python_parser(path.resolve("build/resources/workspace"));

it("UTF-16 坐标覆盖括号、缩进、CRLF 和相邻常量，调用位置来自语法结构", async () => {
  using session = await PythonSession.create();
  const source = "  renpy.say(actor(a, b), (u'中文🙂' # comment\r\n    '续行'))\r\n";
  const facts = await session.analyze({ source, mode: "hide" });
  expect(facts.diagnostics).toEqual([]);
  expect(facts.constants).toHaveLength(1);
  const constant = facts.constants[0]!;
  expect(constant).toMatchObject({
    value: "中文🙂续行",
    call: "renpy.say",
    argument: { kind: "positional", index: 1 },
  });
  expect(source.slice(constant.start, constant.end)).toBe("u'中文🙂' # comment\r\n    '续行'");
  const expression = await session.analyze({ source: " ('🙂' '中') ", mode: "eval" });
  expect(expression.constants[0]).toMatchObject({ start: 2, end: 10, value: "🙂中", whole: true });
});
it.each([
  "print >>out, 'text'\nexec value in scope\nx = `value`\ny = 1L",
  "match value:\n    case 1:\n        text = 'matched'",
])("Python 兼容语法：%s", async (source) => {
  using session = await PythonSession.create();
  expect((await session.analyze({ source, mode: "exec" })).constants).toHaveLength(1);
});
it("加载赋值保留逻辑根与用户条件，字符串和注释不冒充配置访问", async () => {
  using session = await PythonSession.create();
  const facts = await session.analyze({
    source:
      "    config.archives = ['a', 'b']\n    if enabled:\n        config.force_archives = True\n    x = 'config.searchpath' # config.file_open_callback",
    mode: "exec",
  });
  expect(facts.assignments.slice(0, 2)).toMatchObject([
    { target: "config.archives", root: true, value: ["a", "b"] },
    { target: "config.force_archives", root: false, value: true },
  ]);
  expect(facts.references).not.toContain("config.searchpath");
  expect(facts.references).not.toContain("config.file_open_callback");
});
it("动态拼接、字节串与 f-string 不冒充可写常量", async () => {
  using session = await PythonSession.create();
  const facts = await session.analyze({
    source: "x = 'hello' + name\ny = f'{name}'\nz = b'bytes'",
    mode: "exec",
  });
  expect(facts.constants).toMatchObject([{ value: "hello", dynamic: true }]);
  expect(facts.diagnostics).toHaveLength(2);
});
it.each(["if True:\npass", "def f():", "'unclosed"])(
  "拒绝容错恢复的无效源码：%s",
  async (source) => {
    using session = await PythonSession.create();
    await expect(session.analyze({ source, mode: "exec" })).rejects.toThrow(
      "Invalid Python syntax",
    );
  },
);
it("解析让出事件循环，取消后同一会话可以重用，独立操作互不占用解析器", async () => {
  using session = await PythonSession.create();
  const controller = new AbortController();
  const pending = session.analyze(
    { source: "x = 'text'\n".repeat(100000), mode: "exec" },
    false,
    controller.signal,
  );
  const rejection = expect(pending).rejects.toThrow("cancelled");
  await setImmediate();
  controller.abort(new Error("cancelled"));
  await rejection;
  expect((await session.analyze({ source: "'reused'", mode: "eval" })).constants[0]?.value).toBe(
    "reused",
  );
  using other = await PythonSession.create();
  const results = await Promise.all([
    session.analyze({ source: "'first'", mode: "eval" }),
    other.analyze({ source: "'second'", mode: "eval" }),
  ]);
  expect(results.map((result) => result.constants[0]?.value)).toEqual(["first", "second"]);
});

it("旧式百分号保留可写常量和调用用途，转义反斜线不冒充 Unicode 转义", async () => {
  using session = await PythonSession.create();
  const facts = await session.analyze(
    { source: String.raw`Text(u'Hello %s' % name); x = '\\u0061'`, mode: "exec" },
    true,
  );
  expect(facts.constants).toMatchObject([
    { value: "Hello %s", call: "Text", dynamic: false },
    { value: "\\u0061", dynamic: false },
  ]);
  expect(facts.diagnostics).toEqual([]);
});

it("运行资源缺失报告配置路径，恢复配置后可以继续操作", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-python-missing-"));
  configure_python_parser(temp.path);
  try {
    await expect(PythonSession.create()).rejects.toThrow(
      path.join(temp.path, "python/tree-sitter-python.wasm"),
    );
  } finally {
    configure_python_parser(path.resolve("build/resources/workspace"));
  }
  using session = await PythonSession.create();
  expect((await session.analyze({ source: "'available'", mode: "eval" })).constants[0]?.value).toBe(
    "available",
  );
});

it("参数绑定区分关键字、确定位置和展开后的未知位置，嵌套调用保持所属关系", async () => {
  using session = await PythonSession.create();
  const facts = await session.analyze(
    {
      source:
        'Text(font="f", text="t"); Text("p", *args, "uncertain", text="known"); Text(inner("nested"))',
      mode: "exec",
    },
    false,
  );
  expect(facts.constants.map(({ value, call, argument }) => ({ value, call, argument }))).toEqual([
    { value: "f", call: "Text", argument: { kind: "keyword", name: "font" } },
    { value: "t", call: "Text", argument: { kind: "keyword", name: "text" } },
    { value: "p", call: "Text", argument: { kind: "positional", index: 0 } },
    { value: "uncertain", call: "Text", argument: undefined },
    { value: "known", call: "Text", argument: { kind: "keyword", name: "text" } },
    { value: "nested", call: "inner", argument: { kind: "positional", index: 0 } },
  ]);
});
